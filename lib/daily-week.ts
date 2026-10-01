import { weekEndDate, weekOfDate, weekStartDate } from './weeks';

const DAY_MS = 86_400_000;

/**
 * The day of the project, counting week one's first day as day 1. Nobody types it:
 * the sheet's "Hari ke-" cell held the same stale number (09/02/2021) in every one of
 * 348 workbooks, so it is computed from the date. Null with no plan, or before week one.
 */
export function dayOfProject(anchorEnd: string, date: string): number | null {
  if (!anchorEnd) return null;
  const days = Math.floor((Date.parse(`${date}T00:00:00Z`) - weekStartDate(anchorEnd, 1).getTime()) / DAY_MS);
  return days >= 0 ? days + 1 : null;
}

/** "Week 40, day 33" for a date, or null when the project has no plan behind it. */
export function weekAndDay(anchorEnd: string, date: string): { week: number; day: number } | null {
  const day = dayOfProject(anchorEnd, date);
  return day === null ? null : { week: weekOfDate(anchorEnd, date), day };
}

// Spelled out rather than Intl's en-GB short month, which writes September as "Sept":
// one month a letter longer than the other eleven made the week list ragged.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

/** "28 Sep to 4 Oct". */
export function weekRangeLabel(anchorEnd: string, week: number): string {
  return `${short(weekStartDate(anchorEnd, week))} to ${short(weekEndDate(anchorEnd, week))}`;
}
