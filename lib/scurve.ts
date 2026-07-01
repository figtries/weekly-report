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
 */
export function buildSCurveSeries(db: Database, upToWeek?: number): SCurveRow[] {
  const maxPlanWeek = db.scurvePlan.length ? Math.max(...db.scurvePlan.map((p) => p.week)) : 0;
  const maxDataWeek = db.weeks.length ? Math.max(...db.weeks.map((w) => w.week)) : 0;
  const maxWeek = upToWeek ? Math.min(upToWeek, Math.max(maxPlanWeek, maxDataWeek)) : Math.max(maxPlanWeek, maxDataWeek);
  const currentWeek = db.project.currentWeek;

  const planMap = new Map(db.scurvePlan.map((p) => [p.week, p.valuePct]));
  const historyMap = new Map(db.scurveActual.map((p) => [p.week, p.valuePct]));

  const rows: SCurveRow[] = [];
  for (let week = 1; week <= maxWeek; week++) {
    let plan: number | null = planMap.get(week) ?? null;
    let actual: number | null = historyMap.get(week) ?? null;
    // The current reporting week is computed live from the WBS rollup so that
    // editing leaf progress/plan moves the S-Curve immediately. Every other week
    // uses the recorded baseline series (actual only exists up to the current week).
    if (week === currentWeek) {
      const meta = db.weeks.find((w) => w.week === week);
      if (meta) {
        const prevMeta = db.weeks.find((w) => w.week === week - 1);
        const gt = computeGrandTotal(computeRollup(db.wbsItems, meta.leafData, prevMeta?.leafData ?? null));
        actual = gt.curProgressPct;
        plan = gt.targetWF;
      }
    }
    rows.push({ week, planPct: plan, actualPct: actual });
  }
  return rows;
}
