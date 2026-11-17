/**
 * Reads for the v2 database that belong to no one module.
 *
 * Separate from `lib/data.ts`, which serves the old JSON store and still feeds
 * every other screen. The document register's own reads live in
 * `lib/register.ts`.
 *
 * Every query is synchronous on purpose. better-sqlite3 under Cache Components
 * counts as a deterministic operation, so these complete during prerendering
 * and land in the static shell — no `use cache`, no `<Suspense>`. See the note
 * at the top of `lib/sqlite.ts`.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';

export function getProject(projectId: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0] ?? null;
}
