import type { Database } from './types';
import { toISODate, weekOfDate } from './weeks';

/**
 * WHICH WEEK A PROJECT IS CURRENTLY IN — one rule, every project.
 *
 * There used to be two, and which one you got depended on which store your
 * project lived in. db.json kept a number somebody had pinned by pressing "Set
 * as current"; SQLite kept nothing and DERIVED it as "the last week anybody
 * recorded anything", which is 0 on a project that has just been made. That 0
 * then fell through to `max(weeks)`, so a fresh 22-week project opened on week
 * 22 — its final week — and the button that would have fixed it was hidden on
 * everything except the imported project (17 Sep 2026).
 *
 * So the rule is:
 *
 *   1. the week the owner pinned, if it is still a week this project has;
 *   2. otherwise the week that contains TODAY, clamped to the plan;
 *   3. otherwise week 1.
 *
 * Step 2 is why nothing has to be written for this to be right. A plan is a
 * span of dates and "now" is a date, so the answer is already in the project —
 * it just was not being asked. Clamping is what makes it safe either side: a
 * project that has not started yet reads week 1 rather than a negative week,
 * and one that ran past its finish holds at the last week rather than pointing
 * off the end of the plan, which is where the 404s came from.
 *
 * THE PIN STILL WINS, and that is the whole point of keeping it. A report is
 * signed for a week, and a project can sit on that week for a fortnight while
 * it is argued over; a date that quietly moves underneath would be the app
 * overruling the person. `setCurrentWeekAction` is the only writer.
 *
 * `today` is a parameter so callers can be tested, and because a clock read in
 * a render must come AFTER a request read under `cacheComponents` — see
 * AGENTS.md. Every caller here sits behind `getOpenDb()`, which reads the
 * cookie first.
 */
export function currentWeekOf(db: Database, today: Date = new Date()): number {
  const weeks = db.weeks.map((w) => w.week);
  if (weeks.length === 0) return 1;
  const first = Math.min(...weeks);
  const last = Math.max(...weeks);

  const pinned = pinnedWeekOf(db);
  if (pinned !== null && weeks.includes(pinned)) return pinned;

  const anchor = db.project.weekAnchorEndDate;
  if (!anchor) return first;

  const byDate = weekOfDate(anchor, toISODate(today));
  if (byDate < first) return first;
  if (byDate > last) return last;
  // A week number inside the span that no row carries: the grid is contiguous
  // in practice, and falling back to the first week is the honest answer rather
  // than inventing one the picker cannot select.
  return weeks.includes(byDate) ? byDate : first;
}

/**
 * The pinned week, or null.
 *
 * `currentWeekOverride` is what the SQLite side puts here, always a number or
 * null. db.json has no such field, so it comes back `undefined` — and on that
 * side the pin has always been `project.currentWeek` itself, which is what
 * "Set as current" wrote. The two are read the same way; only the field
 * differs, which is why this is one function rather than a fork at every call
 * site.
 */
function pinnedWeekOf(db: Database): number | null {
  const override = db.project.currentWeekOverride;
  if (override !== undefined) return override;
  return db.project.currentWeek || null;
}
