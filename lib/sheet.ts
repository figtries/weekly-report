/**
 * The schedule sheet — the reads.
 *
 * One flat, ordered list of rows with a depth on each, which is how Microsoft
 * Project has always shown a plan and how people expect to read one: an outline
 * you scroll, not a tree you unfold twice to find anything.
 *
 * Three rules are enforced here rather than in the UI, because they are about
 * truth rather than presentation.
 *
 * **A summary row's dates are its OWN when it has them, and its children's
 * otherwise.** This was the reverse until 14 Sep 2026 — MS Project's rule, a
 * parent spans its children by definition — and it threw away the one date
 * people actually have. Procurement ran 29 Dec 25 to 28 Mar 27 as a typed row;
 * adding one line inside it moved it to a single day in March, because that is
 * where the first child happened to land, and locked every date cell on the
 * way past. The envelope is the input on this kind of plan: a package is
 * awarded with its dates, and the work inside it is planned to fit. So a branch
 * keeps what it was given, `updateRowDatesAction` refuses any row that would
 * sit outside its box, and the rollup stays for branches that have no dates of
 * their own — an indented row, or any project whose branches were never given
 * any. Gundih is untouched by the change: all 67 of its branches carry stored
 * dates and every one of them already equals the rollup exactly.
 *
 * **The outline code is generated from position.** `1`, `1.1`, `1.1.1` fall out
 * of depth and sibling order, so inserting a row renumbers everything below it
 * without anyone retyping. The imported `wbsCode` is kept alongside because
 * Gundih's own documents refer to it.
 *
 * **Dates come from the ACTIVE baseline only.** The contractual one is claim
 * evidence and no editing surface may reach it; see the design spec.
 */
import { and, asc, eq } from 'drizzle-orm';

import { db, type Db } from './pg';
import * as schema from './schema';
import { inclusiveDays } from './plan-curve';
import { analyseNetwork, type WeekSpan } from './chains';
import { parseLinks, type StoredLink } from './links';

export interface SheetRow {
  id: string;
  /** Whose child this is. The client infers the chain from it — see lib/chains.ts. */
  parentId: string | null;
  /** Generated outline code — `1.2.1`. Not the stored one. */
  code: string;
  /** The code the project was imported with, kept because its documents cite it. */
  wbsCode: string;
  name: string;
  depth: number;
  isLeaf: boolean;
  isMilestone: boolean;
  isReportingUnit: boolean;
  unitLabel: string | null;
  price: number | null;
  bobot: number | null;
  startDate: string | null;
  finishDate: string | null;
  /**
   * "Should be finished before this." Typed on any row, including a summary —
   * the one date a branch owns, because it is a promise rather than an
   * observation. It never moves the span; it is compared against it.
   */
  targetDate: string | null;
  /**
   * How many days past the target the row finishes. Null when either date is
   * missing; zero or negative is not late and is reported as null so that
   * "has a number here" and "is late" are the same question.
   */
  daysLate: number | null;
  /** Calendar days, both ends counted — `inclusiveDays`, the MS Project convention. */
  durationDays: number | null;
  childCount: number;
  /** True when the dates are the span of children rather than this row's own. */
  isSummary: boolean;
  /**
   * Which colour group the row's bar belongs to, or -1 for none.
   */
  colorGroup: number;
  /** The group's name, for the legend. Only set on the row that starts it. */
  groupLabel: string | null;
  /**
   * The nearest reporting unit at or above this row, by id, or null.
   */
  unitId: string | null;
  /** That unit's label, for a rule editor to show without a second lookup. */
  unitName: string | null;
  /**
   * Days this row can slip before the project finish moves, through its links.
   * Null on a group row and on a row not linked through to the finish.
   */
  totalFloat: number | null;
  /** Zero float: delaying this row by a day moves the end of the project. */
  isCritical: boolean;
  /** This row's own links (what it waits for). Null: never asked. Always null on a group row. */
  links: StoredLink[] | null;
  /** The contract's dates for this row, once a contract is locked. */
  contractStart: string | null;
  contractFinish: string | null;
  /** The user's own bar label on this row (an id in bar_view.labels), or null. */
  barLabel: string | null;
}

/** Fixed order, never cycled. A plan with more groups than this shows the rest neutral. */
export const MAX_COLOR_GROUPS = 6;

export interface Sheet {
  rows: SheetRow[];
  /** The active baseline the sheet writes to; null means the project has none yet. */
  baselineId: string | null;
  projectStart: string | null;
  projectFinish: string | null;
  /** Earliest start and latest finish across the rows — the Gantt's own span. */
  spanStart: string | null;
  spanFinish: string | null;
  pricedRows: number;
  /** Set once the plan has been locked as the contract. */
  contract: { lockedAt: string; reason: string | null } | null;
}

export async function getActiveBaselineId(projectId: string): Promise<string | null> {
  const rows = await db
    .select({ id: schema.baselines.id, kind: schema.baselines.kind })
    .from(schema.baselines)
    .where(eq(schema.baselines.projectId, projectId));
  return rows.find((b) => b.kind === 'active')?.id ?? rows[0]?.id ?? null;
}

/** The dates stored against a row itself, both of them or nothing. */
async function ownDates(
  nodeId: string,
  baselineId: string,
  source: Pick<Db, 'select'> = db
): Promise<{ start: string; finish: string } | null> {
  const rows = await source
    .select({ start: schema.nodeSchedules.startDate, finish: schema.nodeSchedules.finishDate })
    .from(schema.nodeSchedules)
    .where(
      and(eq(schema.nodeSchedules.baselineId, baselineId), eq(schema.nodeSchedules.nodeId, nodeId))
    );
  const s = rows[0];
  return s?.start && s?.finish ? { start: s.start, finish: s.finish } : null;
}

/**
 * The dates a row SHOWS — the same answer `getSheet` renders, for one row.
 */
export async function rowSpan(
  nodeId: string,
  baselineId: string
): Promise<{ start: string; finish: string } | null> {
  const own = await ownDates(nodeId, baselineId);
  let start: string | null = own?.start ?? null;
  let finish: string | null = own?.finish ?? null;
  const kids = await db
    .select({ id: schema.wbsNodes.id })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.parentId, nodeId));
  for (const k of kids) {
    const s = await rowSpan(k.id, baselineId);
    if (!s) continue;
    if (!start || s.start < start) start = s.start;
    if (!finish || s.finish > finish) finish = s.finish;
  }
  return start && finish ? { start, finish } : null;
}

/**
 * The nearest row above this one that fences it in.
 */
export type Box = { id: string; name: string; start: string; finish: string };

async function nodeHead(
  id: string,
  source: Pick<Db, 'select'> = db
): Promise<{ parentId: string | null; name: string | null } | undefined> {
  const rows = await source
    .select({ parentId: schema.wbsNodes.parentId, name: schema.wbsNodes.deskripsi })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.id, id));
  return rows[0];
}

/** The fence this row sits in, itself included if it draws one. */
export async function boxAt(nodeId: string, baselineId: string): Promise<Box | null> {
  let cursor: string | null = nodeId;
  for (let hops = 0; cursor && hops < 64; hops += 1) {
    const [own, n]: [
      Awaited<ReturnType<typeof ownDates>>,
      Awaited<ReturnType<typeof nodeHead>>
    ] = await Promise.all([ownDates(cursor, baselineId), nodeHead(cursor)]);
    if (own && n) return { id: cursor, name: n.name ?? '', ...own };
    cursor = n?.parentId ?? null;
  }
  return null;
}

/**
 * A PACKAGE COVERS WHAT IS INSIDE IT, in the stored box and not only on screen.
 */
export async function coverChildren(
  projectId: string,
  baselineId: string,
  tx?: Pick<Db, 'update' | 'select'>
): Promise<number> {
  const src = tx ?? db;
  const nodes = await db
    .select({ id: schema.wbsNodes.id, parentId: schema.wbsNodes.parentId })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(asc(schema.wbsNodes.order));
  if (!nodes.length) return 0;

  const schedRows = await db
    .select({
      nodeId: schema.nodeSchedules.nodeId,
      start: schema.nodeSchedules.startDate,
      finish: schema.nodeSchedules.finishDate,
    })
    .from(schema.nodeSchedules)
    .where(eq(schema.nodeSchedules.baselineId, baselineId));
  const own = new Map<string, { start: string; finish: string }>();
  for (const s of schedRows) {
    if (s.start && s.finish) own.set(s.nodeId, { start: s.start, finish: s.finish });
  }

  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n.id);
    else kids.set(n.parentId, [n.id]);
  }

  const span = new Map<string, { start: string; finish: string }>();
  let widened = 0;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const id = nodes[i].id;
    const box = own.get(id) ?? null;
    let start: string | null = box?.start ?? null;
    let finish: string | null = box?.finish ?? null;
    for (const kid of kids.get(id) ?? []) {
      const s = span.get(kid);
      if (!s) continue;
      if (!start || s.start < start) start = s.start;
      if (!finish || s.finish > finish) finish = s.finish;
    }
    if (start && finish) span.set(id, { start, finish });
    if (!box || !start || !finish) continue;
    if (start === box.start && finish === box.finish) continue;
    await src
      .update(schema.nodeSchedules)
      .set({ startDate: start, finishDate: finish, durationDays: inclusiveDays(start, finish) })
      .where(
        and(
          eq(schema.nodeSchedules.baselineId, baselineId),
          eq(schema.nodeSchedules.nodeId, id)
        )
      );
    own.set(id, { start, finish });
    widened += 1;
  }
  return widened;
}

/** The same fence, for a row that is not allowed to be its own. */
export async function boxAbove(nodeId: string, baselineId: string): Promise<Box | null> {
  const n = await nodeHead(nodeId);
  const parentId = n?.parentId ?? null;
  return parentId ? boxAt(parentId, baselineId) : null;
}

export async function getSheet(projectId: string): Promise<Sheet> {
  const projectRows = await db
    .select({ startDate: schema.projects.startDate, finishDate: schema.projects.finishDate })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const project = projectRows[0];

  const baselineId = await getActiveBaselineId(projectId);

  const nodes = await db
    .select()
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(asc(schema.wbsNodes.order));

  const schedules = baselineId
    ? await db
        .select()
        .from(schema.nodeSchedules)
        .where(eq(schema.nodeSchedules.baselineId, baselineId))
    : [];
  const schedByNode = new Map(schedules.map((s) => [s.nodeId, s]));

  const contractRows = await db
    .select()
    .from(schema.baselines)
    .where(and(eq(schema.baselines.projectId, projectId), eq(schema.baselines.kind, 'contractual')));
  const contractRow = contractRows[0];
  const contractByNode = new Map(
    contractRow
      ? (
          await db
            .select()
            .from(schema.nodeSchedules)
            .where(eq(schema.nodeSchedules.baselineId, contractRow.id))
        ).map((s) => [s.nodeId, s] as const)
      : []
  );

  const childrenOf = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const list = childrenOf.get(key);
    if (list) list.push(n);
    else childrenOf.set(key, [n]);
  }

  const rows: SheetRow[] = [];
  let pricedRows = 0;

  function walk(
    parentId: string | null,
    depth: number,
    prefix: string
  ): { start: string | null; finish: string | null } {
    const kids = childrenOf.get(parentId) ?? [];
    let start: string | null = null;
    let finish: string | null = null;

    kids.forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const index = rows.length;
      const hasChildren = (childrenOf.get(n.id) ?? []).length > 0;

      rows.push({
        id: n.id,
        parentId: n.parentId ?? null,
        code,
        wbsCode: n.wbsCode,
        name: n.deskripsi,
        depth,
        isLeaf: !hasChildren,
        isMilestone: n.isMilestone,
        isReportingUnit: n.isReportingUnit,
        unitLabel: n.unitLabel,
        price: n.price,
        bobot: n.bobot,
        startDate: null,
        finishDate: null,
        targetDate: n.targetDate,
        daysLate: null,
        durationDays: null,
        childCount: (childrenOf.get(n.id) ?? []).length,
        isSummary: hasChildren,
        colorGroup: -1,
        groupLabel: null,
        unitId: null,
        unitName: null,
        totalFloat: null,
        isCritical: false,
        links: hasChildren ? null : parseLinks(n.waitsFor),
        contractStart: contractByNode.get(n.id)?.startDate ?? null,
        contractFinish: contractByNode.get(n.id)?.finishDate ?? null,
        barLabel: n.barLabel ?? null,
      });
      if (n.price != null && n.price > 0) pricedRows += 1;

      let own: { start: string | null; finish: string | null };
      if (hasChildren) {
        const rolled = walk(n.id, depth + 1, code);
        const s = schedByNode.get(n.id);
        own = s?.startDate && s?.finishDate
          ? {
              start: rolled.start && rolled.start < s.startDate ? rolled.start : s.startDate,
              finish: rolled.finish && rolled.finish > s.finishDate ? rolled.finish : s.finishDate,
            }
          : rolled;
      } else {
        const s = schedByNode.get(n.id);
        own = { start: s?.startDate ?? null, finish: s?.finishDate ?? null };
      }

      const row = rows[index];
      row.startDate = own.start;
      row.finishDate = own.finish;
      row.durationDays =
        own.start && own.finish ? inclusiveDays(own.start, own.finish) : null;
      if (row.targetDate && own.finish && own.finish > row.targetDate) {
        row.daysLate = inclusiveDays(row.targetDate, own.finish) - 1;
      }

      if (own.start && (!start || own.start < start)) start = own.start;
      if (own.finish && (!finish || own.finish > finish)) finish = own.finish;
    });

    return { start, finish };
  }

  const span = walk(null, 0, '');
  assignColorGroups(rows, nodes);

  const net = analyseNetwork(rows);
  for (const r of rows) {
    const logic = net.rows.get(r.id);
    if (!logic || r.isSummary) continue;
    r.totalFloat = logic.canSlip;
    r.isCritical = logic.setsProjectFinish;
  }

  return {
    rows,
    baselineId,
    projectStart: project?.startDate ?? null,
    projectFinish: project?.finishDate ?? null,
    spanStart: span.start,
    spanFinish: span.finish,
    pricedRows,
    contract: contractRow ? { lockedAt: contractRow.approvedAt ?? contractRow.createdAt, reason: contractRow.reason } : null,
  };
}

/**
 * Paint each row with the package it belongs to.
 */
function assignColorGroups(rows: SheetRow[], nodes: { id: string; parentId: string | null }[]) {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId ?? null]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  let anchors = rows.filter((r) => r.isReportingUnit);
  if (anchors.length === 0) {
    const roots = rows.filter((r) => r.depth === 0);
    const level = roots.length === 1 ? rows.filter((r) => r.depth === 1) : roots;
    const branches = level.filter((r) => r.isSummary);
    anchors = branches.length >= 3 ? branches : [];
  }

  const groupOf = new Map<string, number>();
  anchors.forEach((a, i) => {
    if (i < MAX_COLOR_GROUPS) groupOf.set(a.id, i);
  });

  const unitOf = new Map<string, { id: string; name: string }>();
  for (const a of rows.filter((r) => r.isReportingUnit)) {
    unitOf.set(a.id, { id: a.id, name: a.unitLabel || a.name });
  }

  for (const row of rows) {
    let cursor: string | null = row.id;
    let seenUnit = false;
    while (cursor) {
      if (!seenUnit) {
        const u = unitOf.get(cursor);
        if (u) {
          row.unitId = u.id;
          row.unitName = u.name;
          seenUnit = true;
        }
      }
      const g = groupOf.get(cursor);
      if (g !== undefined && row.colorGroup === -1) row.colorGroup = g;
      if (seenUnit && row.colorGroup !== -1) break;
      cursor = parentOf.get(cursor) ?? null;
    }
  }

  for (const a of anchors.slice(0, MAX_COLOR_GROUPS)) {
    const row = byId.get(a.id);
    if (row) row.groupLabel = row.unitLabel || row.name;
  }
}

/**
 * The reporting weeks, with the status each one is in.
 */
export async function getWeekSpans(projectId: string): Promise<WeekSpan[]> {
  return db
    .select({
      weekNo: schema.weeks.weekNo,
      startDate: schema.weeks.startDate,
      endDate: schema.weeks.endDate,
      status: schema.weeks.status,
    })
    .from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId))
    .orderBy(asc(schema.weeks.weekNo));
}
