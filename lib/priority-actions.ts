import type { RollupNode } from './rollup';
import type { ScheduleItem } from './types';
import { DUE_SOON_WEEKS, type Worklist } from './worklist';

/**
 * WHAT HAS TO BE DONE IN THE NEXT THREE WEEKS, BY ACTIVITY, RANKED P1 TO P3.
 *
 * The dashboard's Priority Actions card (27 Sep 2026). It replaced two cards:
 * "What is urgent" listed the week's data-quality warnings, which read the same
 * every week, and "What has to happen next" compared the PROJECT total with the
 * next two weeks' plan, so a project ahead of plan read "Reached" twice and
 * named no activity at all. People on site act on activities, not on a
 * project percentage.
 *
 * THE WINDOW is the three weeks after the one being viewed, the same
 * `DUE_SOON_WEEKS` the worklist's "ending soon" uses, so this card and Data
 * Overall's chips always count the same finishes. An unfinished activity gets
 * in on ONE of four grounds, checked in this order:
 *
 *   late    its finish week has passed                     → P1, aims at 100
 *   finish  it finishes this week or inside the window     → P1 if behind plan now,
 *                                                             P2 if on plan; aims at 100
 *   behind  it is running, finishes after the window, and  → P2, aims at the plan
 *           is at least a point short of its plan now         at the window's end
 *   start   it is scheduled to start inside the window     → P3, aims at the plan
 *                                                             at the window's end
 *
 * What stays OUT is as deliberate: an activity running on or ahead of plan is
 * ordinary work, not a priority, and listing it is what turns a priority list
 * into the whole WBS; a finished one; one whose dates lie past the window; and
 * a zero-weight row, which has no plan to fall behind and no progress to report.
 *
 * Late and finish are the worklist's own `stuck` and `soon`, never worked out
 * again here — "past its finish" must mean the same on every screen. Every
 * percentage comes from the rollup. This file only sorts and labels.
 */

/** Same window as the worklist's "ending soon": this week plus the next three. */
export const LOOK_AHEAD_WEEKS = DUE_SOON_WEEKS;

/**
 * Behind plan by less than this is rounding, not a delay. One point of the
 * activity's own percentage: the smallest step the card prints.
 */
const BEHIND_MIN = 1;

export type PriorityLevel = 1 | 2 | 3;
export type PriorityKind = 'late' | 'finish' | 'behind' | 'start';

export interface PriorityAction {
  node: RollupNode;
  /**
   * The heading it sits under, because an activity name alone is ambiguous:
   * the same "Piping Installation" can stand under three contracts. Null at the
   * top level.
   */
  section: string | null;
  level: PriorityLevel;
  kind: PriorityKind;
  /** The finish week (late, finish) or the start week (start). The plan's own week for behind. */
  week: number;
  /** Weeks past its finish. Late only; 0 otherwise. */
  weeksLate: number;
  /** Short of its plan NOW by at least a point. What makes a finish P1. */
  behind: boolean;
  /**
   * Now and where it has to be by the end of the window, as whole percents the
   * way the card prints them. Now is rounded DOWN, so 99.6% reads "99 → 100"
   * and never "100 → 100" on an item that is not finished.
   */
  nowPct: number;
  targetPct: number;
}

export interface PriorityActions {
  /** First and last week of the window. `fromWeek > horizonWeek` on a plan's last week. */
  fromWeek: number;
  horizonWeek: number;
  actions: PriorityAction[];
  /**
   * When nothing is due, the first unfinished thing after the window, so an
   * empty card still says what comes next rather than just "nothing".
   */
  next: { node: RollupNode; kind: 'start' | 'finish'; week: number } | null;
  hasSchedule: boolean;
}

const planPctOf = (n: RollupNode | undefined) => (n && n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0);
/** Finished, to the two decimals every screen prints — the worklist's own test. */
const isComplete = (pct: number) => pct >= 99.995;
/** A hair of float noise must not turn 50% into "49". */
const shownNow = (pct: number) => Math.floor(pct + 1e-6);

function leavesOf(roots: RollupNode[]): RollupNode[] {
  const out: RollupNode[] = [];
  const walk = (n: RollupNode) => (n.children.length ? n.children.forEach(walk) : out.push(n));
  roots.forEach(walk);
  return out;
}

/** Each node's immediate heading, by id. */
function sectionsOf(roots: RollupNode[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (n: RollupNode) =>
    n.children.forEach((c) => {
      out.set(c.id, n.deskripsi);
      walk(c);
    });
  roots.forEach(walk);
  return out;
}

export function buildPriorityActions({
  roots,
  horizonRoots,
  schedule,
  week,
  horizonWeek,
  worklist,
}: {
  /** The rollup of the week being viewed. */
  roots: RollupNode[];
  /** The rollup of `horizonWeek`, for each activity's plan at the window's end. */
  horizonRoots: RollupNode[];
  schedule: ScheduleItem[] | undefined;
  week: number;
  /** `week + LOOK_AHEAD_WEEKS`, cut at the plan's last week. */
  horizonWeek: number;
  /** Built for the same week from the same roots. */
  worklist: Worklist;
}): PriorityActions {
  const planAtHorizon = new Map(leavesOf(horizonRoots).map((n) => [n.id, planPctOf(n)]));
  const byLeaf = new Map((schedule ?? []).map((s) => [s.leafId, s]));
  const sections = sectionsOf(roots);
  const sectionOf = (n: RollupNode) => sections.get(n.id) ?? null;
  const listed = new Set<string>();
  const actions: PriorityAction[] = [];

  const shortfall = (n: RollupNode) => planPctOf(n) - n.curProgressPct;

  for (const s of worklist.stuck) {
    if (s.node.bobot <= 0) continue;
    listed.add(s.node.id);
    actions.push({
      node: s.node,
      section: sectionOf(s.node),
      level: 1,
      kind: 'late',
      week: s.finishWeek,
      weeksLate: s.weeksLate,
      behind: true,
      nowPct: shownNow(s.pct),
      targetPct: 100,
    });
  }

  for (const s of worklist.soon) {
    if (s.node.bobot <= 0) continue;
    listed.add(s.node.id);
    const behind = shortfall(s.node) >= BEHIND_MIN;
    actions.push({
      node: s.node,
      section: sectionOf(s.node),
      level: behind ? 1 : 2,
      kind: 'finish',
      week: s.finishWeek,
      weeksLate: 0,
      behind,
      nowPct: shownNow(s.pct),
      targetPct: 100,
    });
  }

  for (const n of leavesOf(roots)) {
    if (listed.has(n.id) || n.bobot <= 0) continue;
    const s = byLeaf.get(n.id);
    if (!s || isComplete(n.curProgressPct)) continue;
    const nowPct = shownNow(n.curProgressPct);
    const targetPct = Math.round(planAtHorizon.get(n.id) ?? 0);
    if (targetPct <= nowPct) continue;

    if (s.startWeek <= week && s.finishWeek > horizonWeek && shortfall(n) >= BEHIND_MIN) {
      actions.push({ node: n, section: sectionOf(n), level: 2, kind: 'behind', week: s.finishWeek, weeksLate: 0, behind: true, nowPct, targetPct });
    } else if (s.startWeek > week && s.startWeek <= horizonWeek) {
      actions.push({ node: n, section: sectionOf(n), level: 3, kind: 'start', week: s.startWeek, weeksLate: 0, behind: false, nowPct, targetPct });
    }
  }

  // Worst first inside each level, and weighted where it can be: a leaf 20
  // points short carrying 0.5% of the project matters less than one 10 short
  // carrying 12%. Ties fall back to WBS order so the list is stable.
  const kindRank: Record<PriorityKind, number> = { late: 0, finish: 1, behind: 2, start: 3 };
  const remaining = (a: PriorityAction) => a.node.bobot * (a.targetPct - a.node.curProgressPct);
  actions.sort((a, b) => {
    if (a.level !== b.level) return a.level - b.level;
    if (a.kind !== b.kind) return kindRank[a.kind] - kindRank[b.kind];
    const byKind =
      a.kind === 'late'
        ? b.weeksLate - a.weeksLate
        : a.kind === 'behind'
          ? b.node.bobot * shortfall(b.node) - a.node.bobot * shortfall(a.node)
          : a.week - b.week;
    return byKind || remaining(b) - remaining(a) || a.node.order - b.node.order;
  });

  // What comes after the window, for the card to say when nothing is due.
  let next: PriorityActions['next'] = null;
  if (actions.length === 0) {
    for (const n of leavesOf(roots)) {
      const s = byLeaf.get(n.id);
      if (!s || n.bobot <= 0 || isComplete(n.curProgressPct)) continue;
      const cand =
        s.startWeek > horizonWeek
          ? { node: n, kind: 'start' as const, week: s.startWeek }
          : s.finishWeek > horizonWeek
            ? { node: n, kind: 'finish' as const, week: s.finishWeek }
            : null;
      if (!cand) continue;
      if (
        !next ||
        cand.week < next.week ||
        (cand.week === next.week && cand.kind === 'start' && next.kind === 'finish')
      ) {
        next = cand;
      }
    }
  }

  return { fromWeek: week + 1, horizonWeek, actions, next, hasSchedule: worklist.hasSchedule };
}
