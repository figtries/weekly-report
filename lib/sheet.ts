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

import { db, schema } from './sqlite';
import { inclusiveDays } from './plan-curve';
import { computeFloat, inferChains, type ChainNode, type WeekSpan } from './chains';

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
   *
   * Colour here does a job rather than decorating: it says WHICH PACKAGE a bar
   * belongs to, so a plan of hundreds of rows can be read as a handful of
   * streams running alongside each other. The group is the nearest reporting
   * unit above the row — SPK-002, SPK-003 and so on — because that is the
   * division the client's own report is built from. A project with no units
   * falls back to its top-level branches.
   *
   * Rows outside every group keep -1 and are drawn neutral. Groups are assigned
   * in document order and never cycled: past the palette's length they become
   * -1 too, rather than repeating a hue and claiming two packages are one.
   */
  colorGroup: number;
  /** The group's name, for the legend. Only set on the row that starts it. */
  groupLabel: string | null;
  /**
   * The nearest reporting unit at or above this row, by id, or null.
   *
   * `colorGroup` answers the same question as an index into a palette, which is
   * fine for painting and useless for a rule: a bar style that says "inside
   * SPK-007" must survive another unit being marked above it. This is the
   * durable answer, and the one `lib/bar-styles.ts` matches on.
   */
  unitId: string | null;
  /** That unit's label, for a rule editor to show without a second lookup. */
  unitName: string | null;
  /**
   * Days this row could slip before the project's own finish moves, on the
   * chain inferred from the dates. Null on a summary, whose dates are its
   * children's and which therefore has no float of its own.
   */
  totalFloat: number | null;
  /** Zero float: delaying this row by a day moves the end of the project. */
  isCritical: boolean;
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
}

export function getActiveBaselineId(projectId: string): string | null {
  const rows = db
    .select({ id: schema.baselines.id, kind: schema.baselines.kind })
    .from(schema.baselines)
    .where(eq(schema.baselines.projectId, projectId))
    .all();
  return rows.find((b) => b.kind === 'active')?.id ?? rows[0]?.id ?? null;
}

/** The dates stored against a row itself, both of them or nothing. */
function ownDates(nodeId: string, baselineId: string): { start: string; finish: string } | null {
  const s = db
    .select({ start: schema.nodeSchedules.startDate, finish: schema.nodeSchedules.finishDate })
    .from(schema.nodeSchedules)
    .where(
      and(eq(schema.nodeSchedules.baselineId, baselineId), eq(schema.nodeSchedules.nodeId, nodeId))
    )
    .all()[0];
  return s?.start && s?.finish ? { start: s.start, finish: s.finish } : null;
}

/**
 * The dates a row SHOWS — the same answer `getSheet` renders, for one row.
 *
 * Its own box widened to cover whatever is underneath it, which for a leaf is
 * simply its own dates and for a branch with none is its children's span. The
 * writers ask this rather than reading `node_schedules` directly, so that "does
 * this fit inside its parent" is decided against what is on the screen and not
 * against a value the screen never shows. The FENCE is a different question and
 * a stricter one — see `boxAt`.
 */
export function rowSpan(nodeId: string, baselineId: string): { start: string; finish: string } | null {
  const own = ownDates(nodeId, baselineId);
  let start: string | null = own?.start ?? null;
  let finish: string | null = own?.finish ?? null;
  const kids = db
    .select({ id: schema.wbsNodes.id })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.parentId, nodeId))
    .all();
  for (const k of kids) {
    const s = rowSpan(k.id, baselineId);
    if (!s) continue;
    if (!start || s.start < start) start = s.start;
    if (!finish || s.finish > finish) finish = s.finish;
  }
  return start && finish ? { start, finish } : null;
}

/**
 * The nearest row above this one that fences it in.
 *
 * Not simply the parent: a branch that was never given dates of its own has
 * nothing to fence anything with, and the promise that matters is the one
 * further up that somebody actually typed. Returns the row's name too, because
 * a refusal that cannot say WHICH row it is protecting is a refusal nobody can
 * act on.
 */
export type Box = { id: string; name: string; start: string; finish: string };

function nodeHead(id: string) {
  return db
    .select({ parentId: schema.wbsNodes.parentId, name: schema.wbsNodes.deskripsi })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.id, id))
    .all()[0];
}

/** The fence this row sits in, itself included if it draws one. */
export function boxAt(nodeId: string, baselineId: string): Box | null {
  let cursor: string | null = nodeId;
  // Depth is small, but a cycle in the tree would hang the request rather than
  // fail it, and this runs inside a write.
  for (let hops = 0; cursor && hops < 64; hops += 1) {
    const own = ownDates(cursor, baselineId);
    const n = nodeHead(cursor);
    if (own && n) return { id: cursor, name: n.name, ...own };
    cursor = n?.parentId ?? null;
  }
  return null;
}

/** The same fence, for a row that is not allowed to be its own. */
export function boxAbove(nodeId: string, baselineId: string): Box | null {
  const parentId = nodeHead(nodeId)?.parentId ?? null;
  return parentId ? boxAt(parentId, baselineId) : null;
}

export function getSheet(projectId: string): Sheet {
  const project = db
    .select({ startDate: schema.projects.startDate, finishDate: schema.projects.finishDate })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];

  const baselineId = getActiveBaselineId(projectId);

  const nodes = db
    .select()
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(asc(schema.wbsNodes.order))
    .all();

  const schedules = baselineId
    ? db
        .select()
        .from(schema.nodeSchedules)
        .where(eq(schema.nodeSchedules.baselineId, baselineId))
        .all()
    : [];
  const schedByNode = new Map(schedules.map((s) => [s.nodeId, s]));

  const childrenOf = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const list = childrenOf.get(key);
    if (list) list.push(n);
    else childrenOf.set(key, [n]);
  }

  const rows: SheetRow[] = [];
  let pricedRows = 0;

  // Depth-first, in sibling order, generating the outline code as we descend.
  // Returns the subtree's span so a parent can take it without a second pass.
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

      // Placeholder — a summary's dates are only known after its children are
      // walked, and its children must sit directly beneath it in the list.
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
      });
      if (n.price != null && n.price > 0) pricedRows += 1;

      let own: { start: string | null; finish: string | null };
      if (hasChildren) {
        // The children are walked either way — that is what builds their rows.
        // What the branch SHOWS is its own box WIDENED to cover them: the box
        // is the promise, and a bar that does not reach its own children is a
        // drawing of something that is not happening. Typed dates are fenced
        // into the box by `updateRowDatesAction`, so the two agree except where
        // a row was indented in from outside — and there the picture tells the
        // truth while the promise stays what it was.
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
      // Late by however many days the finish sits past the target. Not late is
      // null rather than 0, so a caller never has to ask which of the two it
      // is looking at.
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

  // Criticality, from the chain the dates already describe. Inferred rather
  // than stored — see lib/chains.ts — so it costs one pass and can never go
  // stale against the dates it came from.
  const chainNodes: ChainNode[] = rows.map((r, i) => ({
    id: r.id,
    parentId: r.parentId,
    order: i,
    isLeaf: r.isLeaf,
    startDate: r.startDate,
    finishDate: r.finishDate,
  }));
  const floats = computeFloat(chainNodes, inferChains(chainNodes));
  for (const r of rows) {
    const f = floats.get(r.id);
    if (!f || r.isSummary) continue;
    r.totalFloat = f.totalFloat;
    r.isCritical = f.isCritical;
  }

  return {
    rows,
    baselineId,
    projectStart: project?.startDate ?? null,
    projectFinish: project?.finishDate ?? null,
    spanStart: span.start,
    spanFinish: span.finish,
    pricedRows,
  };
}

/**
 * Paint each row with the package it belongs to.
 *
 * The grouping is the nearest REPORTING UNIT above a row, because that is the
 * division the client's report is already built from — colouring by depth or by
 * position would draw a rainbow that means nothing. A project that has marked
 * no units yet falls back to its top-level branches, which is the same idea one
 * level up.
 *
 * Groups are numbered in document order and never cycled. Beyond the palette a
 * row goes neutral instead of repeating a hue, because a repeated hue says two
 * packages are the same package.
 */
function assignColorGroups(rows: SheetRow[], nodes: { id: string; parentId: string | null }[]) {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId ?? null]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  let anchors = rows.filter((r) => r.isReportingUnit);
  if (anchors.length === 0) {
    // No units marked. Use the top-level branches — but if the whole plan hangs
    // off one root, that root is the plan itself and colouring it paints
    // everything the same; go one level down instead.
    const roots = rows.filter((r) => r.depth === 0);
    const level = roots.length === 1 ? rows.filter((r) => r.depth === 1) : roots;
    // A package is a BRANCH. This used to count rows, so a plan of four
    // top-level rows — three of them ordinary tasks — was handed four separate
    // hues, one per row, and colour stopped meaning anything at all. A leaf is
    // a job, not a package, and colouring it as one is the "noise wearing the
    // costume of meaning" this guard was written to prevent.
    const branches = level.filter((r) => r.isSummary);
    anchors = branches.length >= 3 ? branches : [];
  }

  const groupOf = new Map<string, number>();
  anchors.forEach((a, i) => {
    if (i < MAX_COLOR_GROUPS) groupOf.set(a.id, i);
  });

  // Membership is tracked by ID as well as by palette index. The index is for
  // painting and shifts whenever a unit is added above; the id is what a bar
  // style rule stores, and it does not move.
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
 *
 * The sheet needs these because the plan curve is DERIVED from the dates: moving
 * a date today changes the planned figure for a week that may have been approved
 * last month. It never refuses the edit — a schedule that cannot be revised gets
 * revised in Excel instead — but it says which weeks moved and which of them had
 * already been signed. See `weeksTouched` in lib/chains.ts.
 */
export function getWeekSpans(projectId: string): WeekSpan[] {
  return db
    .select({
      weekNo: schema.weeks.weekNo,
      startDate: schema.weeks.startDate,
      endDate: schema.weeks.endDate,
      status: schema.weeks.status,
    })
    .from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId))
    .orderBy(asc(schema.weeks.weekNo))
    .all();
}
