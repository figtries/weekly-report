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
} from './register-shared';
import type { DocStage, RegisterKind } from './schema';

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
  asOfDate: string;
  asOfWeek: number;
  weekOf: (iso: string) => number;
}

function loadRegister(projectId: string, register: RegisterKind): Loaded | null {
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
  let asOfDate = weeks[0]?.startDate ?? '2025-10-27';
  for (const s of stages) {
    if (s.submittedAt && s.submittedAt > asOfDate) asOfDate = s.submittedAt;
    if (s.returnedAt && s.returnedAt > asOfDate) asOfDate = s.returnedAt;
  }

  const weekOf = (iso: string): number => {
    if (weeks.length === 0) return 1;
    for (const w of weeks) if (iso <= w.endDate) return w.weekNo;
    return weeks[weeks.length - 1].weekNo;
  };

  return {
    weeks, categories, documents, stages, weights, byDoc, docsByCategory,
    transmittalNo, asOfDate, asOfWeek: weekOf(asOfDate), weekOf,
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
  if (s.planSubmitDate) return Math.min(loaded.weekOf(s.planSubmitDate), loaded.asOfWeek);
  return loaded.asOfWeek;
}

function plannedWeek(s: StageRow, loaded: Loaded): number | null {
  return s.planSubmitDate ? loaded.weekOf(s.planSubmitDate) : null;
}

/** Weighted percent for one set of documents. */
function percentOf(docs: DocumentRow[], loaded: Loaded, upToWeek?: number): number {
  if (docs.length === 0) return 0;
  let total = 0;
  for (const { stage, weight } of loaded.weights) {
    let reached = 0;
    for (const d of docs) {
      const row = loaded.byDoc.get(d.id)?.find((s) => s.stage === stage);
      if (!row) continue;
      const week = reachedWeek(row, loaded);
      if (week !== null && (upToWeek === undefined || week <= upToWeek)) reached += 1;
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
    const moved = rows.filter((s) => s.submitted);
    if (moved.length === 0) untouched += 1;

    const returned = rows.filter((s) => s.returnCode);
    const last = returned[returned.length - 1];
    if (last && !isApproved(last.returnCode)) returnedOpen += 1;

    // Promised by now and still not out. Measured against the register's own
    // date, not today — see the note at the top of the file.
    if (rows.some((s) => !s.submitted && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)) {
      overdue += 1;
    }
  }

  return { untouched, returnedOpen, overdue };
}

/* ----------------------------------------------------------------- public */

export function getRegisterSummary(projectId: string, register: RegisterKind): RegisterSummary | null {
  const loaded = loadRegister(projectId, register);
  if (!loaded) return null;
  const { documents, weights, asOfWeek } = loaded;

  const stages: StageReach[] = weights.map(({ stage, weight }) => ({
    stage,
    weight,
    reached: documents.filter((d) => {
      const row = loaded.byDoc.get(d.id)?.find((s) => s.stage === stage);
      return row ? row.submitted : false;
    }).length,
  }));

  // The curve runs to whichever ends later: the last evidence, or the last
  // promise. Anything beyond that is empty chart.
  let lastPlanWeek = asOfWeek;
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
export function getRegisterTree(projectId: string, register: RegisterKind): RegisterNode[] {
  const loaded = loadRegister(projectId, register);
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
        reached: docs.filter((d) => loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && s.submitted)).length,
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
export function getRegisterLeaves(projectId: string, register: RegisterKind): RegisterNode[] {
  const out: RegisterNode[] = [];
  const walk = (nodes: RegisterNode[]) => {
    for (const n of nodes) {
      if (n.children.length === 0) out.push(n);
      else walk(n.children);
    }
  };
  walk(getRegisterTree(projectId, register));
  return out.filter((n) => n.documents > 0);
}

/**
 * What is actually holding the work up, worst first.
 *
 * Three kinds, and the order matters: a document that came back with a comment
 * is blocking construction now; one that is past its promised date is blocking
 * it soon; one that has never moved is the vendor register's whole story.
 */
export function getObstacles(projectId: string, register: RegisterKind): Obstacle[] {
  const loaded = loadRegister(projectId, register);
  if (!loaded) return [];

  const categoryName = new Map(loaded.categories.map((c) => [c.id, c.name]));
  const out: Obstacle[] = [];

  for (const doc of loaded.documents) {
    const rows = loaded.byDoc.get(doc.id) ?? [];
    const base = {
      documentId: doc.id,
      docNo: doc.docNo,
      title: doc.title,
      categoryName: categoryName.get(doc.categoryId) ?? '—',
    };

    const returned = rows.filter((s) => s.returnCode);
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
      .filter((s) => !s.submitted && s.planSubmitDate && s.planSubmitDate < loaded.asOfDate)
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

    if (!rows.some((s) => s.submitted)) {
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
export function getRegisterLog(projectId: string, register: RegisterKind, limit = 200): LogEvent[] {
  const loaded = loadRegister(projectId, register);
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
    if (s.submitted) {
      events.push({
        ...base,
        at: s.submittedAt ?? loaded.asOfDate,
        dated: s.submittedAt !== null,
        kind: 'submit',
        transmittal: s.submitTransmittalId ? loaded.transmittalNo.get(s.submitTransmittalId) ?? null : null,
        returnCode: null,
      });
    }
    if (s.returnedAt || s.returnCode) {
      events.push({
        ...base,
        at: s.returnedAt ?? loaded.asOfDate,
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
): Record<string, DocumentCard[]> {
  const loaded = loadRegister(projectId, register);
  if (!loaded) return {};

  const out: Record<string, DocumentCard[]> = {};

  for (const [categoryId, docs] of loaded.docsByCategory) {
    out[categoryId] = docs
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((d) => {
        const rows = loaded.byDoc.get(d.id) ?? [];
        const moved = rows.filter((s) => s.submitted);
        const last = moved[moved.length - 1] ?? null;
        const returned = rows.filter((s) => s.returnCode);
        const lastReturn = returned[returned.length - 1] ?? null;
        const next = rows.find((s) => !s.submitted) ?? null;

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
          laps: rows.filter((s) => s.stage.startsWith('RE_') && s.submitted).length,
          stages: rows.map((s) => ({
            stage: s.stage,
            planSubmitDate: s.planSubmitDate,
            submitted: s.submitted,
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

export function getDisciplineLinks(projectId: string): DisciplineLink[] {
  const loaded = loadRegister(projectId, 'edl');
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
  const latestWeek = weeks.find((w) => recorded.has(w.id)) ?? null;
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
            (d) => loaded.byDoc.get(d.id)?.some((s) => s.stage === stage && s.submitted),
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
