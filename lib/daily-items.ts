import type { ActivityItem, DailyReport, ManHourRow } from './types';

// "1. x", "2) x", "- x". The mark must be followed by whitespace so "2.5 m pipe" keeps its number.
const LIST_MARK = /^\s*(?:\d+\s*[.)]|[-•*])(?=\s)\s*/;

export function parseLegacyItems(text: string, prefix: string, done: boolean): ActivityItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_MARK, '').trim())
    .filter(Boolean)
    .map((t, i) => ({ id: `${prefix}-${i + 1}`, text: t, done }));
}

/** What a report says it did today. Legacy text was typed AFTER the fact, so it counts as done. */
export function todayItemsOf(r: Pick<DailyReport, 'todayItems' | 'activitiesToday'>): ActivityItem[] {
  return r.todayItems ?? parseLegacyItems(r.activitiesToday, 'lt', true);
}

export function tomorrowItemsOf(r: Pick<DailyReport, 'tomorrowItems' | 'activitiesTomorrow'>): ActivityItem[] {
  return r.tomorrowItems ?? parseLegacyItems(r.activitiesTomorrow, 'lm', false);
}

export function joinItems(items: ActivityItem[]): string {
  return items.map((it, i) => `${i + 1}. ${it.text}`).join('\n');
}

/**
 * The two legacy strings, derived, so `/print/daily` and old readers keep
 * working. Today prints only what was DONE: an unticked plan is not a fact.
 */
export function activityStrings(today: ActivityItem[], tomorrow: ActivityItem[]) {
  return {
    activitiesToday: joinItems(today.filter((i) => i.done)),
    activitiesTomorrow: joinItems(tomorrow),
  };
}

/** Hours each person worked, when the row divides evenly (the workbook: 24/3, 84/7, 12/1). */
export function inferHoursEach(r: Pick<ManHourRow, 'pobQty' | 'todayHours'>): number | undefined {
  return r.pobQty > 0 && r.todayHours > 0 && r.todayHours % r.pobQty === 0
    ? r.todayHours / r.pobQty
    : undefined;
}

export function hoursEachOf(r: ManHourRow): number {
  return r.hoursEach ?? inferHoursEach(r) ?? 0;
}

/**
 * Sentences this project has already used, newest report first, deduplicated
 * and minus what the open report already holds. Tapping one is the whole cost
 * of an activity that repeats.
 */
export function suggestActivities(reports: DailyReport[], taken: string[], limit = 8): string[] {
  const seen = new Set(taken.map((t) => t.trim().toLowerCase()));
  const out: string[] = [];
  const newestFirst = [...reports].sort((a, b) => b.date.localeCompare(a.date));
  for (const r of newestFirst) {
    for (const it of [...todayItemsOf(r), ...tomorrowItemsOf(r)]) {
      const key = it.text.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(it.text.trim());
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * What "same as yesterday" offers: the sentences of the latest EARLIER report that says
 * what it did (a report made and never filled in is skipped), deduplicated. Not the
 * project's whole history: yesterday's work is what repeats, and a long list of old
 * sentences is a search box, not a suggestion.
 */
export function previousActivities(reports: DailyReport[], date: string): { date: string; items: string[] } | null {
  const earlier = reports.filter((r) => r.date < date).sort((a, b) => b.date.localeCompare(a.date));
  for (const r of earlier) {
    const seen = new Set<string>();
    const items: string[] = [];
    for (const it of todayItemsOf(r)) {
      const text = it.text.trim();
      const key = text.toLowerCase();
      if (!text || seen.has(key)) continue;
      seen.add(key);
      items.push(text);
    }
    if (items.length) return { date: r.date, items };
  }
  return null;
}
