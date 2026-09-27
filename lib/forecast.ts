/**
 * When the project finishes, worked out the way an EPC planner works it out.
 *
 * NOT from the pace of the total. The forecast this replaces divided what was
 * left by the last four weeks' average, and on PHSS Samberah at week 38 it read
 * "week 56, 16 weeks earlier" (27 Sep 2026): the pace was one bulk entry
 * divided by four, and it vanished two weeks later when the window slid past
 * it. The total is weighted by MONEY, too, so 70 points of procurement said
 * nothing about the 2-point commissioning that actually ends the job.
 *
 * So every unfinished activity gets its own finish, counted from the status
 * date; a late predecessor pushes what waits for it; the project finishes when
 * the last one does, and the path that decides it is named. Spec:
 * docs/superpowers/specs/2026-09-27-forecast-epc-design.md.
 *
 * Pure: no database, no React. Percentages arrive already resolved by
 * lib/progress.ts; nothing here computes one.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Within this many days a predecessor still DRIVES what waits for it, so the
 * path runs through it. The weekend-plus-a-day of `MAX_GAP` in lib/chains.ts.
 */
const DRIVING_SLACK_DAYS = 3;

export type ForecastSource = 'vendor' | 'site' | 'client';

/** Where an activity's finish came from. The card counts these along the path. */
export type StepBasis = 'done' | 'typed' | 'measured' | 'plan';

export interface ForecastRung {
  id: string;
  weight: number;
  done: boolean;
}

export interface ForecastLeafInput {
  id: string;
  order: number;
  /** The active baseline's dates, ISO. */
  planStart: string;
  planFinish: string;
  /** 0..100, from lib/progress.ts. */
  pct: number;
  /** The ladder in order, milestone rows only. */
  rungs: ForecastRung[];
  /** Quantity rows only. */
  qty: { total: number; done: number; firstMovedWeekEnd: string | null } | null;
  /** The end of the first week it stood at 100, when it does. */
  finishedAt: string | null;
  /** A date somebody outside the app gave, for one rung or (rungId null) the finish. */
  typed: { date: string; source: ForecastSource; rungId: string | null } | null;
  /** Confirmed links only. */
  waitsFor: string[];
}

export interface LeafForecast {
  id: string;
  /** ISO date. */
  finish: string;
  /** Days its predecessors moved it; 0 or less when nothing did. */
  push: number;
  /** The predecessor holding it, when one is within the driving slack. */
  drivenBy: string | null;
  basis: StepBasis;
  source: ForecastSource | null;
}

export interface ProjectForecast {
  statusDate: string;
  finish: string;
  finishLeafId: string;
  /** The path that sets the finish, first activity to last. */
  chain: string[];
  leaves: Map<string, LeafForecast>;
}

export function dayOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function isoOf(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Share of the ladder's weight still to come after a rung, 0..1. */
function shareAfter(rungs: ForecastRung[], rungId: string | null): number {
  if (rungId === null) return 0;
  const total = rungs.reduce((s, r) => s + r.weight, 0);
  const at = rungs.findIndex((r) => r.id === rungId);
  if (total <= 0 || at < 0) return 0;
  return rungs.slice(at + 1).reduce((s, r) => s + r.weight, 0) / total;
}

/**
 * Quantity per day since the first week anything moved. Averaged over the
 * whole run on purpose: a bulk entry after weeks of silence is still the same
 * quantity over the same weeks. One week is not a rate.
 */
function qtyRatePerDay(qty: NonNullable<ForecastLeafInput['qty']>, statusDay: number): number | null {
  if (!qty.firstMovedWeekEnd || qty.done <= 0 || qty.total <= qty.done) return null;
  const weeks = Math.floor((statusDay - dayOf(qty.firstMovedWeekEnd)) / 7) + 1;
  if (weeks < 2) return null;
  return qty.done / (weeks * 7);
}

export function forecastProject(inputs: ForecastLeafInput[], statusDate: string): ProjectForecast | null {
  if (!inputs.length) return null;
  const byId = new Map(inputs.map((l) => [l.id, l]));
  const D = dayOf(statusDate);
  type Computed = LeafForecast & { day: number };
  const out = new Map<string, Computed>();
  const visiting = new Set<string>();

  const visit = (id: string): Computed | null => {
    const known = out.get(id);
    if (known) return known;
    const leaf = byId.get(id);
    // An unknown id, or a link that closes a loop: that link is ignored.
    if (!leaf || visiting.has(id)) return null;
    visiting.add(id);

    const PS = dayOf(leaf.planStart);
    const PF = dayOf(leaf.planFinish);
    const duration = Math.max(1, PF - PS + 1);

    // How far a predecessor's finish runs past what this activity allowed for:
    // its own planned finish where the two overlap (the offset is kept), the
    // day before this one starts where there is a gap (the gap is float).
    let push = 0;
    let drivenBy: string | null = null;
    let nearest = -Infinity;
    for (const pid of leaf.waitsFor) {
      const pred = visit(pid);
      if (!pred) continue;
      const value = pred.day - Math.max(dayOf(byId.get(pid)!.planFinish), PS - 1);
      push = Math.max(push, value);
      if (value > nearest) {
        nearest = value;
        drivenBy = value >= -DRIVING_SLACK_DAYS ? pid : null;
      }
    }

    const typedRung = leaf.typed?.rungId ? leaf.rungs.find((r) => r.id === leaf.typed!.rungId) : undefined;
    let day: number;
    let basis: StepBasis;
    let source: ForecastSource | null = null;
    if (leaf.pct >= 100) {
      day = leaf.finishedAt ? Math.min(dayOf(leaf.finishedAt), D) : D;
      basis = 'done';
      drivenBy = null;
    } else if (leaf.typed && !typedRung?.done) {
      day = dayOf(leaf.typed.date) + Math.round(shareAfter(leaf.rungs, leaf.typed.rungId) * duration);
      basis = 'typed';
      source = leaf.typed.source;
      drivenBy = null;
    } else if (leaf.pct <= 0) {
      day = Math.max(PS + push, D + 1) + duration - 1;
      basis = 'plan';
    } else {
      const rate = leaf.qty ? qtyRatePerDay(leaf.qty, D) : null;
      if (rate !== null && leaf.qty) {
        day = D + Math.ceil((leaf.qty.total - leaf.qty.done) / rate);
        basis = 'measured';
      } else {
        day = D + Math.round((1 - leaf.pct / 100) * duration);
        basis = 'plan';
      }
      if (push > 0) day = Math.max(day, PF + push);
    }

    visiting.delete(id);
    const result: Computed = { id, finish: isoOf(day), day, push, drivenBy, basis, source };
    out.set(id, result);
    return result;
  };

  for (const l of inputs) visit(l.id);

  // The latest finish; a tie goes to the later row in the plan, which is where
  // an EPC plan puts commissioning and handover.
  let last: Computed | null = null;
  for (const l of [...inputs].sort((a, b) => a.order - b.order)) {
    const f = out.get(l.id)!;
    if (!last || f.day >= last.day) last = f;
  }
  if (!last) return null;

  const chain: string[] = [];
  for (
    let cur: Computed | undefined = last;
    cur && !chain.includes(cur.id);
    cur = cur.drivenBy ? out.get(cur.drivenBy) : undefined
  ) {
    chain.unshift(cur.id);
  }
  return { statusDate, finish: last.finish, finishLeafId: last.id, chain, leaves: out };
}

/**
 * The week a date falls in: the first week whose end is not before it (the
 * rule lib/dashboard-db.ts places a finish by). Past the last week the count
 * goes on in whole weeks, because a forecast late finish has no week row yet.
 */
export function weekContaining(iso: string, weekEnds: { week: number; end: string }[]): number {
  for (const w of weekEnds) if (w.end >= iso) return w.week;
  const last = weekEnds[weekEnds.length - 1];
  return last.week + Math.ceil((dayOf(iso) - dayOf(last.end)) / 7);
}
