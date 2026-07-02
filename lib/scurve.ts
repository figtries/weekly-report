import { computeGrandTotal, computeRollup } from './rollup';
import type { Database } from './types';

export interface SCurveRow {
  week: number;
  planPct: number | null;
  actualPct: number | null;
}

/**
 * Build the S-Curve series. Pass `upToWeek` to cut the curve off at the week
 * being viewed (so each week's S-Curve shows progress up to that week only,
 * not the whole project timeline).
 *
 * Every week is computed live from that week's WBS rollup — the exact same
 * numbers shown on the Data Overall page — so the curve can never drift from
 * the tables. The stored `scurvePlan` / `scurveActual` series are only used as
 * a fallback for weeks that have no materialised leaf data. The actual line is
 * drawn up to `project.currentWeek` (the latest reported week); later weeks
 * only carry the plan.
 */
export function buildSCurveSeries(db: Database, upToWeek?: number): SCurveRow[] {
  const maxPlanWeek = db.scurvePlan.length ? Math.max(...db.scurvePlan.map((p) => p.week)) : 0;
  const maxDataWeek = db.weeks.length ? Math.max(...db.weeks.map((w) => w.week)) : 0;
  const maxWeek = upToWeek ? Math.min(upToWeek, Math.max(maxPlanWeek, maxDataWeek)) : Math.max(maxPlanWeek, maxDataWeek);
  const currentWeek = db.project.currentWeek;

  const planMap = new Map(db.scurvePlan.map((p) => [p.week, p.valuePct]));
  const historyMap = new Map(db.scurveActual.map((p) => [p.week, p.valuePct]));
  const weekMap = new Map(db.weeks.map((w) => [w.week, w]));

  const rows: SCurveRow[] = [];
  for (let week = 1; week <= maxWeek; week++) {
    let plan: number | null = planMap.get(week) ?? null;
    let actual: number | null = week <= currentWeek ? historyMap.get(week) ?? null : null;
    const meta = weekMap.get(week);
    if (meta) {
      const prevMeta = weekMap.get(week - 1);
      const gt = computeGrandTotal(computeRollup(db.wbsItems, meta.leafData, prevMeta?.leafData ?? null));
      plan = gt.targetWF;
      actual = week <= currentWeek ? gt.curProgressPct : null;
    }
    rows.push({ week, planPct: plan, actualPct: actual });
  }
  return rows;
}
