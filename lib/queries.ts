/**
 * Reads for the v2 database that belong to no one module.
 *
 * Separate from `lib/data.ts`, which serves the old JSON store and still feeds
 * every other screen. The document register's own reads live in
 * `lib/register.ts`.
 */
import { eq } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';

export async function getProject(projectId: string) {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  return rows[0] ?? null;
}
