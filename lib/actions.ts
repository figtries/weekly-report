'use server';

import { refresh, updateTag } from 'next/cache';
import { after } from 'next/server';
import { mutateOpenDb } from './db';
import type { CatalogKey } from './catalogs';
import {
  applyCatalog,
  applyCreateDaily,
  applyDeleteDaily,
  applyPatchDaily,
  type FieldProgressUpdate,
} from './mutations';
import { getActiveProjectId } from './projects';
import {
  markNoProgressSqlite,
  restoreLeafWeeksSqlite,
  saveFieldProgressSqlite,
  saveLeafWeeksSqlite,
  saveWeekUpdatesSqlite,
  setProgressMethodSqlite,
  setWorkKindSqlite,
  SignedWeeksError,
  type LeafWeekBefore,
} from './progress-sqlite';
import type { LeafWeekLog, WeekEvidence } from './week-log';
import { readLeafLog } from './week-log-read';
import { and, eq } from 'drizzle-orm';
import { beforeWrite, db as sqlite, flushDbSnapshot, schema as sqliteSchema } from './sqlite';
import { deleteUploadedPhoto } from './upload';
import { BUILT_IN_KINDS, type Shape } from './work-kind';
import { ladderFor } from './work-kind-apply';
import type { CatalogEntry, DailyReport, LeafSnapshot, Milestone, ProgressMethod } from './types';

// Server Actions replace the old fetch('/api/...') + router.refresh() pattern:
// one round trip that mutates, expires the 'db' cache tag (updateTag = read
// your own writes) and streams the re-rendered page back in the same response.

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * WHICH PROJECT THIS WRITE BELONGS TO: the id the caller names, or the open
 * one. Every project keeps its weekly figures in SQLite; null means no project
 * is open at all. (It used to mean "the imported project, whose figures lived
 * in db.json" — that project, Gundih, was removed on 26 Sep 2026.)
 */
async function sqliteProject(explicit?: string | null): Promise<string | null> {
  // AN ID PASSED IN WINS. The screen that is asking was rendered for one
  // project and its row ids belong to that project's store. Re-deriving the
  // answer from the cookie here is how a save lands in a different store and
  // answers "Item not found" for a row that is plainly on screen — which is
  // what every work-kind save did once the open project and the rendered page
  // drifted apart (a cached page, a second tab, a cookie that moved on).
  return explicit ?? (await getActiveProjectId()) ?? null;
}

/**
 * What a weekly write says when no project is open. It used to fall through to
 * db.json and edit whatever that file called active — the imported project,
 * removed 26 Sep 2026 — which is exactly the write that must not happen.
 */
const NO_PROJECT_OPEN: ActionResult = { ok: false, error: 'No project is open. Open one from Projects first.' };

/**
 * A SQLite write, wrapped the way every other one in this app is: the snapshot
 * pulled before it and pushed after it (see lib/db-snapshot.ts), and the read
 * caches expired so the page that called it renders its own write.
 */
async function sqliteWrite(run: () => void): Promise<ActionResult> {
  try {
    await beforeWrite();
    run();
    await flushDbSnapshot();
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

/**
 * Pin the week the project is currently in.
 *
 * It used to reach db.json only, so the button that calls it was shown on the
 * imported project and HIDDEN on every other one — and those projects had no
 * pin at all, only a guess that read 0 until somebody filed a week. Now both
 * stores can hold it, which is what lets one button appear everywhere. The
 * dates still answer when nothing is pinned; see `currentWeekOf`.
 */
export async function setCurrentWeekAction(week: number): Promise<ActionResult> {
  const projectId = await sqliteProject();
  if (projectId) {
    return sqliteWrite(() => {
      const exists = sqlite
        .select({ id: sqliteSchema.weeks.id })
        .from(sqliteSchema.weeks)
        .where(and(eq(sqliteSchema.weeks.projectId, projectId), eq(sqliteSchema.weeks.weekNo, week)))
        .all();
      if (exists.length === 0) throw new Error(`Week ${week} not found`);
      sqlite
        .update(sqliteSchema.projects)
        .set({ pinnedCurrentWeek: week, updatedAt: new Date().toISOString() })
        .where(eq(sqliteSchema.projects.id, projectId))
        .run();
    });
  }
  return NO_PROJECT_OPEN;
}

export async function createDailyAction(date: string): Promise<ActionResult> {
  try {
    await mutateOpenDb((db) => applyCreateDaily(db, date));
    // No refresh() here: the caller navigates straight to the new report, so
    // re-rendering the origin page would be wasted work. updateTag makes that
    // navigation render with fresh data (read-your-own-writes). Navigation
    // itself is client-side (router.push) so the destination's loading
    // skeleton shows immediately instead of a frozen dialog; if the render
    // still races tag propagation on Vercel, the report page's fresh-read
    // fallback (app/daily/[date]/page.tsx) finds the new report anyway.
    updateTag('db');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteDailyAction(date: string): Promise<ActionResult> {
  try {
    // applyDeleteDaily is idempotent: deleting a report that is already gone
    // (a stale list can show rows that no longer exist) is treated as done,
    // and the refresh below re-renders the list fresh — healing the staleness
    // instead of surfacing a "not found" error.
    const removed = await mutateOpenDb((db) => applyDeleteDaily(db, date));
    if (removed) {
      // Best-effort cleanup of the report's stored photos — after the
      // response, so the refresh isn't held up by storage round trips.
      const photos = removed.photos;
      after(() =>
        Promise.all(photos.map((p) => deleteUploadedPhoto(p).catch(() => undefined)))
      );
    }
    // refresh(), not redirect('/daily'): deletes always start on the list
    // page, and a redirect's payload arrives via a separate GET that can race
    // tag propagation on Vercel and hand the router a list still containing
    // the deleted row. refresh() re-renders inside this action request, where
    // the expired 'db' tag is guaranteed visible — and adds no history entry.
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// Read-your-own-writes refresh for mutations that go through the /api photo
// routes: re-renders the current page inside this action request, where the
// expired 'db' tag is guaranteed visible (router.refresh() from the client
// can race tag propagation and cache a stale render instead).
export async function refreshDbAction(): Promise<void> {
  updateTag('db');
  refresh();
}

export async function saveDailyAction(
  date: string,
  patch: Partial<Omit<DailyReport, 'date'>>
): Promise<ActionResult> {
  try {
    await mutateOpenDb((db) => applyPatchDaily(db, date, patch));
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function saveWeekUpdatesAction(
  week: number,
  updates: Record<string, Partial<LeafSnapshot>>,
  forProject?: string | null
): Promise<ActionResult> {
  const projectId = await sqliteProject(forProject);
  if (projectId) return sqliteWrite(() => saveWeekUpdatesSqlite(projectId, week, updates));
  return NO_PROJECT_OPEN;
}

export async function saveFieldProgressAction(
  week: number,
  updates: FieldProgressUpdate[],
  forProject?: string | null
): Promise<ActionResult> {
  const projectId = await sqliteProject(forProject);
  if (projectId) return sqliteWrite(() => saveFieldProgressSqlite(projectId, week, updates));
  return NO_PROJECT_OPEN;
}

/**
 * "Checked it, nothing moved this week."
 *
 * Takes a list because the queue offers it per card, but someone clearing a
 * quiet week wants to say it about several at once.
 */
export async function markNoProgressAction(
  week: number,
  leafIds: string[],
  forProject?: string | null
): Promise<ActionResult> {
  const projectId = await sqliteProject(forProject);
  if (projectId) return sqliteWrite(() => markNoProgressSqlite(projectId, week, leafIds));
  return NO_PROJECT_OPEN;
}

export async function setProgressMethodAction(
  leafId: string,
  method: ProgressMethod,
  opts: { vol?: number | null; satuan?: string | null; milestones?: Milestone[] } = {}
): Promise<ActionResult> {
  const projectId = await sqliteProject();
  if (projectId) return sqliteWrite(() => setProgressMethodSqlite(leafId, method, opts));
  return NO_PROJECT_OPEN;
}

/**
 * `rowName` is passed in rather than looked up. The panel already holds
 * `node.name`, and adding a database read to an action that does not need one
 * is how a clock or an uncached read creeps into a path that must stay cheap.
 */
export async function setWorkKindAction(
  leafId: string,
  rowName: string,
  kindId: string,
  shape: Shape,
  opts: { steps?: Milestone[]; vol?: number | null; satuan?: string | null } = {},
  forProject?: string | null
): Promise<ActionResult> {
  // One door for all four forms, because the panel now asks one question. A
  // gate and a ladder are both milestone, a typed percent is lumpsum, and a
  // count is qty carrying the total it was given.
  const method: ProgressMethod =
    shape === 'qty' ? 'qty' : shape === 'manual' ? 'lumpsum' : 'milestone';
  const milestones = opts.steps ?? ladderFor(kindId, shape, rowName, BUILT_IN_KINDS);
  const methodOpts =
    shape === 'qty' ? { vol: opts.vol, satuan: opts.satuan } : { milestones };

  const projectId = await sqliteProject(forProject);
  if (projectId) return sqliteWrite(() => setWorkKindSqlite(leafId, kindId, method, methodOpts));
  return NO_PROJECT_OPEN;
}

export async function saveCatalogAction(
  key: CatalogKey,
  entries: CatalogEntry[]
): Promise<ActionResult> {
  try {
    await mutateOpenDb((db) => applyCatalog(db, key, entries));
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* ------------------------------------------------ one activity, week by week */

export type LeafWeeksResult = { ok: true; log: LeafWeekLog | null } | { ok: false; error: string };
export type SaveLeafWeeksResult =
  | { ok: true; log: LeafWeekLog | null; undo: LeafWeekBefore[] }
  | { ok: false; error: string; signed?: number[] };

/**
 * The imported project's history agrees with its signed PDFs, and board item
 * 08 is where the two stores get reconciled — not a panel. Said, not hidden.
 */
const READ_ONLY_HISTORY =
  "This project's past weeks match its signed reports, so they can't be changed from here.";

/**
 * Several weeks of one activity in one save — a single corrected week, or a
 * "Repeat weekly" fill. Answers with the fresh log, so the panel redraws from
 * what was written rather than from what it hoped would be, and with the rows
 * as they were, for Undo.
 *
 * A save that would touch a signed week comes back refused with the weeks
 * named, and is sent again with `allowSigned` once the person has said yes.
 */
export async function saveLeafWeeksAction(
  nodeId: string,
  edits: { week: number; evidence: WeekEvidence }[],
  opts: { allowSigned?: boolean },
  forProject?: string | null
): Promise<SaveLeafWeeksResult> {
  const projectId = await sqliteProject(forProject);
  if (!projectId) return { ok: false, error: READ_ONLY_HISTORY };
  try {
    await beforeWrite();
    const undo = saveLeafWeeksSqlite(projectId, nodeId, edits, opts);
    await flushDbSnapshot();
    updateTag('db');
    refresh();
    return { ok: true, undo, log: await readLeafLog(nodeId, projectId, { fresh: false }) };
  } catch (err) {
    if (err instanceof SignedWeeksError) return { ok: false, error: err.message, signed: err.weeks };
    return fail(err);
  }
}

/** Undo for `saveLeafWeeksAction`: every week put back exactly as it was. */
export async function restoreLeafWeeksAction(
  nodeId: string,
  before: LeafWeekBefore[],
  forProject?: string | null
): Promise<LeafWeeksResult> {
  const projectId = await sqliteProject(forProject);
  if (!projectId) return { ok: false, error: READ_ONLY_HISTORY };
  try {
    await beforeWrite();
    restoreLeafWeeksSqlite(projectId, nodeId, before);
    await flushDbSnapshot();
    updateTag('db');
    refresh();
    return { ok: true, log: await readLeafLog(nodeId, projectId, { fresh: false }) };
  } catch (err) {
    return fail(err);
  }
}
