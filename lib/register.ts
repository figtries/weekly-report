/**
 * The register engine — one arithmetic for both registers.
 *
 * The EDL (what we owe Pertamina) and the VDRL (what our vendors owe us) run
 * the same chain and the same sums, so they share these functions and differ
 * only by the `register` argument.
 *
 * Three decisions are worth knowing before reading the code:
 *
 * **Every curve is derived from dates.** The client's own summary keeps a
 * hand-typed block of W1–W13 figures per discipline; W1 to W12 are literals
 * pasted each week and only W13 is a formula, so its history cannot be trusted
 * and cannot be corrected. Here both curves — planned and actual — are counted
 * from the dates already in the register, exactly as the project's own S-curve
 * is derived rather than imported.
 *
 * **A stage row is a promise; `submitted` is the fact.** The importer writes a
 * row for a stage that was merely planned too, which is what makes the plan
 * curve possible. Only the flag counts as progress.
 *
 * **Everything is measured as of the register's own date**, not today. This
 * file is `R2, 15 Jan 2026`; judging it against August would report every
 * document as months late and say nothing about the work. The as-of date is
 * returned with every summary so the screen can say which day it is talking
 * about.
 *
 * Percentages are 0..100 throughout. Every read is synchronous — see the note
 * at the top of `lib/sqlite.ts`.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db, schema } from './sqlite';
import {
  STAGE_ORDER, daysBetween, isApproved,
  type DocumentCard, type LogEvent, type Obstacle,
  type ObstacleKind, type RegisterNode, type RegisterSummary, type StageReach,
  type LinkStage, type Trend, type WeekPoint, type DisciplineLink,
  type EngineeringBridge, type Movement, type WeekMovement,
} from './register-shared';
import type { DocStage, RegisterKind } from './schema';
import { detectPrefix, type NumberingRule } from './register-numbering';

export * from './register-shared';

/* -------------------------------------------------------------- internals */

type DocumentRow = typeof schema.documents.$inferSelect;
type StageRow = typeof schema.docStages.$inferSelect;
type CategoryRow = typeof schema.docCategories.$inferSelect;
type WeekRow = typeof schema.weeks.$inferSelect;

interface Loaded {
  weeks: WeekRow[];
  categories: CategoryRow[];
  documents: DocumentRow[];
  stages: StageRow[];
  weights: Array<{ stage: DocStage; weight: number }>;
  byDoc: Map<string, StageRow[]>;
  docsByCategory: Map<string, DocumentRow[]>;
  transmittalNo: Map<string, string>;
  /** The week being looked at. Everything is counted as it stood at its end. */
  asOfWeek: number;
  asOfDate: string;
  /** The last week anything actually happened in the register, whatever week is being viewed. */
  evidenceWeek: number;
  evidenceDate: string;
  weekOf: (iso: string) => number;
}

/**
 * @param week the week to read the register as of. Left out, it is the last
 *   week anything happened — which is what "now" means for a register whose
 *   own file stops in January.
 */
function loadRegister(projectId: string, register: RegisterKind, week?: number): Loaded | null {
  const documents = db.select().from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register)))
    .all();
  if (documents.length === 0) return null;

  const stages = db.select().from(schema.docStages)
    .where(inArray(schema.docStages.documentId, documents.map((d) => d.id))).all();

  const categories = db.select().from(schema.docCategories)
    .where(and(eq(schema.docCategories.projectId, projectId), eq(schema.docCategories.register, register)))
    .all();

  const weights = db.select().from(schema.docStageWeights)
    .where(and(
      eq(schema.docStageWeights.projectId, projectId),
      eq(schema.docStageWeights.register, register),
    )).all()
    .filter((w) => w.weight > 0)
    .sort((a, b) => a.order - b.order)
    .map((w) => ({ stage: w.stage, weight: w.weight }));

  const weeks = db.select().from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId)).all()
    .sort((a, b) => a.weekNo - b.weekNo);

  const byDoc = new Map<string, StageRow[]>();
  for (const s of stages) {
    const list = byDoc.get(s.documentId) ?? [];
    list.push(s);
    byDoc.set(s.documentId, list);
  }
  for (const list of byDoc.values()) {
    list.sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  }

  const docsByCategory = new Map<string, DocumentRow[]>();
  for (const d of documents) {
    const list = docsByCategory.get(d.categoryId) ?? [];
    list.push(d);
    docsByCategory.set(d.categoryId, list);
  }

  const transmittalNo = new Map(
    db.select().from(schema.transmittals)
      .where(and(eq(schema.transmittals.projectId, projectId), eq(schema.transmittals.register, register)))
      .all().map((t) => [t.id, t.no]),
  );

  // The register's own date: the last thing that actually happened in it.
  let evidenceDate = weeks[0]?.startDate ?? '2025-10-27';
  for (const s of stages) {
    if (s.submittedAt && s.submittedAt > evidenceDate) evidenceDate = s.submittedAt;
    if (s.returnedAt && s.returnedAt > evidenceDate) evidenceDate = s.returnedAt;
  }

  const weekOf = (iso: string): number => {
    if (weeks.length === 0) return 1;
    for (const w of weeks) if (iso <= w.endDate) return w.weekNo;
    return weeks[weeks.length - 1].weekNo;
  };

  const evidenceWeek = weekOf(evidenceDate);
  const lastWeek = weeks[weeks.length - 1]?.weekNo ?? evidenceWeek;
  // A week outside the project is not an error worth throwing over — it is a
  // stale bookmark, and clamping shows the nearest week that exists.
  const asOfWeek = week === undefined ? evidenceWeek : Math.min(Math.max(1, Math.trunc(week)), lastWeek);
  const asOfDate = weeks.find((w) => w.weekNo === asOfWeek)?.endDate ?? evidenceDate;

  return {
    weeks, categories, documents, stages, weights, byDoc, docsByCategory,
    transmittalNo, asOfWeek, asOfDate, evidenceWeek, evidenceDate, weekOf,
  };
}

/**
 * The week a document reached a stage.
 *
 * 42 submissions in the EDL are marked with a bare `1` because nobody wrote the
 * date down. They count — the client's own summary counts them, and dropping
 * them would leave the curve's last point below the headline it is meant to
 * explain — so they are placed at the week they were promised for, capped at
 * the register's own date. That is an estimate and the screen says so; piling
 * all 42 onto the as-of week instead would invent a twelve-point cliff in the
 * last column, which is a worse lie than an acknowledged one.
 */
function reachedWeek(s: StageRow, loaded: Loaded): number | null {
  if (!s.submitted) return null;
  if (s.submittedAt) return loaded.weekOf(s.submittedAt);
  // Anchored to the register's own last movement, never to the week being
  // viewed: otherwise looking at week 43 would drag 42 dateless submissions
  // forward with it and the earlier weeks would lose them.
  if (s.planSubmitDate) return Math.min(loaded.weekOf(s.planSubmitDate), loaded.evidenceWeek);
  return loaded.evidenceWeek;
}

/** Whether the document had reached this stage by the week being viewed. */
function reachedBy(s: StageRow, loaded: Loaded): boolean {
  const week = reachedWeek(s, loaded);
  return week !== null && week <= loaded.asOfWeek;
}

/** The week a stage came back, on the same terms. */
function returnedWeek(s: StageRow, loaded: Loaded): number | null {
  if (!s.returnedAt && !s.returnCode) return null;
  return s.returnedAt ? loaded.weekOf(s.returnedAt) : loaded.evidenceWeek;
}

function returnedBy(s: StageRow, loaded: Loaded): boolean {
  const week = returnedWeek(s, loaded);
  return week !== null && week <= loaded.asOfWeek;
}

function plannedWeek(s: StageRow, loaded: Loaded): number | null {
  return s.planSubmitDate ? loaded.weekOf(s.planSubmitDate) : null;
}

/** Weighted percent for one set of documents. */
function percentOf(docs: DocumentRow[], loaded: Loaded, upToWeek = loaded.asOfWeek): number {
  if (docs.length === 0) return 0;
  let total = 0;
  for (const { stage, weight } of loaded.weights) {
    let reached = 0;
    for (const d of docs) {
      const row = loaded.byDoc.get(d.id)?.find((s) => s.stage === stage);
      if (!row) continue;
      const week = reachedWeek(row, loaded);
      if (week !== null && week <= upToWeek) reached += 1;
    }
    total += (reached / docs.length) * weight;
  }
  return total;
}

function planPercentOf(docs: DocumentRow[], loaded: Loaded, upToWeek: number): number | null {
  if (docs.length === 0) return null;
  let anyPlan = false;
  let total = 0;
  for (const { stage, weight } of loaded.weights) {
    let planned = 0;
    for (const d of docs) {
      const row = loaded.byDoc.get(d.id)?.find((s) => s.stage === stage);
      if (!row) continue;
      const week = plannedWeek(row, loaded);
      if (week === null) continue;
      anyPlan = true;
      if (week <= upToWeek) planned += 1;
    }
    total += (planned / docs.length) * weight;
  }
  return anyPlan ? total : null;
}

function trendOf(deviation: number | null): Trend {
  if (deviation === null) return 'unplanned';
  if (deviation >= 1) return 'ahead';
  if (deviation >= -1) return 'on-track';
  if (deviation >= -10) return 'slipping';
  return 'behind';
}

function countsFor(docs: DocumentRow[], loaded: Loaded) {
  let untouched = 0;
  let returnedOpen = 0;
  let overdue = 0;

  for (const d of docs) {
    const rows = loaded.byDoc.get(d.id) ?? [];
    if (!rows.some((s) => reachedBy(s, loaded))) untouched += 1;

    const returned = rows.filter((s) => s.returnCode && returnedBy(s, loaded));
    const last = returned[returned.length - 1];
    if (last && !isApproved(last.returnCode)) returnedOpen += 1;

    // Promised by the week being viewed and still not out.
    if (rows.some((s) => !reachedBy(s, loaded) && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)) {
      overdue += 1;
    }
  }

  return { untouched, returnedOpen, overdue };
}

/* ----------------------------------------------------------------- public */

export interface RegisterWeek {
  weekNo: number;
  startDate: string;
  endDate: string;
}

/** Every week of the project, for the week picker. */
export function getRegisterWeeks(projectId: string): RegisterWeek[] {
  return db.select().from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId)).all()
    .sort((a, b) => a.weekNo - b.weekNo)
    .map((w) => ({ weekNo: w.weekNo, startDate: w.startDate, endDate: w.endDate }));
}


/**
 * How far this register exists at all — two cheap counts, not its contents.
 *
 * Pages use it to choose between the working screen and the paste screen. It
 * must not go through `loadRegister`, which gives up on zero documents: a
 * category somebody just created and has not filled yet is still a register,
 * and hiding it takes their work out of their sight.
 */
export function getRegisterShape(projectId: string, register: RegisterKind): {
  documents: number; categories: number;
} {
  const documents = db.select().from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register)))
    .all().length;
  const categories = db.select().from(schema.docCategories)
    .where(and(eq(schema.docCategories.projectId, projectId), eq(schema.docCategories.register, register)))
    .all().length;
  return { documents, categories };
}

/**
 * The two sides' names, to fill the paste screen in ahead of the person.
 *
 * Read straight from the `projects` table rather than through `lib/data.ts` —
 * that file reads the older JSON store and knows nothing about this table. A
 * synchronous read like this prerenders as it is (see `lib/sqlite.ts`), so it
 * needs neither `'use cache'` nor a `<Suspense>` around it.
 */
export function getRegisterParties(projectId: string): {
  clientName: string; contractorName: string;
} {
  const project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).all()[0];
  return { clientName: project?.clientName ?? '', contractorName: project?.contractorName ?? '' };
}

/**
 * The numbering rule for this register, and the numbers already spoken for.
 *
 * Both travel together because the builder needs both to propose the next
 * number: the rule gives its shape, the existing numbers give its sequence.
 */
export function getNumbering(projectId: string, register: RegisterKind): {
  rule: NumberingRule | null;
  /** Every number already in this register, so a proposal cannot collide. */
  taken: string[];
  /** A guess at the project code, for a register that has none yet. */
  suggestedPrefix: string;
} {
  const row = db.select().from(schema.docNumbering)
    .where(and(
      eq(schema.docNumbering.projectId, projectId),
      eq(schema.docNumbering.register, register),
    )).all()[0];

  const taken = db.select().from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register)))
    .all().map((d) => d.docNo).filter((n): n is string => Boolean(n));

  const parse = (raw: string): Record<string, string> => {
    try {
      const value: unknown = JSON.parse(raw);
      return value && typeof value === 'object' ? value as Record<string, string> : {};
    } catch { return {}; }
  };

  const project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).all()[0];

  return {
    rule: row
      ? {
        prefix: row.prefix,
        disciplines: parse(row.disciplines),
        types: parse(row.types),
        digits: row.digits,
      }
      : null,
    taken,
    suggestedPrefix: detectPrefix(taken)
      ?? (project?.docNoPrefix?.split('-')[0] ?? '')
      ?? '',
  };
}

export interface ExportRow {
  /** `A`, `A.1`, `A.1.1` for a group; a running number for a document. */
  no: string;
  docNo: string;
  title: string;
  kind: string;
  isCategory: boolean;
  stages: { stage: DocStage; submittedAt: string | null; submitTransmittal: string | null;
    returnedAt: string | null; returnTransmittal: string | null; returnCode: string | null }[];
}

/**
 * The register flattened for export, in the order it reads on screen.
 *
 * It lives here rather than in the route because the SQL belongs with the rest
 * of the register's reads — and because the shape it produces is the shape the
 * PASTE PARSER understands, which is what lets an exported file be edited in
 * Excel and imported straight back.
 */
export function getRegisterExportRows(projectId: string, register: RegisterKind): ExportRow[] {
  const loaded = loadRegister(projectId, register);
  if (!loaded) return [];

  const childrenOf = new Map<string | null, CategoryRow[]>();
  for (const c of loaded.categories) {
    const list = childrenOf.get(c.parentId) ?? [];
    list.push(c);
    childrenOf.set(c.parentId, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);

  const out: ExportRow[] = [];
  let running = 0;

  const walk = (nodes: CategoryRow[], path: number[]) => {
    nodes.forEach((category, index) => {
      const here = [...path, index + 1];
      const [first, ...rest] = here;
      out.push({
        no: [String.fromCharCode(64 + first), ...rest.map(String)].join('.'),
        // The name sits in the number column exactly as Gundih's and Petrogas'
        // own sheets write it — first filled cell right of the outline code.
        docNo: category.name,
        title: '',
        kind: '',
        isCategory: true,
        stages: [],
      });

      for (const doc of (loaded.docsByCategory.get(category.id) ?? []).sort((a, b) => a.order - b.order)) {
        running += 1;
        out.push({
          no: String(running),
          docNo: doc.docNo ?? '',
          title: doc.title,
          kind: doc.kind ?? '',
          isCategory: false,
          stages: (loaded.byDoc.get(doc.id) ?? [])
            .filter((s) => s.submitted || s.returnedAt || s.returnCode)
            .map((s) => ({
              stage: s.stage,
              submittedAt: s.submittedAt,
              submitTransmittal: s.submitTransmittalId
                ? loaded.transmittalNo.get(s.submitTransmittalId) ?? null : null,
              returnedAt: s.returnedAt,
              returnTransmittal: s.returnTransmittalId
                ? loaded.transmittalNo.get(s.returnTransmittalId) ?? null : null,
              returnCode: s.returnCode,
            })),
        });
      }

      walk(childrenOf.get(category.id) ?? [], here);
    });
  };

  walk(childrenOf.get(null) ?? [], []);
  return out;
}

/**
 * The stage weights as they stand, zeros included — the screen that edits them
 * needs every row, not just the ones that carry weight.
 */
export function getStageWeights(projectId: string, register: RegisterKind): {
  stage: DocStage; weight: number;
}[] {
  return db.select().from(schema.docStageWeights)
    .where(and(
      eq(schema.docStageWeights.projectId, projectId),
      eq(schema.docStageWeights.register, register),
    )).all()
    .sort((a, b) => a.order - b.order)
    .map((w) => ({ stage: w.stage, weight: w.weight }));
}

export function getRegisterSummary(
  projectId: string,
  register: RegisterKind,
  week?: number,
): RegisterSummary | null {
  const loaded = loadRegister(projectId, register, week);
  if (!loaded) return null;
  const { documents, weights, asOfWeek } = loaded;

  const stages: StageReach[] = weights.map(({ stage, weight }) => ({
    stage,
    weight,
    reached: documents.filter((d) => {
      const row = loaded.byDoc.get(d.id)?.find((s) => s.stage === stage);
      return row ? reachedBy(row, loaded) : false;
    }).length,
  }));

  // The curve runs to whichever ends latest: the week being viewed, the last
  // evidence, or the last promise. Anything beyond that is empty chart.
  let lastPlanWeek = Math.max(asOfWeek, loaded.evidenceWeek);
  for (const s of loaded.stages) {
    const w = plannedWeek(s, loaded);
    if (w !== null && w > lastPlanWeek) lastPlanWeek = w;
  }

  const series: WeekPoint[] = [];
  for (const week of loaded.weeks) {
    if (week.weekNo > lastPlanWeek) break;
    series.push({
      weekNo: week.weekNo,
      endDate: week.endDate,
      actual: percentOf(documents, loaded, week.weekNo),
      plan: planPercentOf(documents, loaded, week.weekNo),
    });
  }

  const actual = percentOf(documents, loaded);
  const plan = planPercentOf(documents, loaded, asOfWeek);
  const previous = series.find((p) => p.weekNo === asOfWeek - 1)?.actual ?? 0;
  const counts = countsFor(documents, loaded);

  const leaves = loaded.categories.filter(
    (c) => !loaded.categories.some((o) => o.parentId === c.id),
  );

  return {
    register,
    documents: documents.length,
    numbered: documents.filter((d) => d.docNo).length,
    categories: leaves.length,
    transmittals: loaded.transmittalNo.size,
    stages,
    actual,
    plan,
    deviation: plan === null ? null : actual - plan,
    thisWeek: actual - previous,
    asOfWeek,
    asOfDate: loaded.asOfDate,
    series,
    evidenceWeek: loaded.evidenceWeek,
    evidenceDate: loaded.evidenceDate,
    undated: loaded.stages.filter((s) => s.submitted && !s.submittedAt).length,
    ...counts,
  };
}

/**
 * The register as a tree — sections and packages with their groups inside.
 *
 * A parent's figures are its whole subtree's, so a vendor package reads as one
 * number without anyone adding up its groups by hand.
 */
export function getRegisterTree(projectId: string, register: RegisterKind, week?: number): RegisterNode[] {
  const loaded = loadRegister(projectId, register, week);
  if (!loaded) return [];

  const childrenOf = new Map<string | null, CategoryRow[]>();
  for (const c of loaded.categories) {
    const list = childrenOf.get(c.parentId) ?? [];
    list.push(c);
    childrenOf.set(c.parentId, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);

  const subtreeDocs = (category: CategoryRow): DocumentRow[] => {
    const own = loaded.docsByCategory.get(category.id) ?? [];
    const kids = childrenOf.get(category.id) ?? [];
    return kids.reduce<DocumentRow[]>((acc, k) => acc.concat(subtreeDocs(k)), own.slice());
  };

  const build = (category: CategoryRow, depth: number): RegisterNode => {
    const docs = subtreeDocs(category);
    const actual = percentOf(docs, loaded);
    const plan = planPercentOf(docs, loaded, loaded.asOfWeek);
    const deviation = plan === null ? null : actual - plan;

    return {
      id: category.id,
      code: category.code,
      name: category.name,
      parentId: category.parentId,
      depth,
      documents: docs.length,
      reached: loaded.weights.map(({ stage, weight }) => ({
        stage,
        weight,
        reached: docs.filter((d) =>
          loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && reachedBy(s, loaded))).length,
      })),
      actual,
      plan,
      deviation,
      trend: trendOf(deviation),
      ...countsFor(docs, loaded),
      children: (childrenOf.get(category.id) ?? []).map((c) => build(c, depth + 1)),
    };
  };

  return (childrenOf.get(null) ?? []).map((c) => build(c, 0));
}

/** The tree flattened to the categories that actually hold documents. */
export function getRegisterLeaves(projectId: string, register: RegisterKind, week?: number): RegisterNode[] {
  const out: RegisterNode[] = [];
  const walk = (nodes: RegisterNode[]) => {
    for (const n of nodes) {
      if (n.children.length === 0) out.push(n);
      else walk(n.children);
    }
  };
  walk(getRegisterTree(projectId, register, week));
  return out.filter((n) => n.documents > 0);
}

/**
 * What is actually holding the work up, worst first.
 *
 * Three kinds, and the order matters: a document that came back with a comment
 * is blocking construction now; one that is past its promised date is blocking
 * it soon; one that has never moved is the vendor register's whole story.
 */
export function getObstacles(projectId: string, register: RegisterKind, week?: number): Obstacle[] {
  const loaded = loadRegister(projectId, register, week);
  if (!loaded) return [];

  const categoryName = new Map(loaded.categories.map((c) => [c.id, c.name]));
  const out: Obstacle[] = [];

  for (const doc of loaded.documents) {
    const rows = loaded.byDoc.get(doc.id) ?? [];
    const base = {
      documentId: doc.id,
      docNo: doc.docNo,
      title: doc.title,
      categoryId: doc.categoryId,
      categoryName: categoryName.get(doc.categoryId) ?? '—',
    };

    const returned = rows.filter((s) => s.returnCode && returnedBy(s, loaded));
    const last = returned[returned.length - 1];
    if (last && !isApproved(last.returnCode)) {
      out.push({
        ...base,
        kind: 'returned',
        stage: last.stage,
        returnCode: last.returnCode,
        since: last.returnedAt,
        days: last.returnedAt ? daysBetween(last.returnedAt, loaded.asOfDate) : null,
      });
      continue;
    }

    const late = rows
      .filter((s) => !reachedBy(s, loaded) && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)
      .sort((a, b) => (a.planSubmitDate! < b.planSubmitDate! ? -1 : 1))[0];
    if (late) {
      out.push({
        ...base,
        kind: 'overdue',
        stage: late.stage,
        returnCode: null,
        since: late.planSubmitDate,
        days: daysBetween(late.planSubmitDate!, loaded.asOfDate),
      });
      continue;
    }

    if (!rows.some((s) => reachedBy(s, loaded))) {
      out.push({ ...base, kind: 'untouched', stage: null, returnCode: null, since: null, days: null });
    }
  }

  const rank: Record<ObstacleKind, number> = { returned: 0, overdue: 1, untouched: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.days ?? 0) - (a.days ?? 0));
}

/**
 * Every movement in the register, most recent first.
 *
 * This is the thing the Excel file can never answer: its columns are overwritten
 * on each revision, so how many times a drawing went round, and how long each
 * lap took, is gone. An extension-of-time argument is built out of exactly this.
 */
export function getRegisterLog(
  projectId: string,
  register: RegisterKind,
  limit = 200,
  week?: number,
): LogEvent[] {
  const loaded = loadRegister(projectId, register, week);
  if (!loaded) return [];

  const categoryName = new Map(loaded.categories.map((c) => [c.id, c.name]));
  const documentById = new Map(loaded.documents.map((d) => [d.id, d]));
  const events: LogEvent[] = [];

  for (const s of loaded.stages) {
    const doc = documentById.get(s.documentId);
    if (!doc) continue;
    const base = {
      documentId: doc.id,
      docNo: doc.docNo,
      title: doc.title,
      categoryName: categoryName.get(doc.categoryId) ?? '—',
      stage: s.stage,
    };
    if (reachedBy(s, loaded)) {
      events.push({
        ...base,
        at: s.submittedAt ?? loaded.evidenceDate,
        dated: s.submittedAt !== null,
        kind: 'submit',
        transmittal: s.submitTransmittalId ? loaded.transmittalNo.get(s.submitTransmittalId) ?? null : null,
        returnCode: null,
      });
    }
    if (returnedBy(s, loaded)) {
      events.push({
        ...base,
        at: s.returnedAt ?? loaded.evidenceDate,
        dated: s.returnedAt !== null,
        kind: 'return',
        transmittal: s.returnTransmittalId ? loaded.transmittalNo.get(s.returnTransmittalId) ?? null : null,
        returnCode: s.returnCode,
      });
    }
  }

  return events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/**
 * Every document in the register, keyed by category.
 *
 * The whole register goes to the client in one payload, history and all. It is
 * affordable — 143 documents and 445 stage rows in the EDL, 311 and 67 in the
 * VDRL — and it is what lets the working screen open a document's timeline
 * without a round trip, on a site connection that may not have one to spare.
 */
export function getRegisterCards(
  projectId: string,
  register: RegisterKind,
  week?: number,
): Record<string, DocumentCard[]> {
  const loaded = loadRegister(projectId, register, week);
  if (!loaded) return {};

  const out: Record<string, DocumentCard[]> = {};

  for (const [categoryId, docs] of loaded.docsByCategory) {
    out[categoryId] = docs
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((d) => {
        const rows = loaded.byDoc.get(d.id) ?? [];
        const moved = rows.filter((s) => reachedBy(s, loaded));
        const last = moved[moved.length - 1] ?? null;
        const returned = rows.filter((s) => s.returnCode && returnedBy(s, loaded));
        const lastReturn = returned[returned.length - 1] ?? null;
        const next = rows.find((s) => !reachedBy(s, loaded)) ?? null;

        return {
          id: d.id,
          categoryId,
          docNo: d.docNo,
          title: d.title,
          revision: d.revision,
          percent: percentOf([d], loaded),
          stage: last?.stage ?? null,
          returnCode: lastReturn && !isApproved(lastReturn.returnCode) ? lastReturn.returnCode : null,
          waiting: last?.submittedAt && !last.returnedAt
            ? daysBetween(last.submittedAt, loaded.asOfDate)
            : null,
          nextStage: next?.stage ?? null,
          plannedAt: next?.planSubmitDate ?? null,
          overdue: Boolean(next?.planSubmitDate && next.planSubmitDate < loaded.asOfDate),
          laps: rows.filter((s) => s.stage.startsWith('RE_') && reachedBy(s, loaded)).length,
          stages: rows.map((s) => ({
            stage: s.stage,
            planSubmitDate: s.planSubmitDate,
            submitted: reachedBy(s, loaded),
            submittedAt: s.submittedAt,
            submitTransmittal: s.submitTransmittalId ? loaded.transmittalNo.get(s.submitTransmittalId) ?? null : null,
            returnedAt: s.returnedAt,
            returnTransmittal: s.returnTransmittalId ? loaded.transmittalNo.get(s.returnTransmittalId) ?? null : null,
            returnCode: s.returnCode,
            waiting: s.submittedAt ? daysBetween(s.submittedAt, s.returnedAt ?? loaded.asOfDate) : null,
          })),
        };
      });
  }

  return out;
}

/* ----------------------------------------------------- the link to the WBS */

/**
 * Gundih's WBS splits engineering into five disciplines, each with an IFR, an
 * IFA and an AFC leaf — the same five the EDL Summary counts. That is the seam
 * the `linked` method exists for: the leaf reads its figure from the register
 * instead of being measured a second time.
 *
 * The proposal is by name — the WBS's `General`/`Process`/`Mechanical`/
 * `Electrical`/`Instrument` against the register's top-level sections — and it
 * is only a proposal until someone turns the switch on, because this register
 * is thirty weeks older than the report it would feed.
 */
const DISCIPLINE_CATEGORY: Record<string, string> = {
  general: 'A',
  process: 'B.1',
  mechanical: 'B.2',
  electrical: 'B.3',
  instrument: 'B.4',
};

export function getDisciplineLinks(projectId: string, week?: number): DisciplineLink[] {
  const loaded = loadRegister(projectId, 'edl', week);
  if (!loaded) return [];

  const nodes = db.select().from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId)).all();

  // The last week that was actually REPORTED, not the last week on the
  // calendar: Gundih's schedule runs to week 60 while the workbook stops at 43,
  // and reading the empty tail would show every leaf at zero and make the
  // register look like pure gain.
  const weeks = db.select().from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId)).all()
    .sort((a, b) => b.weekNo - a.weekNo);
  const recorded = new Set(db.selectDistinct({ weekId: schema.leafProgress.weekId })
    .from(schema.leafProgress).all().map((r) => r.weekId));
  // Compare like with like: the WBS figure for the week being viewed, if that
  // week was reported at all, otherwise the last week that was.
  const latestWeek = weeks.find((w) => w.weekNo <= loaded.asOfWeek && recorded.has(w.id))
    ?? weeks.find((w) => recorded.has(w.id))
    ?? null;
  const progress = latestWeek
    ? new Map(db.select().from(schema.leafProgress)
        .where(eq(schema.leafProgress.weekId, latestWeek.id)).all()
        .map((p) => [p.nodeId, p.cumProgressPct]))
    : new Map<string, number>();

  const categoryByCode = new Map(loaded.categories.map((c) => [c.code, c]));
  const subtreeDocs = (code: string) =>
    loaded.documents.filter((d) => {
      const cat = loaded.categories.find((c) => c.id === d.categoryId);
      return cat ? cat.code === code || cat.code.startsWith(`${code}.`) : false;
    });

  const out: DisciplineLink[] = [];

  for (const node of nodes) {
    const key = node.deskripsi.trim().toLowerCase();
    const code = DISCIPLINE_CATEGORY[key];
    if (!code) continue;

    const leaves = nodes
      .filter((n) => n.parentId === node.id && n.isLeaf)
      .sort((a, b) => a.order - b.order);
    if (leaves.length === 0) continue;

    const category = categoryByCode.get(code) ?? null;
    const docs = category ? subtreeDocs(code) : [];

    out.push({
      nodeId: node.id,
      name: node.deskripsi,
      wbsWeek: latestWeek?.weekNo ?? null,
      categoryId: category?.id ?? null,
      categoryName: category?.name ?? null,
      bobot: leaves.reduce((a, l) => a + (l.bobot ?? 0), 0),
      stages: leaves
        .map((leaf) => {
          const stage = leaf.deskripsi.trim().toUpperCase().replace('-', '_') as DocStage;
          if (!STAGE_ORDER.includes(stage)) return null;
          const reached = docs.filter(
            (d) => loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && reachedBy(s, loaded)),
          ).length;
          return {
            nodeId: leaf.id,
            stage,
            linked: leaf.progressMethod === 'linked' && leaf.linkedCategoryId === category?.id,
            wbsPercent: progress.get(leaf.id) ?? 0,
            registerPercent: docs.length === 0 ? 0 : (reached / docs.length) * 100,
          };
        })
        .filter((s): s is LinkStage => s !== null),
    });
  }

  const order = Object.keys(DISCIPLINE_CATEGORY);
  return out.sort((a, b) => order.indexOf(a.name.toLowerCase()) - order.indexOf(b.name.toLowerCase()));
}

/**
 * What moved inside one week, counted from the dates in the register.
 *
 * The summary used to report the week as a single delta — `+0.00 this week` —
 * which cannot tell a quiet week apart from a stale file. A controller's week
 * is three events: what went out, what came back with comments, and what was
 * finally approved. All three are counted the same way progress is, from the
 * stage rows, so the block can never disagree with the headline above it.
 *
 * Dateless submissions are deliberately left out. `reachedWeek` places them on
 * the week they were promised for so the curve keeps its shape, but claiming a
 * particular week saw them go out would be inventing a fact about that week.
 */
export function getWeekMovement(
  projectId: string,
  register: RegisterKind,
  week?: number,
): WeekMovement | null {
  const loaded = loadRegister(projectId, register, week);
  if (!loaded) return null;

  const { asOfWeek, documents } = loaded;
  const bounds = loaded.weeks.find((w) => w.weekNo === asOfWeek);
  const startDate = bounds?.startDate ?? loaded.asOfDate;
  const endDate = bounds?.endDate ?? loaded.asOfDate;
  const inWeek = (iso: string | null) => iso !== null && iso >= startDate && iso <= endDate;

  const categoryName = new Map(loaded.categories.map((c) => [c.id, c.name]));
  const documentById = new Map(documents.map((d) => [d.id, d]));
  const events: Movement[] = [];

  for (const s of loaded.stages) {
    const doc = documentById.get(s.documentId);
    if (!doc) continue;
    const base = {
      documentId: doc.id,
      docNo: doc.docNo,
      title: doc.title,
      categoryName: categoryName.get(doc.categoryId) ?? '—',
      stage: s.stage,
    };

    if (s.submitted && inWeek(s.submittedAt)) {
      events.push({ ...base, kind: 'submitted', returnCode: null, at: s.submittedAt! });
    }
    if (s.returnCode && inWeek(s.returnedAt)) {
      events.push({
        ...base,
        kind: isApproved(s.returnCode) ? 'approved' : 'returned',
        returnCode: s.returnCode,
        at: s.returnedAt!,
      });
    }
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    weekNo: asOfWeek,
    startDate,
    endDate,
    submitted: events.filter((e) => e.kind === 'submitted').length,
    returned: events.filter((e) => e.kind === 'returned').length,
    approved: events.filter((e) => e.kind === 'approved').length,
    gain: percentOf(documents, loaded, asOfWeek) - percentOf(documents, loaded, asOfWeek - 1),
    events,
    evidenceWeek: loaded.evidenceWeek,
    evidenceDate: loaded.evidenceDate,
  };
}

/**
 * The seam between the EDL and the weekly report, weighted the same way.
 *
 * Both screens describe the same engineering work and used to do it without
 * ever mentioning each other, so a reader could leave one and be surprised by
 * the other. This rolls `getDisciplineLinks` up into a single pair of figures —
 * what the report carries, what the register counts — and each screen shows it
 * as a band pointing at the other.
 *
 * Weighted by each discipline's project weight rather than averaged flat: a
 * discipline worth six times another should move this number six times as far.
 */
export function getEngineeringBridge(projectId: string, week?: number): EngineeringBridge | null {
  const links = getDisciplineLinks(projectId, week);
  if (links.length === 0) return null;

  const loaded = loadRegister(projectId, 'edl', week);
  if (!loaded) return null;

  let weight = 0;
  let typed = 0;
  let counted = 0;
  let linked = 0;

  for (const d of links) {
    if (d.stages.length === 0) continue;
    const w = d.bobot > 0 ? d.bobot : 1;
    weight += w;
    typed += w * (d.stages.reduce((a, s) => a + s.wbsPercent, 0) / d.stages.length);
    counted += w * (d.stages.reduce((a, s) => a + s.registerPercent, 0) / d.stages.length);
    if (d.stages.every((s) => s.linked)) linked += 1;
  }

  if (weight === 0) return null;

  return {
    weekNo: loaded.asOfWeek,
    wbsWeek: links[0]?.wbsWeek ?? null,
    typedPercent: typed / weight,
    registerPercent: counted / weight,
    disciplines: links.length,
    linked,
    documents: loaded.documents.length,
  };
}
