/**
 * Reads for the v2 database.
 *
 * Separate from `lib/data.ts`, which serves the old JSON store and still feeds
 * every existing screen. This module is the one that will eventually replace
 * it; for now only `/v2` reads from here.
 *
 * Every query is synchronous on purpose. better-sqlite3 under Cache Components
 * counts as a deterministic operation, so these complete during prerendering
 * and land in the static shell — no `use cache`, no `<Suspense>`. See the note
 * at the top of `lib/sqlite.ts`.
 *
 * Percentages are 0..100 throughout, matching the schema.
 */
import { and, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { leafPlanFraction } from './plan-curve';

export type WbsNode = typeof schema.wbsNodes.$inferSelect;

export interface UnitSummary {
  code: string;
  label: string;
  name: string;
  /** Share of the whole project, 0..100. */
  bobot: number;
  /** How far this unit has got in its own terms, 0..100. */
  progress: number;
  /** That progress expressed against the project, 0..100. */
  contribution: number;
  /** Where it was meant to be, against each baseline. */
  targetContractual: number;
  targetActive: number;
  /** contribution − targetContractual. */
  deviation: number;
}

export interface WeekSummary {
  weekNo: number;
  startDate: string;
  endDate: string;
  status: string;
  units: UnitSummary[];
  totals: {
    bobot: number;
    actual: number;
    targetContractual: number;
    targetActive: number;
    deviation: number;
  };
}

export interface RegisterSummary {
  documents: number;
  categories: number;
  transmittals: number;
  stages: Array<{ stage: string; weight: number; reached: number }>;
  progress: number;
  /** Documents whose latest return code is anything other than approved. */
  awaitingComment: number;
}

/* ------------------------------------------------------------------ project */

export function getProject(projectId: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0] ?? null;
}

export function listWeeks(projectId: string) {
  return db.select().from(schema.weeks).where(eq(schema.weeks.projectId, projectId)).all()
    .sort((a, b) => a.weekNo - b.weekNo);
}

/** The last week that actually carries progress, which is the one worth showing. */
export function getReportedWeek(projectId: string) {
  const weeks = listWeeks(projectId);
  for (let i = weeks.length - 1; i >= 0; i--) {
    const rows = db.select().from(schema.leafProgress)
      .where(eq(schema.leafProgress.weekId, weeks[i].id)).all();
    if (rows.length > 0) return weeks[i];
  }
  return weeks[weeks.length - 1] ?? null;
}

/* --------------------------------------------------------------------- WBS */

/**
 * A reporting unit owns its subtree MINUS any reporting unit nested inside it.
 * SPK-007 sits at 1.4.4 inside SPK-004's 1.4 and both are reported; without the
 * subtraction SPK-007 is counted twice and the project total reaches 114%.
 */
function leavesOfUnit(nodes: WbsNode[], unitCode: string, allUnitCodes: string[]) {
  const nested = allUnitCodes.filter((c) => c !== unitCode && c.startsWith(`${unitCode}.`));
  return nodes
    .filter((n) => n.bobot !== null && n.bobot > 0)
    .filter((n) => n.wbsCode === unitCode || n.wbsCode.startsWith(`${unitCode}.`))
    .filter((n) => !nested.some((c) => n.wbsCode === c || n.wbsCode.startsWith(`${c}.`)));
}

export function getWeekSummary(projectId: string, weekNo: number): WeekSummary | null {
  const week = db.select().from(schema.weeks)
    .where(and(eq(schema.weeks.projectId, projectId), eq(schema.weeks.weekNo, weekNo))).all()[0];
  if (!week) return null;

  const nodes = db.select().from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId)).all();
  const progress = db.select().from(schema.leafProgress)
    .where(eq(schema.leafProgress.weekId, week.id)).all();
  const pct = new Map(progress.map((p) => [p.nodeId, p.cumProgressPct]));

  const scheduleFor = (kind: 'contractual' | 'active') => new Map(
    db.select().from(schema.nodeSchedules)
      .where(eq(schema.nodeSchedules.baselineId, `${projectId}:${kind}`)).all()
      .map((s) => [s.nodeId, s]),
  );
  const contractual = scheduleFor('contractual');
  const active = scheduleFor('active');

  const planned = (leaves: WbsNode[], sched: ReturnType<typeof scheduleFor>) =>
    leaves.reduce((a, n) => {
      const s = sched.get(n.id);
      return a + (s ? n.bobot! * leafPlanFraction(s.startDate, s.finishDate, week.endDate) : 0);
    }, 0);

  const unitNodes = nodes.filter((n) => n.isReportingUnit).sort((a, b) => a.order - b.order);
  const unitCodes = unitNodes.map((n) => n.wbsCode);

  const units: UnitSummary[] = unitNodes.map((unit) => {
    const leaves = leavesOfUnit(nodes, unit.wbsCode, unitCodes);
    const bobot = leaves.reduce((a, n) => a + n.bobot!, 0);
    const contribution = leaves.reduce((a, n) => a + (n.bobot! * (pct.get(n.id) ?? 0)) / 100, 0);
    const targetContractual = planned(leaves, contractual);
    return {
      code: unit.wbsCode,
      label: unit.unitLabel ?? unit.wbsCode,
      name: unit.deskripsi.trim(),
      bobot,
      progress: bobot === 0 ? 0 : (contribution / bobot) * 100,
      contribution,
      targetContractual,
      targetActive: planned(leaves, active),
      deviation: contribution - targetContractual,
    };
  });

  const totals = units.reduce(
    (a, u) => ({
      bobot: a.bobot + u.bobot,
      actual: a.actual + u.contribution,
      targetContractual: a.targetContractual + u.targetContractual,
      targetActive: a.targetActive + u.targetActive,
      deviation: 0,
    }),
    { bobot: 0, actual: 0, targetContractual: 0, targetActive: 0, deviation: 0 },
  );
  totals.deviation = totals.actual - totals.targetContractual;

  return {
    weekNo: week.weekNo,
    startDate: week.startDate,
    endDate: week.endDate,
    status: week.status,
    units,
    totals,
  };
}

/* -------------------------------------------------------- document control */

/** Return codes that mean the document is genuinely through. */
const APPROVED = new Set(['APP', 'APPROVED', 'FINISH']);

export function getRegisterSummary(projectId: string): RegisterSummary | null {
  const documents = db.select().from(schema.documents)
    .where(eq(schema.documents.projectId, projectId)).all();
  if (documents.length === 0) return null;

  const categories = db.select().from(schema.docCategories)
    .where(eq(schema.docCategories.projectId, projectId)).all();
  const transmittals = db.select().from(schema.transmittals)
    .where(eq(schema.transmittals.projectId, projectId)).all();
  const weights = db.select().from(schema.docStageWeights)
    .where(eq(schema.docStageWeights.projectId, projectId)).all()
    .sort((a, b) => a.order - b.order);

  const docIds = new Set(documents.map((d) => d.id));
  const allStages = db.select().from(schema.docStages).all().filter((s) => docIds.has(s.documentId));

  // A stage record exists only where something actually happened, so its
  // presence IS the evidence — see the note in scripts/verify-edl.ts.
  const reachedBy = new Map<string, Set<string>>();
  for (const s of allStages) {
    const set = reachedBy.get(s.stage) ?? new Set<string>();
    set.add(s.documentId);
    reachedBy.set(s.stage, set);
  }

  const total = documents.length;
  const stages = weights
    .filter((w) => w.weight > 0)
    .map((w) => ({ stage: w.stage, weight: w.weight, reached: reachedBy.get(w.stage)?.size ?? 0 }));

  const progress = stages.reduce((a, s) => a + (s.reached / total) * s.weight, 0);

  const awaitingComment = documents.filter((d) => {
    const codes = allStages
      .filter((s) => s.documentId === d.id && s.returnCode)
      .map((s) => s.returnCode!.toUpperCase());
    return codes.length > 0 && !codes.some((c) => APPROVED.has(c));
  }).length;

  return {
    documents: total,
    categories: categories.length,
    transmittals: transmittals.length,
    stages,
    progress,
    awaitingComment,
  };
}
