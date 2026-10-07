import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { parseBarView, type BarView } from './bar-view';

/** A project's Bars choices. Synchronous, like every read in this app. */
export function getBarView(projectId: string): BarView {
  const row = db
    .select({ v: schema.projects.barView })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  return parseBarView(row?.v ?? null);
}
