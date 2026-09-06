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

export interface OpenProject {
  id: string;
  name: string;
  /** The `db.json` project this one is backed by, or null for app-made projects. */
  legacyJsonId: string | null;
  /** True when Dashboard, Weekly, Daily, Reports and Klaim have something to show. */
  hasLegacyData: boolean;
}

export function getOpenProject(): OpenProject | null {
  const id = getActiveProjectId();
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
 * Guard for the write path. `mutateDb` edits whatever `db.json` calls active,
 * which is not necessarily the project on screen — so without this, adding a
 * daily report while an app-made project is open would write it into Gundih.
 */
export function assertLegacyWritable(): void {
  const open = getOpenProject();
  if (open && !open.hasLegacyData) {
    throw new Error(
      `"${open.name}" has no weekly or daily data yet, and saving here would write it into another project. Build its schedule first.`
    );
  }
}
