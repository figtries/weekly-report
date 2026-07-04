import { cacheLife, cacheTag } from 'next/cache';
import { readDb } from './db';
import {
  computeGrandTotal,
  computeRollup,
  promoteNestedSpkContracts,
  type GrandTotal,
  type RollupNode,
} from './rollup';
import type { Database, WeeklyMeta } from './types';

// Cached so every page renders into an instant static shell (see
// unstable_instant exports); mutateDb expires the 'db' tag on every write.
export async function getDb(): Promise<Database> {
  'use cache';
  cacheTag('db');
  cacheLife('max');
  return readDb();
}

export function getWeekMeta(db: Database, week: number): WeeklyMeta | null {
  return db.weeks.find((w) => w.week === week) ?? null;
}

export function getPrevWeekMeta(db: Database, week: number): WeeklyMeta | null {
  return db.weeks.find((w) => w.week === week - 1) ?? null;
}

export function getLatestWeek(db: Database): number {
  // The "current" reporting week (latest with real actuals), not the last
  // materialised future week — that's where users land by default.
  return db.project.currentWeek || (db.weeks.length ? Math.max(...db.weeks.map((w) => w.week)) : 0);
}

export interface WeekRollup {
  meta: WeeklyMeta;
  prevMeta: WeeklyMeta | null;
  roots: RollupNode[];
  grandTotal: GrandTotal;
}

export function getWeekRollup(db: Database, week: number): WeekRollup | null {
  const meta = getWeekMeta(db, week);
  if (!meta) return null;
  const prevMeta = getPrevWeekMeta(db, week);
  const roots = promoteNestedSpkContracts(
    computeRollup(db.wbsItems, meta.leafData, prevMeta?.leafData ?? null)
  );
  return { meta, prevMeta, roots, grandTotal: computeGrandTotal(roots) };
}
