/**
 * The plan curve, derived rather than stored.
 *
 * A leaf spreads linearly across its own duration — that is what MS Project
 * does, and reading the Gundih workbook back confirms it exactly: the IFR leaf
 * (45 days from 27 Oct 2025) reports 4/45, 11/45 and 18/45 at the ends of its
 * first three weeks, then climbs 1/45 a day. The S shape of the project curve
 * is not drawn into any single item; it emerges from hundreds of leaves whose
 * start and finish dates overlap.
 *
 * Which is why `node_schedules` stores three numbers per leaf and nothing else.
 * A schedule revision is a date change, and a stale curve is impossible.
 *
 * Note this replaces the smoothstep in the old `generatePlanCurve`. A
 * smoothstep lands an item on exactly 1.0 at its finish week too, but it does
 * not agree with the client's own schedule tool week by week — and the weekly
 * plan figure is a number the client checks.
 */

const MS_PER_DAY = 86_400_000;

/** Calendar days, inclusive of both ends — `duration` in every EPC schedule. */
export function inclusiveDays(startISO: string, finishISO: string): number {
  return Math.round((utc(finishISO) - utc(startISO)) / MS_PER_DAY) + 1;
}

function utc(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * How far a leaf is meant to have got by the end of `asOfISO`, 0..1.
 *
 * Before it starts it is 0; after it finishes it is exactly 1. The second half
 * matters: a curve that only asymptotes leaves every item at 99.x% forever and
 * leaks a permanent phantom deviation into the project total.
 */
export function leafPlanFraction(startISO: string, finishISO: string, asOfISO: string): number {
  const duration = inclusiveDays(startISO, finishISO);
  if (duration <= 0) return asOfISO >= finishISO ? 1 : 0;

  const elapsed = Math.round((utc(asOfISO) - utc(startISO)) / MS_PER_DAY) + 1;
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 1;
  return elapsed / duration;
}

/** The same thing across a run of week-ending dates. */
export function leafPlanSeries(startISO: string, finishISO: string, weekEndsISO: string[]): number[] {
  return weekEndsISO.map((end) => leafPlanFraction(startISO, finishISO, end));
}

export interface PlannedLeaf {
  nodeId: string;
  /** Share of whatever total is being rolled up, 0..100. */
  bobot: number;
  startDate: string;
  finishDate: string;
}

/**
 * Cumulative planned percent of a whole tree at each week end, 0..100.
 *
 * 305 leaves across 60 weeks is 18,300 multiplications — a few milliseconds,
 * which is the whole argument for not storing any of it.
 */
export function planCurve(leaves: PlannedLeaf[], weekEndsISO: string[]): number[] {
  const cum = new Array<number>(weekEndsISO.length).fill(0);
  for (const leaf of leaves) {
    const duration = inclusiveDays(leaf.startDate, leaf.finishDate);
    if (duration <= 0) continue;
    const startMs = utc(leaf.startDate);
    for (let i = 0; i < weekEndsISO.length; i++) {
      const elapsed = Math.round((utc(weekEndsISO[i]) - startMs) / MS_PER_DAY) + 1;
      const f = elapsed <= 0 ? 0 : elapsed >= duration ? 1 : elapsed / duration;
      cum[i] += leaf.bobot * f;
    }
  }
  return cum;
}

/** Week-over-week increments — the `PLAN` row that sits above `CUM. PLAN`. */
export function weeklyIncrements(cumulative: number[]): number[] {
  return cumulative.map((v, i) => (i === 0 ? v : v - cumulative[i - 1]));
}
