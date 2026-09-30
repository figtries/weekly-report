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

const itemKey = (s: string) => s.trim().toLowerCase();

/**
 * Today's list with the previous report's "Tomorrow" folded in: what was planned
 * yesterday is on today's list, unticked, without anybody typing it twice.
 *
 * A planned item follows the plan while it is only a plan: taken off yesterday's
 * Tomorrow, it leaves today's list too. Once ticked it is a fact and stays. An item
 * the person removed from today (`declined`) is not put back, and their own items are
 * never touched. The same input always gives the same list (ids come from the text),
 * so running it on every read and every write converges instead of piling up.
 */
export function planInto(plan: ActivityItem[], today: ActivityItem[], declined: string[] = []): ActivityItem[] {
  const planned = new Set(plan.map((p) => itemKey(p.text)).filter(Boolean));
  const kept = today.filter((it) => !it.fromPlan || it.done || planned.has(itemKey(it.text)));
  const have = new Set(kept.map((it) => itemKey(it.text)));
  const no = new Set(declined.map(itemKey));
  const added: ActivityItem[] = [];
  for (const p of plan) {
    const k = itemKey(p.text);
    if (!k || have.has(k) || no.has(k)) continue;
    have.add(k);
    added.push({ id: `plan-${k}`, text: p.text.trim(), done: false, fromPlan: true });
  }
  return [...kept, ...added];
}

export function sameItems(a: ActivityItem[], b: ActivityItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => x.id === b[i].id && x.text === b[i].text && x.done === b[i].done && !!x.fromPlan === !!b[i].fromPlan)
  );
}

/** The latest report before `date`, and the earliest after it: a gap (a weekend) is still "the day before". */
export function reportBefore(reports: DailyReport[], date: string): DailyReport | undefined {
  let best: DailyReport | undefined;
  for (const r of reports) if (r.date < date && (!best || r.date > best.date)) best = r;
  return best;
}

export function reportAfter(reports: DailyReport[], date: string): DailyReport | undefined {
  let best: DailyReport | undefined;
  for (const r of reports) if (r.date > date && (!best || r.date < best.date)) best = r;
  return best;
}

/**
 * The report with the day before's plan on its Today list. Returns the SAME object when
 * nothing changes, so a caller can tell. Read by the report page (a day made before the
 * plan was typed still shows it) and by every write (so the store catches up).
 */
export function withPlan(reports: DailyReport[], report: DailyReport): DailyReport {
  const prev = reportBefore(reports, report.date);
  if (!prev) return report;
  const today = todayItemsOf(report);
  const merged = planInto(tomorrowItemsOf(prev), today, report.declinedPlan);
  return sameItems(today, merged) ? report : { ...report, todayItems: merged };
}
