/**
 * The register engine — one arithmetic for both registers.
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import {
  LOOKAHEAD_DAYS, REPLY_DAYS, STAGE_ORDER, codeAct, compareStages, daysBetween, isAddedStage, isApproved, isFull, stageChain,
  type DocumentCard, type LogEvent, type Obstacle,
  type ObstacleKind, type RegisterNode, type RegisterSummary, type StageReach,
  type LinkStage, type Trend, type WeekPoint, type DisciplineLink,
  type EngineeringBridge, type Movement, type WeekMovement, type RegisterSource,
} from './register-shared';
import { kindOf, type ExistingNode, type OutlineNode } from './builder-model';
import { deriveInitial } from './initial';
import type { DocStage, RegisterKind } from './schema';
import { detectPrefix, type NumberingRule } from './register-numbering';
import { MAIN_STAGES, defaultStage, parseCodes, type RegisterSettings } from './register-settings';
import { outlineCode } from './register-outline';

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
  asOfWeek: number;
  asOfDate: string;
  evidenceWeek: number;
  evidenceDate: string;
  weekOf: (iso: string) => number;
}

async function loadRegister(projectId: string, register: RegisterKind, week?: number): Promise<Loaded | null> {
  const documents = await db.select().from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register)));
  if (documents.length === 0) return null;

  const [stages, categories, rawWeights, weeks, transmittals] = await Promise.all([
    db.select().from(schema.docStages)
      .where(inArray(schema.docStages.documentId, documents.map((d) => d.id))),
    db.select().from(schema.docCategories)
      .where(and(eq(schema.docCategories.projectId, projectId), eq(schema.docCategories.register, register))),
    db.select().from(schema.docStageWeights)
      .where(and(eq(schema.docStageWeights.projectId, projectId), eq(schema.docStageWeights.register, register))),
    db.select().from(schema.weeks).where(eq(schema.weeks.projectId, projectId)),
    db.select().from(schema.transmittals)
      .where(and(eq(schema.transmittals.projectId, projectId), eq(schema.transmittals.register, register))),
  ]);

  const weights = rawWeights
    .filter((w) => w.weight > 0)
    .sort((a, b) => compareStages(a.stage, b.stage))
    .map((w) => ({ stage: w.stage, weight: w.weight }));

  weeks.sort((a, b) => a.weekNo - b.weekNo);

  const byDoc = new Map<string, StageRow[]>();
  for (const s of stages) {
    const list = byDoc.get(s.documentId) ?? [];
    list.push(s);
    byDoc.set(s.documentId, list);
  }
  for (const list of byDoc.values()) {
    list.sort((a, b) => compareStages(a.stage, b.stage));
  }

  const docsByCategory = new Map<string, DocumentRow[]>();
  for (const d of documents) {
    const list = docsByCategory.get(d.categoryId) ?? [];
    list.push(d);
    docsByCategory.set(d.categoryId, list);
  }

  const transmittalNo = new Map(transmittals.map((t) => [t.id, t.no]));

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
  const asOfWeek = week === undefined ? evidenceWeek : Math.min(Math.max(1, Math.trunc(week)), lastWeek);
  const asOfDate = weeks.find((w) => w.weekNo === asOfWeek)?.endDate ?? evidenceDate;

  return {
    weeks, categories, documents, stages, weights, byDoc, docsByCategory,
    transmittalNo, asOfWeek, asOfDate, evidenceWeek, evidenceDate, weekOf,
  };
}

function reachedWeek(s: StageRow, loaded: Loaded): number | null {
  if (!s.submitted) return null;
  if (s.submittedAt) return loaded.weekOf(s.submittedAt);
  if (s.planSubmitDate) return Math.min(loaded.weekOf(s.planSubmitDate), loaded.evidenceWeek);
  return loaded.evidenceWeek;
}

function reachedBy(s: StageRow, loaded: Loaded): boolean {
  const week = reachedWeek(s, loaded);
  return week !== null && week <= loaded.asOfWeek;
}

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

interface OpenState {
  kind: ObstacleKind;
  stage: DocStage | null;
  returnCode: string | null;
  next: DocStage | null;
  since: string | null;
  days: number | null;
}

function ballOf(rows: StageRow[], loaded: Loaded): { furthest: number; latest: StageRow | null; out: boolean } {
  let furthest = -1;
  rows.forEach((s, i) => { if (reachedBy(s, loaded)) furthest = i; });
  const latest = furthest >= 0 ? rows[furthest] : null;
  return { furthest, latest, out: Boolean(latest && !returnedBy(latest, loaded)) };
}

function sendNextOf(rows: StageRow[], loaded: Loaded): DocStage | null {
  const { latest, out } = ballOf(rows, loaded);
  if (out) return null;
  const weighted = loaded.weights.map((w) => w.stage);
  if (!latest) return rows[0]?.stage ?? weighted[0] ?? null;
  const chain = stageChain(weighted);
  const order = (stage: DocStage) => chain.indexOf(stage);
  const nextWeighted = weighted.find((stage) => order(stage) > order(latest.stage)) ?? null;
  const nextInOrder = chain[order(latest.stage) + 1] ?? null;
  const code = (latest.returnCode ?? '').trim().toUpperCase();
  if (isApproved(code)) return nextWeighted;
  if (codeAct(code) === 'RWC') return nextInOrder;
  return nextWeighted ?? nextInOrder;
}

function openStateOf(rows: StageRow[], loaded: Loaded): {
  open: OpenState | null;
  withOtherSide: boolean;
  awaiting: number | null;
} {
  const { asOfDate } = loaded;
  const { furthest, latest, out } = ballOf(rows, loaded);

  if (latest && out) {
    const awaiting = latest.submittedAt ? daysBetween(latest.submittedAt, asOfDate) : null;
    const open: OpenState | null = awaiting !== null && awaiting > REPLY_DAYS
      ? { kind: 'waiting', stage: latest.stage, returnCode: null, next: null, since: latest.submittedAt, days: awaiting }
      : null;
    return { open, withOtherSide: true, awaiting };
  }

  const ahead = rows.slice(furthest + 1).filter((s) => s.planSubmitDate)
    .sort((a, b) => (a.planSubmitDate! < b.planSubmitDate! ? -1 : 1));
  const unanswered = latest && latest.returnCode && !isApproved(latest.returnCode) ? latest : null;

  const late = ahead.find((s) => s.planSubmitDate! < asOfDate);
  if (late) {
    return {
      open: {
        kind: 'late',
        stage: late.stage,
        returnCode: unanswered?.returnCode ?? null,
        next: sendNextOf(rows, loaded),
        since: late.planSubmitDate,
        days: daysBetween(late.planSubmitDate!, asOfDate),
      },
      withOtherSide: false,
      awaiting: null,
    };
  }

  if (unanswered) {
    return {
      open: {
        kind: 'comments',
        stage: unanswered.stage,
        returnCode: unanswered.returnCode,
        next: sendNextOf(rows, loaded),
        since: unanswered.returnedAt,
        days: unanswered.returnedAt ? daysBetween(unanswered.returnedAt, asOfDate) : null,
      },
      withOtherSide: false,
      awaiting: null,
    };
  }

  const soon = ahead.find((s) => daysBetween(asOfDate, s.planSubmitDate!) <= LOOKAHEAD_DAYS);
  if (soon) {
    return {
      open: {
        kind: 'soon',
        stage: soon.stage,
        returnCode: null,
        next: sendNextOf(rows, loaded),
        since: soon.planSubmitDate,
        days: daysBetween(asOfDate, soon.planSubmitDate!),
      },
      withOtherSide: false,
      awaiting: null,
    };
  }

  if (furthest < 0) {
    return {
      open: { kind: 'untouched', stage: null, returnCode: null, next: null, since: null, days: null },
      withOtherSide: false,
      awaiting: null,
    };
  }
  return { open: null, withOtherSide: false, awaiting: null };
}

function actionOf(doc: DocumentRow, rows: StageRow[], loaded: Loaded): OpenState | null {
  if (isFull(percentOf([doc], loaded))) return null;
  return openStateOf(rows, loaded).open;
}

function countsFor(docs: DocumentRow[], loaded: Loaded) {
  let untouched = 0;
  let returnedOpen = 0;
  let overdue = 0;
  let awaiting = 0;
  let withUs = 0;
  let longestWait: number | null = null;

  for (const d of docs) {
    const rows = loaded.byDoc.get(d.id) ?? [];
    if (!rows.some((s) => reachedBy(s, loaded))) untouched += 1;

    const state = openStateOf(rows, loaded);
    const open = actionOf(d, rows, loaded);
    if (open?.kind === 'comments') returnedOpen += 1;
    if (open?.kind === 'late') overdue += 1;
    if (state.withOtherSide) {
      awaiting += 1;
      if (state.awaiting !== null) longestWait = Math.max(longestWait ?? 0, state.awaiting);
    } else if (!isFull(percentOf([d], loaded))) {
      withUs += 1;
    }
  }

  return { untouched, returnedOpen, overdue, awaiting, longestWait, withUs };
}

/* ----------------------------------------------------------------- public */

export interface RegisterWeek {
  weekNo: number;
  startDate: string;
  endDate: string;
}

export async function getRegisterWeeks(projectId: string): Promise<RegisterWeek[]> {
  const rows = await db.select().from(schema.weeks).where(eq(schema.weeks.projectId, projectId));
  return rows
    .sort((a, b) => a.weekNo - b.weekNo)
    .map((w) => ({ weekNo: w.weekNo, startDate: w.startDate, endDate: w.endDate }));
}

export async function getRegisterShape(projectId: string, register: RegisterKind): Promise<{
  documents: number; categories: number;
}> {
  const [docs, cats] = await Promise.all([
    db.select().from(schema.documents)
      .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register))),
    db.select().from(schema.docCategories)
      .where(and(eq(schema.docCategories.projectId, projectId), eq(schema.docCategories.register, register))),
  ]);
  return { documents: docs.length, categories: cats.length };
}

export async function getRegisterParties(projectId: string): Promise<{
  clientName: string; contractorName: string;
}> {
  const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  const project = rows[0];
  return { clientName: project?.clientName ?? '', contractorName: project?.contractorName ?? '' };
}

export async function getNumbering(projectId: string, register: RegisterKind): Promise<{
  rule: NumberingRule | null;
  taken: string[];
  suggestedPrefix: string;
}> {
  if (register === 'vdrl') {
    const rows = await db.select().from(schema.documents)
      .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register)));
    const taken = rows.map((d) => d.docNo).filter((n): n is string => Boolean(n));
    return { rule: null, taken, suggestedPrefix: '' };
  }

  const [rowArr, takenDocs, projectRows, numberingRows] = await Promise.all([
    db.select().from(schema.docNumbering)
      .where(and(eq(schema.docNumbering.projectId, projectId), eq(schema.docNumbering.register, register))),
    db.select().from(schema.documents)
      .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register))),
    db.select().from(schema.projects).where(eq(schema.projects.id, projectId)),
    db.select().from(schema.docNumbering)
      .where(and(eq(schema.docNumbering.projectId, projectId), eq(schema.docNumbering.register, register))),
  ]);
  const row = numberingRows[0];
  const taken = takenDocs.map((d) => d.docNo).filter((n): n is string => Boolean(n));
  const project = projectRows[0];

  const parse = (raw: string): Record<string, string> => {
    try {
      const value: unknown = JSON.parse(raw);
      return value && typeof value === 'object' ? value as Record<string, string> : {};
    } catch { return {}; }
  };

  return {
    rule: row
      ? {
        prefix: row.prefix,
        disciplines: parse(row.disciplines),
        types: parse(row.types),
        digits: row.digits,
        area: row.area ?? undefined,
      }
      : null,
    taken,
    suggestedPrefix: detectPrefix(taken)
      ?? (project?.alias?.trim() || project?.docNoPrefix?.split('-')[0]
        || (project ? deriveInitial(project.name) : '')),
  };
}

export interface ExportRow {
  no: string;
  docNo: string;
  title: string;
  kind: string;
  isCategory: boolean;
  stages: { stage: DocStage; submittedAt: string | null; submitTransmittal: string | null;
    returnedAt: string | null; returnTransmittal: string | null; returnCode: string | null }[];
}

export async function getRegisterExportRows(projectId: string, register: RegisterKind): Promise<ExportRow[]> {
  const loaded = await loadRegister(projectId, register);
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
      out.push({
        no: outlineCode(here),
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

export async function getStageWeights(projectId: string, register: RegisterKind): Promise<{
  stage: DocStage; weight: number;
}[]> {
  const rows = await db.select().from(schema.docStageWeights)
    .where(and(
      eq(schema.docStageWeights.projectId, projectId),
      eq(schema.docStageWeights.register, register),
    ));
  return rows
    .sort((a, b) => a.order - b.order)
    .map((w) => ({ stage: w.stage, weight: w.weight }));
}

export async function getRegisterSettings(projectId: string, register: RegisterKind): Promise<RegisterSettings> {
  const [rows, numberingRows] = await Promise.all([
    db.select().from(schema.docStageWeights)
      .where(and(eq(schema.docStageWeights.projectId, projectId), eq(schema.docStageWeights.register, register))),
    db.select().from(schema.docNumbering)
      .where(and(eq(schema.docNumbering.projectId, projectId), eq(schema.docNumbering.register, register))),
  ]);
  const numbering = numberingRows[0];
  const sorted = rows.sort((a, b) => a.order - b.order);
  const shown = sorted.filter((r) => MAIN_STAGES.includes(r.stage) || isAddedStage(r.stage) || r.weight > 0)
    .sort((a, b) => compareStages(a.stage, b.stage));
  const stages = (shown.length ? shown : MAIN_STAGES.map((stage) => ({ stage, weight: undefined, label: null, fullName: null, color: null, revStart: null })))
    .map((r) => {
      const d = defaultStage(r.stage, r.weight ?? undefined);
      return { ...d, label: r.label?.trim() || d.label, name: r.fullName?.trim() || d.name, color: r.color || d.color, revStart: r.revStart ?? d.revStart };
    });
  return { stages, codes: parseCodes(numbering?.codes), area: numbering?.area ?? '' };
}

export async function getNextLetterNumbers(projectId: string, register: RegisterKind): Promise<{ out: string; in: string }> {
  const letters = await db.select().from(schema.transmittals)
    .where(and(eq(schema.transmittals.projectId, projectId), eq(schema.transmittals.register, register)));
  const next = (direction: 'out' | 'in') => {
    let best: { head: string; n: number; width: number } | null = null;
    for (const l of letters) {
      if (l.direction !== direction) continue;
      const m = /^(.*?)(\d+)$/.exec(l.no.trim());
      if (!m) continue;
      const n = Number(m[2]);
      if (!best || n > best.n) best = { head: m[1], n, width: m[2].length };
    }
    return best ? `${best.head}${String(best.n + 1).padStart(best.width, '0')}` : '';
  };
  return { out: next('out'), in: next('in') };
}

export async function getRegisterSummary(
  projectId: string,
  register: RegisterKind,
  week?: number,
): Promise<RegisterSummary | null> {
  const loaded = await loadRegister(projectId, register, week);
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

export async function getRegisterTree(projectId: string, register: RegisterKind, week?: number): Promise<RegisterNode[]> {
  const loaded = await loadRegister(projectId, register, week);
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
    const kids = childrenOf.get(category.id) ?? [];
    const ownDocs = loaded.docsByCategory.get(category.id) ?? [];

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
      own: kids.length > 0 && ownDocs.length > 0
        ? { documents: ownDocs.length, actual: percentOf(ownDocs, loaded), plan: planPercentOf(ownDocs, loaded, loaded.asOfWeek) }
        : null,
      children: kids.map((c) => build(c, depth + 1)),
    };
  };

  return (childrenOf.get(null) ?? []).map((c) => build(c, 0));
}

export async function getObstacles(projectId: string, register: RegisterKind, week?: number): Promise<Obstacle[]> {
  const loaded = await loadRegister(projectId, register, week);
  if (!loaded) return [];

  const categoryName = new Map(loaded.categories.map((c) => [c.id, c.name]));
  const out: Obstacle[] = [];

  for (const doc of loaded.documents) {
    const open = actionOf(doc, loaded.byDoc.get(doc.id) ?? [], loaded);
    if (!open) continue;
    out.push({
      documentId: doc.id,
      docNo: doc.docNo,
      title: doc.title,
      categoryId: doc.categoryId,
      categoryName: categoryName.get(doc.categoryId) ?? '',
      ...open,
    });
  }

  const rank: Record<ObstacleKind, number> = { late: 0, comments: 1, waiting: 2, soon: 3, untouched: 4 };
  return out.sort((a, b) =>
    rank[a.kind] - rank[b.kind]
    || (a.kind === 'soon' ? (a.days ?? 0) - (b.days ?? 0) : (b.days ?? 0) - (a.days ?? 0)));
}

export async function getRegisterLog(
  projectId: string,
  register: RegisterKind,
  limit = 200,
  week?: number,
): Promise<LogEvent[]> {
  const loaded = await loadRegister(projectId, register, week);
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

export async function getRegisterCards(
  projectId: string,
  register: RegisterKind,
  week?: number,
): Promise<Record<string, DocumentCard[]>> {
  const loaded = await loadRegister(projectId, register, week);
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
        const ball = ballOf(rows, loaded);
        const open = ball.latest && !ball.out && ball.latest.returnCode && !isApproved(ball.latest.returnCode)
          ? ball.latest.returnCode : null;
        const next = rows[ball.furthest + 1] ?? null;

        return {
          id: d.id,
          categoryId,
          docNo: d.docNo,
          title: d.title,
          revision: d.revision,
          kind: d.kind,
          pic: d.pic,
          remarks: d.remarks,
          percent: percentOf([d], loaded),
          stage: last?.stage ?? null,
          returnCode: open,
          waiting: last?.submittedAt && !last.returnedAt
            ? daysBetween(last.submittedAt, loaded.asOfDate)
            : null,
          nextStage: next?.stage ?? null,
          plannedAt: next?.planSubmitDate ?? null,
          action: actionOf(d, rows, loaded),
          laps: rows.filter((s) => s.stage.startsWith('RE_') && reachedBy(s, loaded)).length,
          sendNext: sendNextOf(rows, loaded),
          out: (() => {
            if (!ball.out || !ball.latest) return null;
            const since = ball.latest.submittedAt;
            return { stage: ball.latest.stage, since, days: since ? daysBetween(since, loaded.asOfDate) : null };
          })(),
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

const DISCIPLINE_CATEGORY: Record<string, string> = {
  general: 'A',
  process: 'B.1',
  mechanical: 'B.2',
  electrical: 'B.3',
  instrument: 'B.4',
};

export async function getDisciplineLinks(projectId: string, week?: number): Promise<DisciplineLink[]> {
  const loaded = await loadRegister(projectId, 'edl', week);
  if (!loaded) return [];

  const [nodes, allWeeks, recordedRows] = await Promise.all([
    db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.projectId, projectId)),
    db.select().from(schema.weeks).where(eq(schema.weeks.projectId, projectId)),
    db.selectDistinct({ weekId: schema.leafProgress.weekId }).from(schema.leafProgress),
  ]);

  const weeks = allWeeks.sort((a, b) => b.weekNo - a.weekNo);
  const recorded = new Set(recordedRows.map((r) => r.weekId));
  const latestWeek = weeks.find((w) => w.weekNo <= loaded.asOfWeek && recorded.has(w.id))
    ?? weeks.find((w) => recorded.has(w.id))
    ?? null;
  const progressRows = latestWeek
    ? await db.select().from(schema.leafProgress).where(eq(schema.leafProgress.weekId, latestWeek.id))
    : [];
  const progress = new Map(progressRows.map((p) => [p.nodeId, p.cumProgressPct]));

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
          if (!(STAGE_ORDER as DocStage[]).includes(stage)) return null;
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

export async function getWeekMovement(
  projectId: string,
  register: RegisterKind,
  week?: number,
): Promise<WeekMovement | null> {
  const loaded = await loadRegister(projectId, register, week);
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

export async function getEngineeringBridge(projectId: string, week?: number): Promise<EngineeringBridge | null> {
  const [links, loaded] = await Promise.all([
    getDisciplineLinks(projectId, week),
    loadRegister(projectId, 'edl', week),
  ]);
  if (links.length === 0 || !loaded) return null;

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

export async function getAllRegisterWeekNumbers(): Promise<number[]> {
  const rows = await db.select({ weekNo: schema.weeks.weekNo }).from(schema.weeks);
  return rows.map((w) => w.weekNo);
}

/* ------------------------------------------------- what a builder copies */

export async function getRegisterOutline(projectId: string, register: RegisterKind): Promise<OutlineNode[]> {
  const [categories, documents] = await Promise.all([
    db.select().from(schema.docCategories)
      .where(and(eq(schema.docCategories.projectId, projectId), eq(schema.docCategories.register, register))),
    db.select().from(schema.documents)
      .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register))),
  ]);

  categories.sort((a, b) => a.order - b.order);
  documents.sort((a, b) => a.order - b.order);

  const children = new Map<string | null, typeof categories>();
  for (const c of categories) {
    const list = children.get(c.parentId ?? null) ?? [];
    list.push(c);
    children.set(c.parentId ?? null, list);
  }
  const node = (c: (typeof categories)[number]): OutlineNode => ({
    id: c.id,
    name: c.name,
    documents: documents.filter((d) => d.categoryId === c.id).map((d) => ({ title: d.title, kind: kindOf(d.kind) })),
    children: (children.get(c.id) ?? []).map(node),
  });
  return (children.get(null) ?? []).map(node);
}

export async function getRegisterExisting(projectId: string, register: RegisterKind): Promise<ExistingNode[]> {
  const outline = await getRegisterOutline(projectId, register);
  const map = (n: OutlineNode): ExistingNode => {
    const ch = n.children.map(map);
    return { id: n.id, name: n.name, documents: n.documents.length + ch.reduce((sum, c) => sum + c.documents, 0), children: ch };
  };
  return outline.map(map);
}

export async function getRegisterSources(currentProjectId: string, register: RegisterKind): Promise<RegisterSource[]> {
  const [projects, docs, roots] = await Promise.all([
    db.select().from(schema.projects),
    db.select({ projectId: schema.documents.projectId }).from(schema.documents)
      .where(eq(schema.documents.register, register)),
    db.select({ projectId: schema.docCategories.projectId, parentId: schema.docCategories.parentId })
      .from(schema.docCategories).where(eq(schema.docCategories.register, register)),
  ]);

  const rootsFiltered = roots.filter((c) => c.parentId === null);
  return projects
    .filter((p) => p.id !== currentProjectId)
    .map((p) => ({
      projectId: p.id,
      name: p.name,
      documents: docs.filter((d) => d.projectId === p.id).length,
      headings: rootsFiltered.filter((c) => c.projectId === p.id).length,
    }))
    .filter((s) => s.documents > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
