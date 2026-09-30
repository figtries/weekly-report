import { shownDiff } from './figures';
import { weekOfDate } from './weeks';

/** The slice of `OpenProjectStatus` (lib/data.ts) this needs, so nothing client-side imports the data layer. */
export interface ProjectStatusLike {
  week: number;
  ready: boolean;
  weightsTotal: number;
  /** Week ONE's end date, as `weekOfDate` expects. */
  anchorEnd: string;
  byWeek: Record<number, { actual: number; plan: number }>;
}

export interface DailyProgress {
  state: 'ready' | 'held';
  week: number;
  actual: number;
  plan: number;
  variance: number;
  weightsTotal: number;
}

/**
 * A daily report does not ask for a percentage: what matters is the weekly
 * figure, so the day reads the week it falls in, and never a week beyond the
 * project's current one. While the weights do not close there is no figure
 * (lib/weight-gate.ts), the same rule as every other surface.
 */
export function dailyProgressFor(status: ProjectStatusLike | null, date: string): DailyProgress | null {
  if (!status) return null;
  if (!status.ready) {
    return { state: 'held', week: status.week, actual: 0, plan: 0, variance: 0, weightsTotal: status.weightsTotal };
  }
  const raw = status.anchorEnd ? weekOfDate(status.anchorEnd, date) : status.week;
  const week = Math.max(1, Math.min(raw, status.week));
  const fig = status.byWeek[week] ?? status.byWeek[status.week];
  if (!fig) return null;
  return {
    state: 'ready',
    week,
    actual: fig.actual,
    plan: fig.plan,
    variance: shownDiff(fig.actual, fig.plan),
    weightsTotal: status.weightsTotal,
  };
}
