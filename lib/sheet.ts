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
 * **A summary row's dates are COMPUTED from its children, never read from
 * storage.** MS Project lets you type a duration onto a summary; it silently
 * stops rolling up, and from then on the schedule lies. Gundih's database does
 * hold rows in `node_schedules` for all 67 of its branches, and they are simply
 * ignored — a parent spans its children by definition, so there is nothing for
 * a stored value to be right about.
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

export interface SheetRow {
  id: string;
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
  /** Calendar days, both ends counted — `inclusiveDays`, the MS Project convention. */
  durationDays: number | null;
  childCount: number;
  /** True when the dates are the span of children rather than this row's own. */
  isSummary: boolean;
}

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
        durationDays: null,
        childCount: (childrenOf.get(n.id) ?? []).length,
        isSummary: hasChildren,
      });
      if (n.price != null && n.price > 0) pricedRows += 1;

      let own: { start: string | null; finish: string | null };
      if (hasChildren) {
        own = walk(n.id, depth + 1, code);
      } else {
        const s = schedByNode.get(n.id);
        own = { start: s?.startDate ?? null, finish: s?.finishDate ?? null };
      }

      const row = rows[index];
      row.startDate = own.start;
      row.finishDate = own.finish;
      row.durationDays =
        own.start && own.finish ? inclusiveDays(own.start, own.finish) : null;

      if (own.start && (!start || own.start < start)) start = own.start;
      if (own.finish && (!finish || own.finish > finish)) finish = own.finish;
    });

    return { start, finish };
  }

  const span = walk(null, 0, '');

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
