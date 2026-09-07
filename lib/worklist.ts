import type { RollupNode } from './rollup';
import type { ChangeLogEntry, ScheduleItem } from './types';

/**
 * What one person has to fill in for one week.
 *
 * The Update screen used to be a folder browser over all 285 rows: open a
 * contract, drill to the item, fill it in, climb back out. With 89 activities
 * under a single SPK that is a lot of navigating to find the handful of items
 * that actually moved, and nothing on screen said which handful that was.
 *
 * SO THE QUEUE IS BUILT FROM THE SCHEDULE, NOT FROM PROGRESS. Measured on the
 * Gundih data, the three candidate rules come out like this:
 *
 *     rule                                W20    W43    W60
 *     scheduled this week                  12      3      3     ← this one
 *     scheduled OR unfinished             133     28     28
 *     scheduled OR overdue                 75     47     68
 *
 * "Unfinished" re-imports the problem the queue exists to solve: 133 of 176
 * leaves sit part-done mid-project, so that rule asks someone to review almost
 * the whole WBS every Friday. Scheduled-only averages 8.8 items a week across
 * the project and never exceeds 25.
 *
 * The items it leaves out are not dropped — `stuck` collects everything whose
 * scheduled finish has passed while it is still short of 100% (44 of them at
 * W43). That is not a Friday to-do list, it is a project problem, so it
 * surfaces as a warning pointing at the Review page rather than as work handed
 * to whoever is filling in the week.
 */

/** A leaf the schedule says should be worked on this week. */
export interface WorklistEntry {
  node: RollupNode;
  /** Ancestors outermost first, e.g. ['Pekerjaan Instalasi… (SPK-003)', 'Piping']. */
  trail: string[];
  /** Which week of its own span this is, and how long the span runs. */
  weekOfSpan: number;
  spanWeeks: number;
  /** Plan percent minus actual percent for this leaf. Positive means behind. */
  behindPct: number;
  /** Someone recorded something against this leaf during this week. */
  touched: boolean;
}

/** A leaf whose scheduled finish has passed while it is still short of 100%. */
export interface StuckEntry {
  node: RollupNode;
  finishWeek: number;
  weeksLate: number;
  pct: number;
}

export interface Worklist {
  /** Scheduled this week, nothing recorded yet — the actual queue. */
  due: WorklistEntry[];
  /** Scheduled this week and already dealt with. */
  done: WorklistEntry[];
  /** Past its finish week and unfinished. Warned about, never queued. */
  stuck: StuckEntry[];
  /**
   * False when the project has no schedule at all. The screen has to say so
   * rather than show an empty queue — "nothing to do this week" and "we don't
   * know what is due" must not look the same.
   */
  hasSchedule: boolean;
}

/** Zero-weight leaves are milestone rows, not work — every weekly UI hides them. */
function isMilestoneRow(n: RollupNode): boolean {
  return n.children.length === 0 && n.bobot === 0;
}

/** The percent the plan expects this leaf to have reached by now. */
function planPctOf(n: RollupNode): number {
  return n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0;
}

export function buildWorklist({
  roots,
  schedule,
  week,
  changeLog,
}: {
  roots: RollupNode[];
  schedule: ScheduleItem[] | undefined;
  week: number;
  /** The whole log; this filters to the week itself. */
  changeLog: ChangeLogEntry[] | undefined;
}): Worklist {
  const byLeaf = new Map<string, ScheduleItem>();
  for (const s of schedule ?? []) byLeaf.set(s.leafId, s);

  const touchedIds = new Set(
    (changeLog ?? []).filter((c) => c.week === week).map((c) => c.leafId)
  );

  const due: WorklistEntry[] = [];
  const done: WorklistEntry[] = [];
  const stuck: StuckEntry[] = [];

  // The trail is collected on the way down so a card can say which contract it
  // belongs to — without it the queue is a flat list of activity names, and
  // "Piping Installation" appears under three different SPKs.
  const visit = (node: RollupNode, trail: string[]) => {
    if (node.children.length > 0) {
      const next = [...trail, node.deskripsi];
      node.children.forEach((c) => visit(c, next));
      return;
    }
    if (isMilestoneRow(node)) return;

    const s = byLeaf.get(node.id);
    if (!s) return;

    const pct = node.curProgressPct;

    if (s.startWeek <= week && s.finishWeek >= week) {
      const entry: WorklistEntry = {
        node,
        trail,
        weekOfSpan: week - s.startWeek + 1,
        spanWeeks: s.finishWeek - s.startWeek + 1,
        behindPct: planPctOf(node) - pct,
        touched: touchedIds.has(node.id),
      };
      (entry.touched ? done : due).push(entry);
      return;
    }

    if (s.finishWeek < week && pct < 100) {
      stuck.push({ node, finishWeek: s.finishWeek, weeksLate: week - s.finishWeek, pct });
    }
  };

  roots.forEach((r) => visit(r, []));

  // Worst first, and "worst" has to be weighted: a leaf 40% behind carrying
  // 0.03% of the project matters less than one 12% behind carrying 4%. Ties
  // fall back to WBS order so the list is stable between renders.
  const bySeverity = (a: WorklistEntry, b: WorklistEntry) =>
    b.behindPct * b.node.bobot - a.behindPct * a.node.bobot || a.node.order - b.node.order;

  due.sort(bySeverity);
  done.sort(bySeverity);
  stuck.sort((a, b) => b.weeksLate * b.node.bobot - a.weeksLate * a.node.bobot || a.node.order - b.node.order);

  return { due, done, stuck, hasSchedule: byLeaf.size > 0 };
}
