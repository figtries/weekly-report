/**
 * Cold start, before the first query.
 *
 * `lib/sqlite.ts` opens its file the moment a route module imports it, so the
 * durable snapshot has to land on disk before that happens. `register()` is
 * the only hook Next runs ahead of route modules, which is the whole reason
 * this file exists — and why `lib/db-snapshot.ts` is careful not to import the
 * connection it is restoring.
 *
 * Node only: the edge runtime has no filesystem and no database to restore.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { restoreDbSnapshot } = await import('./lib/db-snapshot');
  await restoreDbSnapshot();
}
