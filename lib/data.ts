import { cacheLife, cacheTag } from 'next/cache';
import { readDb, readWorkspace } from './db';
import {
  computeGrandTotal,
  computeRollup,
  promoteNestedSpkContracts,
  type GrandTotal,
  type RollupNode,
} from './rollup';
import { buildSCurveSeries, type SCurveRow } from './scurve';
import { listProjects, type ProjectSummary, type Workspace } from './workspace';
import { buildProjectDashboardData } from './dashboard-db';
import { isLegacyProject } from './legacy-bridge';
import { getActiveProjectId } from './projects';
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

export async function getCachedWeekRollup(week: number): Promise<WeekRollup | null> {
  'use cache';
  cacheTag('db');
  cacheLife('max');

  const db = await readDb();
  return getWeekRollup(db, week);
}

export async function getCachedSCurveSeries(upToWeek: number): Promise<SCurveRow[]> {
  'use cache';
  cacheTag('db');
  cacheLife('max');

  const db = await readDb();
  return buildSCurveSeries(db, upToWeek);
}

/**
 * The project list for the sidebar.
 *
 * Cached like `getDb()` and for the same reason: this is read in the root
 * layout, so an uncached call here blocks every route in the app — including
 * `/_not-found`, which fails the build with "Uncached data was accessed
 * outside of <Suspense>". See AGENTS.md.
 */
export async function getProjects(): Promise<ProjectSummary[]> {
  'use cache';
  cacheTag('db');
  cacheLife('max');

  return listProjects(await readWorkspace());
}

/** Cached workspace, for the portfolio view. Same reason as `getProjects()`. */
export async function getWorkspace(): Promise<Workspace> {
  'use cache';
  cacheTag('db');
  cacheLife('max');

  return readWorkspace();
}

/* ------------------------------------------------- the project that is OPEN */

/**
 * The weekly report, for whichever project is open — not for whichever project
 * `db.json` happens to hold.
 *
 * Weekly Progress, Daily, Reports and Klaim all read `readDb()`, and `db.json`
 * holds exactly ONE project. `lib/legacy-bridge.ts` stopped that from lying by
 * refusing to draw anything for a project db.json has never heard of, which was
 * the right call and also a dead end: a project built in the app — real WBS,
 * real dates, real prices — could never be reported on at all. "This project
 * has no weekly reports yet" was not a state it could leave.
 *
 * SQLite already holds everything the weekly report needs for those projects,
 * and `lib/dashboard-db.ts` already shapes it into the `Database` that
 * `lib/rollup.ts` and `lib/analysis.ts` take. The dashboard has read every
 * project that way for months. This is the same adapter, reached from the
 * weekly pages.
 *
 * **THE IMPORTED PROJECT STAYS ON db.json, DELIBERATELY.** Both stores hold
 * Gundih and they do not agree: compared week by week
 * (`scripts/verify-weekly-store.ts`) the two disagree by up to 12.85 points,
 * because db.json's later weeks carry leaves that fall back to zero while
 * SQLite carries each leaf forward. Whichever is nearer the truth, moving a
 * SIGNED report onto a different number is not a migration — it is a report
 * that stops matching the paper the client holds. Gundih moves when board item
 * 08 rebuilds these pages properly and the numbers are reconciled on purpose.
 *
 * So: a project with `legacyJsonId` reads exactly what it read before, through
 * the same cached functions. Every other project reads SQLite, uncached, the
 * way the dashboard does — cached would mean a planner edit not showing until
 * something expired the tag.
 */
/**
 * A project the database cannot find at all — deleted in another tab, or an
 * id from a stale cookie. An EMPTY database rather than null, so the pages
 * keep their plain shape: every one of them already renders "nothing to show"
 * correctly, and a nullable `Database` would put an `if` in front of every
 * read in the weekly section to describe a case none of them can do anything
 * about.
 */
const NO_PROJECT: Database = {
  project: {
    name: '',
    contractNo: '',
    customer: '',
    contractor: '',
    workLocation: '',
    documentNoWeekly: '',
    documentNoDaily: '',
    signatureLeft: { company: '', name: '' },
    signatureRight: { company: '', name: '' },
    weekAnchorEndDate: '',
    currentWeek: 0,
  },
  wbsItems: [],
  weeks: [],
  scurvePlan: [],
  scurveActual: [],
  daily: [],
  schedule: [],
};

export async function getOpenDb(): Promise<Database> {
  const id = await getActiveProjectId();
  if (!id || isLegacyProject(id)) return getDb();
  return buildProjectDashboardData(id)?.db ?? NO_PROJECT;
}

export async function getOpenWeekRollup(week: number): Promise<WeekRollup | null> {
  const id = await getActiveProjectId();
  if (!id || isLegacyProject(id)) return getCachedWeekRollup(week);
  const db = buildProjectDashboardData(id)?.db;
  return db ? getWeekRollup(db, week) : null;
}

export async function getOpenSCurveSeries(upToWeek: number): Promise<SCurveRow[]> {
  const id = await getActiveProjectId();
  if (!id || isLegacyProject(id)) return getCachedSCurveSeries(upToWeek);
  const db = buildProjectDashboardData(id)?.db;
  return db ? buildSCurveSeries(db, upToWeek) : [];
}
