import type { RollupNode } from './rollup';
import type { ChangeLogEntry, LeafSnapshot, Milestone, ProgressMethod, ScheduleItem } from './types';
import type { Worklist } from './worklist';
import { methodOf, totalQty } from './progress';

/**
 * The project as a MAP, which is the third answer to board item 12 and the
 * first one that did not start from the Excel sheet.
 *
 * Two earlier cuts were designed outward from the workbook — its columns, its
 * blocks, its formulas — and both were rejected the same day for being a
 * spreadsheet with the gridlines taken out. The figures were never the problem:
 * they matched the signed PDF to two decimals every time. What was missing was
 * a shape a person could hold: SPK → group → activity, open and close where you
 * stand, one bar and one number per row, and everything about a row in the row
 * itself rather than spread over three screens.
 *
 * THIS MODULE COMPUTES NOTHING. Every figure here already has an origin
 * elsewhere and is carried through unchanged:
 *
 *   percentages      lib/rollup.ts     (`curProgressPct`, `targetWF`, `bobot`)
 *   due / filled in  lib/worklist.ts   (scheduled this week, touched this week)
 *   how it is measured lib/progress.ts (`methodOf`, `totalQty`)
 *
 * Re-deriving any of them here would give the screen its own opinion, and a
 * screen with its own opinion is how a report ends up disagreeing with the
 * site.
 */

/** One step of a milestone ladder, with whether it has been reached. */
export interface MapMilestone {
  id: string;
  label: string;
  weight: number;
  done: boolean;
}

/**
 * Price, dates and the like, which live in SQLite and have no equivalent on the
 * db.json side. Absent is normal — the panel simply does not offer the section.
 */
export interface RowFact {
  price?: number | null;
  start?: string | null;
  finish?: string | null;
}

export type MapKind = 'unit' | 'group' | 'leaf';

export interface MapNode {
  id: string;
  code: string;
  name: string;
  kind: MapKind;
  /** Depth within the map, units at 0. */
  depth: number;
  /** Percent of the whole project this row carries. */
  weight: number;
  /** Where it has actually reached, in its own percent. */
  actualPct: number;
  /** Where the plan says it should be, in its own percent. */
  planPct: number;
  /** Added during this week, in its own percent. */
  weekPct: number;
  /** Plan minus actual. Positive means behind. */
  behindPct: number;
  /** Leaves beneath it, itself included when it is one. */
  leafCount: number;
  /** Leaves the schedule puts in this week. */
  dueCount: number;
  /** Of those, the ones already dealt with. */
  filledCount: number;
  children: MapNode[];

  /* leaf only ------------------------------------------------------------- */
  method?: ProgressMethod;
  qtyDone?: number;
  qtyTotal?: number;
  unit?: string | null;
  milestones?: MapMilestone[];
  price?: number | null;
  startDate?: string | null;
  finishDate?: string | null;
  startWeek?: number | null;
  finishWeek?: number | null;
  /** When someone last recorded anything against it, whatever week. */
  lastTouchedAt?: string | null;
}

export interface OverallMap {
  units: MapNode[];
  /** Leaves the schedule puts in this week, and how many are dealt with. */
  due: number;
  filled: number;
  /** Leaves past their finish week and still short of 100%. */
  stuck: number;
  leaves: number;
  hasSchedule: boolean;
}

/** The percent the plan expects this row to have reached by now. */
function planPctOf(n: RollupNode): number {
  return n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0;
}

/**
 * Zero-weight leaves are milestone ROWS, not work.
 *
 * Every weekly surface in this app hides them, and the map has to agree: a row
 * carrying no weight cannot move a report, so offering it for filling in is
 * asking for work that changes nothing.
 */
function isMilestoneRow(n: RollupNode): boolean {
  return n.children.length === 0 && n.bobot === 0;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function leafDetail(
  node: RollupNode,
  snap: LeafSnapshot | undefined,
  fact: RowFact | undefined,
  sched: ScheduleItem | undefined,
  lastTouchedAt: string | null
): Partial<MapNode> {
  const method = methodOf(node);
  const done = snap?.milestonesDone ?? [];
  return {
    method,
    qtyDone: snap?.qtyDone ?? 0,
    qtyTotal: totalQty(node),
    unit: node.satuan ?? null,
    milestones: (node.milestones ?? []).map((m: Milestone) => ({
      id: m.id,
      label: m.label,
      weight: m.weight,
      done: done.includes(m.id),
    })),
    price: fact?.price ?? null,
    startDate: fact?.start ?? null,
    finishDate: fact?.finish ?? null,
    startWeek: sched?.startWeek ?? null,
    finishWeek: sched?.finishWeek ?? null,
    lastTouchedAt,
  };
}

export function buildOverallMap({
  roots,
  snapshots,
  worklist,
  schedule,
  changeLog,
  facts,
}: {
  roots: RollupNode[];
  snapshots: Record<string, LeafSnapshot> | undefined;
  /** Already built by the page; the map never re-derives what is due. */
  worklist: Worklist;
  schedule: ScheduleItem[] | undefined;
  /** The whole log, for "last touched"; the week's own entries decide `filled`. */
  changeLog: ChangeLogEntry[] | undefined;
  facts?: Record<string, RowFact>;
}): OverallMap {
  const dueIds = new Set<string>([
    ...worklist.due.map((e) => e.node.id),
    ...worklist.done.map((e) => e.node.id),
  ]);
  const filledIds = new Set<string>(worklist.done.map((e) => e.node.id));

  const schedById = new Map<string, ScheduleItem>();
  (schedule ?? []).forEach((s) => schedById.set(s.leafId, s));

  const touchedAt = new Map<string, string>();
  (changeLog ?? []).forEach((c) => {
    const prev = touchedAt.get(c.leafId);
    if (!prev || c.at > prev) touchedAt.set(c.leafId, c.at);
  });

  let leaves = 0;
  let due = 0;
  let filled = 0;

  function walk(node: RollupNode, depth: number): MapNode | null {
    if (isMilestoneRow(node)) return null;

    const kids = node.children.map((c) => walk(c, depth + 1)).filter((c): c is MapNode => c !== null);
    const isLeaf = kids.length === 0;

    const base: MapNode = {
      id: node.id,
      code: node.wbsCode,
      name: node.deskripsi,
      kind: depth === 0 ? 'unit' : isLeaf ? 'leaf' : 'group',
      depth,
      weight: round2(node.bobot),
      actualPct: round2(node.curProgressPct),
      planPct: round2(planPctOf(node)),
      weekPct: round2(node.thisWeekProgressPct),
      behindPct: round2(planPctOf(node) - node.curProgressPct),
      leafCount: isLeaf ? 1 : kids.reduce((s, k) => s + k.leafCount, 0),
      dueCount: isLeaf ? (dueIds.has(node.id) ? 1 : 0) : kids.reduce((s, k) => s + k.dueCount, 0),
      filledCount: isLeaf ? (filledIds.has(node.id) ? 1 : 0) : kids.reduce((s, k) => s + k.filledCount, 0),
      children: kids,
    };

    if (isLeaf) {
      leaves += 1;
      if (base.dueCount) due += 1;
      if (base.filledCount) filled += 1;
      Object.assign(
        base,
        leafDetail(
          node,
          snapshots?.[node.id],
          facts?.[node.id],
          schedById.get(node.id),
          touchedAt.get(node.id) ?? null
        )
      );
    }

    return base;
  }

  /**
   * A SINGLE ROOT IS THE PROJECT, NOT A CONTRACT, so the map opens inside it.
   *
   * Gundih's WBS has one top row — the project's own name — with all 176
   * activities beneath it. Taken literally, the map's first screen was one line
   * reading "176 activities · weight 100.00%", which is a door with nothing
   * written on it: you learn nothing and you have to press it every single
   * time. Descending while there is exactly one row puts the four SPK on the
   * first screen, which is what the map is for. A plan with several top rows is
   * left exactly as it is.
   */
  let top = roots;
  while (top.length === 1 && top[0].children.length > 0) top = top[0].children;

  const units = top.map((r) => walk(r, 0)).filter((u): u is MapNode => u !== null);

  return { units, due, filled, stuck: worklist.stuck.length, leaves, hasSchedule: worklist.hasSchedule };
}

/**
 * Every row that matches, flattened, with the ancestors that lead to it.
 *
 * The search box and the "this week" lens both need the same thing: a set of
 * ids to keep, plus every ancestor of a kept row so the path to it does not
 * vanish underneath it.
 */
export function matchingIds(
  units: MapNode[],
  keep: (n: MapNode) => boolean
): Set<string> {
  const out = new Set<string>();
  function walk(n: MapNode, trail: string[]): boolean {
    const nextTrail = [...trail, n.id];
    let any = keep(n);
    n.children.forEach((c) => {
      if (walk(c, nextTrail)) any = true;
    });
    if (any) nextTrail.forEach((id) => out.add(id));
    return any;
  }
  units.forEach((u) => walk(u, []));
  return out;
}

/**
 * The same tree with one leaf moved, and every ancestor moved with it.
 *
 * THIS IS DISPLAY ONLY, AND IT LASTS SECONDS. The server is still the origin of
 * every percentage: a save calls the action, the action refreshes the route, and
 * the recomputed tree arrives and replaces this. What it buys is the half second
 * in between — without it, filling in nine items on a Friday is nine taps into a
 * screen that does not visibly move, which is exactly what made two earlier cuts
 * of this feel like a chore.
 *
 * The formula is the one `lib/rollup.ts` uses and not a second opinion: a
 * branch's percent is its children's weighted average, because a leaf's
 * weighted factor is `weight × pct / 100` and a branch's is the sum of its
 * children's. Anything else here would be a second origin for a number this app
 * keeps in exactly one place.
 */
export function withOptimistic(units: MapNode[], pending: Record<string, number>): MapNode[] {
  if (!Object.keys(pending).length) return units;

  function walk(n: MapNode): MapNode {
    if (!n.children.length) {
      const next = pending[n.id];
      if (next === undefined) return n;
      return { ...n, actualPct: round2(next), behindPct: round2(n.planPct - next) };
    }
    const children = n.children.map(walk);
    const weight = children.reduce((s, c) => s + c.weight, 0);
    const actualPct = weight > 0
      ? children.reduce((s, c) => s + c.weight * c.actualPct, 0) / weight
      : n.actualPct;
    return {
      ...n,
      children,
      actualPct: round2(actualPct),
      behindPct: round2(n.planPct - actualPct),
    };
  }

  return units.map(walk);
}

/** Ancestors outermost first, for the panel's breadcrumb. */
export function trailOf(units: MapNode[], id: string): MapNode[] {
  let found: MapNode[] | null = null;
  function walk(n: MapNode, trail: MapNode[]) {
    if (found) return;
    if (n.id === id) {
      found = trail;
      return;
    }
    n.children.forEach((c) => walk(c, [...trail, n]));
  }
  units.forEach((u) => walk(u, []));
  return found ?? [];
}

/** The node with this id, wherever it sits. */
export function findNode(units: MapNode[], id: string | null): MapNode | null {
  if (!id) return null;
  let found: MapNode | null = null;
  function walk(n: MapNode) {
    if (found) return;
    if (n.id === id) {
      found = n;
      return;
    }
    n.children.forEach(walk);
  }
  units.forEach(walk);
  return found;
}
