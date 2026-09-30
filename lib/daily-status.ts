import { todayItemsOf, tomorrowItemsOf } from './daily-items';
import type { DailyReport, DailySectionKey, PtwRow } from './types';

export type SectionState = 'ready' | 'same' | 'look' | 'empty';

/**
 * The order the screen lists them in, which is the order somebody on site works
 * through a day (where, what was done, what went wrong), not the order of the
 * client's sheet. Progress is not here: the daily report does not carry a
 * percentage, the weekly report does (the sheet still prints it, see lib/xlsx).
 */
export const SECTION_ORDER: DailySectionKey[] = [
  'weather', 'manHours', 'activities', 'photos', 'hse', 'ptw', 'aoc',
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** OPEN permits whose validity ended before the report's date. */
export function lapsedPermits(report: DailyReport): PtwRow[] {
  return report.ptw.filter(
    (p) => p.status.trim().toUpperCase() === 'OPEN' && ISO.test(p.validity) && p.validity < report.date
  );
}

export function daysLapsed(validity: string, date: string): number {
  return Math.round((Date.parse(date) - Date.parse(validity)) / DAY_MS);
}

/**
 * ONE answer per section, so the header count, the markers and the proof cannot
 * disagree. Nothing is `ready` until a person said so, except what they entered.
 *
 * A report written before the fill-in screen has no `confirmed` at all: its
 * crew, permits, HSE and activities were typed by hand, so they count as
 * confirmed. AOC did not exist, so it is not.
 */
export function sectionStates(report: DailyReport): Record<DailySectionKey, SectionState> {
  const c = report.confirmed ?? { manHours: true, ptw: true, hse: true, activities: true };
  const w = report.weather;
  const anyWeather = w.hujanDeras || w.hujanSedang || w.berawanMendung || w.cerahTerang;
  return {
    weather: anyWeather ? 'ready' : 'look',
    manHours: c.manHours ? 'ready' : report.manHours.some((r) => r.pobQty > 0) ? 'same' : 'empty',
    ptw: lapsedPermits(report).length > 0 ? 'look' : c.ptw ? 'ready' : report.ptw.length > 0 ? 'same' : 'empty',
    hse: c.hse || report.hseInput.some((r) => r.today > 0) ? 'ready' : 'same',
    activities: activitiesDone(report) ? 'ready' : 'empty',
    aoc: c.aoc || report.aocNone || (report.aoc ?? []).length > 0 ? 'ready' : 'empty',
    photos: report.photos.some(Boolean) ? 'ready' : 'empty',
  };
}

/**
 * Work has no Confirm (1 Oct 2026): it is ready when something done today is ticked and
 * tomorrow has a plan. Until then it is simply not ready yet, never a warning: a warning
 * shown before anyone has done anything was rejected. The only warning is pressing Add
 * on an empty box (ActivitiesSection).
 */
export function activitiesDone(report: DailyReport): boolean {
  return todayItemsOf(report).some((i) => i.done) && tomorrowItemsOf(report).length > 0;
}

export function readyCount(states: Record<DailySectionKey, SectionState>): number {
  return SECTION_ORDER.filter((k) => states[k] === 'ready').length;
}
