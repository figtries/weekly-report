/**
 * The forecast's inputs, read off the same `Database` every other figure reads,
 * so the forecast cannot disagree with the report about what is done: each
 * percentage through lib/progress.ts, each date from the active baseline via
 * `schedule` (lib/dashboard-db.ts carries the ISO dates since 27 Sep 2026).
 */
import { forecastProject, weekContaining, type ForecastLeafInput, type ProjectForecast } from './forecast';
import { resolveLeafProgress, totalQty } from './progress';
import type { Database } from './types';

export interface ForecastRead {
  forecast: ProjectForecast;
  finishWeek: number;
}

export function forecastFromDb(db: Database, week: number): ForecastRead | null {
  const weeks = [...db.weeks].sort((a, b) => a.week - b.week);
  const meta = weeks.find((w) => w.week === week);
  if (!meta) return null;
  const parents = new Set(db.wbsItems.map((i) => i.parentId).filter((p): p is string => !!p));
  const dates = new Map((db.schedule ?? []).map((s) => [s.leafId, s]));
  const upTo = weeks.filter((w) => w.week <= week);

  const inputs: ForecastLeafInput[] = [];
  for (const item of db.wbsItems) {
    if (parents.has(item.id)) continue;
    const s = dates.get(item.id);
    if (!s?.startDate || !s.finishDate) continue;
    const snap = meta.leafData[item.id];
    const pct = resolveLeafProgress(item, snap);
    let finishedAt: string | null = null;
    let firstMoved: string | null = null;
    for (const w of upTo) {
      const sn = w.leafData[item.id];
      if (finishedAt === null && resolveLeafProgress(item, sn) >= 100) finishedAt = w.periodEnd;
      if (firstMoved === null && (sn?.qtyDone ?? 0) > 0) firstMoved = w.periodEnd;
    }
    const done = new Set(snap?.milestonesDone ?? []);
    inputs.push({
      id: item.id,
      order: item.order,
      planStart: s.startDate,
      planFinish: s.finishDate,
      pct,
      rungs:
        item.progressMethod === 'milestone'
          ? (item.milestones ?? []).map((m) => ({ id: m.id, weight: m.weight, done: done.has(m.id) }))
          : [],
      qty:
        item.progressMethod === 'qty'
          ? { total: totalQty(item), done: snap?.qtyDone ?? 0, firstMovedWeekEnd: firstMoved }
          : null,
      finishedAt: pct >= 100 ? finishedAt : null,
      // Only a date somebody had by then: reading week 30 must not use a vendor
      // date that was given in week 38.
      typed:
        item.forecast && item.forecast.week <= week
          ? { date: item.forecast.date, source: item.forecast.source, rungId: item.forecast.rungId }
          : null,
      // db.json-shaped fixtures carry ids only; those read as "after it finishes".
      waitsFor: item.waitLinks ?? (item.waitsFor ?? []).map((id) => ({ id, type: 'FS' as const, wait: 0 })),
    });
  }

  const forecast = forecastProject(inputs, meta.periodEnd);
  if (!forecast) return null;
  const weekEnds = weeks.map((w) => ({ week: w.week, end: w.periodEnd }));
  return { forecast, finishWeek: weekContaining(forecast.finish, weekEnds) };
}

/**
 * Activities the forecast finishes a week or more after their plan, ON
 * EVIDENCE: a date somebody gave, a measured quantity rate, or a late activity
 * they wait for. Leaf id → whole weeks. A late start or an overrun on the
 * plan's word alone is left out: the worklist already calls those late.
 *
 * One function because two screens name these rows, the dashboard's Priority
 * Actions ("Slips N wk") and Data Overall's "will slip", and they must name
 * the same ones.
 */
export function slippingOf(db: Database, forecast: ProjectForecast): Record<string, number> {
  const weekEnds = [...db.weeks].sort((a, b) => a.week - b.week).map((w) => ({ week: w.week, end: w.periodEnd }));
  const planFinish = new Map((db.schedule ?? []).map((s) => [s.leafId, s.finishWeek]));
  const slipping: Record<string, number> = {};
  for (const [id, lf] of forecast.leaves) {
    const onEvidence = lf.basis !== 'done' && (lf.basis === 'typed' || lf.basis === 'measured' || lf.push > 0);
    const plannedWeek = planFinish.get(id);
    if (!onEvidence || plannedWeek === undefined) continue;
    const weeks = weekContaining(lf.finish, weekEnds) - plannedWeek;
    if (weeks >= 1) slipping[id] = weeks;
  }
  return slipping;
}
