/**
 * What each bar on the planner has to say: its kind, its stages, how much is
 * done and where the forecast puts its finish.
 *
 * Read off the SAME Database Data Overall reads, as of the project's current
 * week, and nothing is worked out here: done comes from lib/progress.ts, the
 * finish and its reason from the forecast. That is what stops the planner and
 * Data Overall from ever disagreeing about one activity.
 *
 * Reads the clock (`currentWeekOf`), so call it after a request read.
 */
import { buildProjectDashboardData } from './dashboard-db';
import { currentWeekOf } from './current-week';
import { resolveLeafProgress } from './progress';
import { buildForecastView, type ForecastReason } from './forecast-view';
import { disciplineOf } from './disciplines';
import { stepIdOf } from './forecast-epc';
import type { Rung } from './bar-view';
import type { Shape } from './work-kind';

export interface BarFact {
  kindId: string | null;
  /** Leaves only; null on a heading or on a row nobody has given a kind. */
  shape: Shape | null;
  disciplineId: string | null;
  donePct: number;
  rungs: Rung[];
  /** Step ids of the rungs, for the kind picker's `currentLadder`. */
  ladder: string[];
  forecastFinish: string | null;
  planFinish: string | null;
  /** Why the forecast is late, in words; null when it is not. */
  reason: string | null;
}

export interface BarFacts {
  week: number | null;
  facts: Record<string, BarFact>;
}

function reasonText(r: ForecastReason): string | null {
  switch (r.kind) {
    case 'pushed':
      return `it waits for ${r.by.name}`;
    case 'behind':
      return `it is ${r.weeks} ${r.weeks === 1 ? 'week' : 'weeks'} behind its plan`;
    case 'typed':
      return 'of the date that was given';
    case 'measured':
      return 'of the rate measured so far';
    default:
      return null;
  }
}

export function getBarFacts(projectId: string, today: Date = new Date()): BarFacts {
  const db = buildProjectDashboardData(projectId)?.db;
  if (!db) return { week: null, facts: {} };
  const week = db.weeks.length ? currentWeekOf(db, today) : null;
  const meta = week != null ? db.weeks.find((w) => w.week === week) : undefined;
  const view = week != null ? buildForecastView(db, week) : null;
  const parents = new Set(db.wbsItems.map((i) => i.parentId).filter((p): p is string => !!p));

  const facts: Record<string, BarFact> = {};
  for (const item of db.wbsItems) {
    const leaf = !parents.has(item.id);
    const snap = meta?.leafData[item.id];
    const done = new Set(snap?.milestonesDone ?? []);
    const ms = leaf && item.progressMethod === 'milestone' ? item.milestones ?? [] : [];
    const shape: Shape | null =
      !leaf || !item.workKind
        ? null
        : item.progressMethod === 'qty'
          ? 'qty'
          : item.progressMethod === 'milestone'
            ? ms.length === 1
              ? 'gate'
              : 'steps'
            : 'manual';
    const f = leaf ? view?.leaves[item.id] : undefined;
    facts[item.id] = {
      kindId: item.workKind ?? null,
      shape,
      disciplineId: item.workKind === 'construction' ? disciplineOf(ms)?.id ?? null : null,
      donePct: leaf ? resolveLeafProgress(item, snap) : 0,
      rungs: ms.map((m) => ({ label: m.label, weight: m.weight, done: done.has(m.id) })),
      ladder: ms.map((m) => stepIdOf(m.id)),
      forecastFinish: f?.finish ?? null,
      planFinish: f?.planFinish ?? null,
      reason: f && f.finish > f.planFinish ? reasonText(f.reason) : null,
    };
  }
  return { week, facts };
}
