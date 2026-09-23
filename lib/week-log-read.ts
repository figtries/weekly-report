import 'server-only';

import { getPrintDb } from './data';
import { isLegacyProject } from './legacy-bridge';
import { signedWeeksSqlite } from './progress-sqlite';
import { getActiveProjectId } from './projects';
import { ensureFreshDb } from './sqlite';
import { buildLeafWeekLog, type LeafWeekLog } from './week-log';

/**
 * One leaf's week-by-week log, read off the same `Database` the reports are
 * built from — `getPrintDb`, told which project rather than asking the cookie,
 * because the panel names its project.
 *
 * READ THROUGH A ROUTE, NEVER A SERVER ACTION. The first cut loaded this with
 * `getLeafWeeksAction`, and the panel then sometimes showed no log at all
 * until the page was refreshed (23 Sep 2026). Next.js dispatches server
 * actions one at a time on the client and says so in its own docs: they are
 * for mutations, and "using them for data fetching introduces sequential
 * execution". A read queued behind a save's refresh was slow; a read the router
 * aborted (`net::ERR_ABORTED`, caught on production) never answered at all.
 * `app/api/leaf-weeks/route.ts` serves it as a plain GET, and the save and
 * undo actions call this directly to hand the fresh log back with their result.
 *
 * `fresh` pulls the database snapshot first, the way every page read does, so
 * a panel opened on one instance sees a week saved through another. The write
 * actions pass `false`: they have just pushed that snapshot themselves.
 */
export async function readLeafLog(
  nodeId: string,
  forProject?: string | null,
  { fresh = true }: { fresh?: boolean } = {}
): Promise<LeafWeekLog | null> {
  const projectId = forProject ?? (await getActiveProjectId());
  if (fresh) await ensureFreshDb();
  const editable = Boolean(projectId) && !isLegacyProject(projectId!);
  const db = await getPrintDb(projectId ?? null);
  const signedWeeks = editable
    ? signedWeeksSqlite(projectId!)
    : new Set((db.approvals ?? []).map((a) => a.week));
  return buildLeafWeekLog(db, nodeId, { signedWeeks, editable });
}
