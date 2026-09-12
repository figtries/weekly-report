/**
 * Which project the v1 pages are allowed to show — and when they must not.
 *
 * Dashboard, Weekly Progress, Daily, Reports and Klaim all read `readDb()`,
 * which returns the active project out of `db.json`. Projects are now chosen in
 * SQLite, so those two can disagree: opening a project made in the app left the
 * sidebar naming it while the Dashboard went on drawing Gundih's 70.14% and its
 * laggards. That is the failure this app fears most — a report that does not
 * match the site.
 *
 * **Reads and writes must stay on the same store.** Twelve files write to
 * `db.json` through `mutateDb` (fourteen call sites in `lib/actions.ts` alone,
 * plus eight API routes). Serving those pages a `Database` built from SQLite
 * while their writes still land in JSON would lose people's edits silently —
 * worse than the problem being fixed. So this bridge does not translate
 * anything. It answers one question: does the open project have v1 data at all?
 *
 * A project made in the app has none, and the honest answer for it is not a
 * chart of zeroes — it is a sentence saying so and a way forward.
 *
 * `legacyJsonId` is the link, and it is meant to die: when board items 08–14
 * rebuild those pages on SQLite, both the column and this file go with them.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { getActiveProjectId } from './projects';
import { emptyDatabase } from './workspace';
import type { Database } from './types';

export interface OpenProject {
  id: string;
  name: string;
  /** The `db.json` project this one is backed by, or null for app-made projects. */
  legacyJsonId: string | null;
  /** True when Dashboard, Weekly, Daily, Reports and Klaim have something to show. */
  hasLegacyData: boolean;
}

/**
 * Does this project's data live in `db.json`?
 *
 * Synchronous on purpose: `lib/data.ts` asks this to choose a STORE, and an
 * async answer would force `<Suspense>` around every read in the app (see
 * AGENTS.md). A sync embedded-database query is deterministic and prerenders.
 */
export function isLegacyProject(projectId: string): boolean {
  const p = db
    .select({ legacyJsonId: schema.projects.legacyJsonId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  return !!p?.legacyJsonId;
}

export async function getOpenProject(): Promise<OpenProject | null> {
  const id = await getActiveProjectId();
  if (!id) return null;
  const p = db
    .select({
      id: schema.projects.id,
      name: schema.projects.name,
      legacyJsonId: schema.projects.legacyJsonId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .all()[0];
  if (!p) return null;
  return { ...p, hasLegacyData: !!p.legacyJsonId };
}

/**
 * WHICH JSON RECORD A PROJECT READS AND WRITES.
 *
 * `db.json` was never one project — `lib/workspace.ts` has held a map of them
 * since the portfolio tier — it was one project that everybody shared, because
 * `readDb()` always returned whichever one the FILE called active. That is why
 * the daily report could only ever belong to Gundih.
 *
 * The key is the answer: the imported project keeps reading `p-utama` through
 * its `legacyJsonId`, and every other project reads and writes a record of its
 * own, keyed by its SQLite id. Nothing moves, nothing is migrated, and two
 * projects can no longer write over each other's days.
 *
 * Synchronous for the same reason as `isLegacyProject`: callers use it to pick
 * a STORE, and an async answer would drag a `<Suspense>` around every read.
 */
export function jsonKeyFor(projectId: string): string {
  const p = db
    .select({ legacyJsonId: schema.projects.legacyJsonId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  return p?.legacyJsonId ?? projectId;
}

/**
 * The record a project starts from the first time it saves a daily report.
 *
 * Seeded with the identity SQLite already holds rather than left blank: the
 * printed daily report puts the project name, the contract number and both
 * companies in its header, and asking somebody to type them a second time —
 * into a second store — is how the two drift apart.
 */
export function jsonSeedFor(projectId: string): Database {
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0];
  const seeded = emptyDatabase(p?.name ?? '');
  if (p) {
    seeded.project.contractNo = p.contractNo ?? '';
    seeded.project.customer = p.clientName ?? '';
    seeded.project.contractor = p.contractorName ?? '';
  }
  return seeded;
}

/**
 * Guard for the write path. `mutateDb` edits whatever `db.json` calls active,
 * which is not necessarily the project on screen — so without this, adding a
 * daily report while an app-made project is open would write it into Gundih.
 */
export async function assertLegacyWritable(): Promise<void> {
  const open = await getOpenProject();
  if (open && !open.hasLegacyData) {
    throw new Error(
      `"${open.name}" has no weekly or daily data yet, and saving here would write it into another project. Build its schedule first.`
    );
  }
}
