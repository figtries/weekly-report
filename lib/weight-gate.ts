import type { WbsItem } from './types';

/**
 * NO FIGURE UNTIL THE WEIGHTS CLOSE (26 Sep 2026).
 *
 * Every progress percentage is a share of the total weight. While that total is
 * 70.79% the app can still divide, and it did — in two different ways on two
 * screens, which is how one week read 51.09 / 34.98 / +16.11 on the dashboard
 * and 51.09 / 24.76 / 11.40 on Data Overall. The user's ruling: a figure built
 * on half-finished weights is a guess, so nothing is shown until they close.
 *
 * Two conditions, both needed. The total must be 100 (the tolerance
 * `validateWeek` has always used), AND every activity must carry weight: a
 * total can close with a finished activity weighing nothing — Kickoff was 100%
 * done and counted for 0. Milestones are the one exception; weighing nothing is
 * what a milestone is.
 *
 * Filling in progress is NOT gated. Site facts are recorded regardless, and
 * every figure appears from them the moment this passes.
 */
export const WEIGHT_TOLERANCE = 0.01;

export interface UnbudgetedRow {
  id: string;
  code: string;
  name: string;
}

export interface WeightGate {
  ok: boolean;
  /** What the leaf weights add up to now. */
  total: number;
  /** Activities (not milestones) that weigh nothing, in plan order. */
  unbudgeted: UnbudgetedRow[];
}

export function weightGate(items: WbsItem[]): WeightGate {
  const parents = new Set(items.map((i) => i.parentId).filter((p): p is string => !!p));
  const leaves = [...items].filter((i) => !parents.has(i.id)).sort((a, b) => a.order - b.order);
  const total = leaves.reduce((s, l) => s + (l.bobot > 0 ? l.bobot : 0), 0);
  const unbudgeted = leaves
    .filter((l) => !(l.bobot > 0) && !l.isMilestone)
    .map((l) => ({ id: l.id, code: l.wbsCode, name: l.deskripsi }));
  return {
    ok: Math.abs(total - 100) <= WEIGHT_TOLERANCE && unbudgeted.length === 0,
    total,
    unbudgeted,
  };
}
