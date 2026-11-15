import { eq } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { parseBarView, type BarView } from './bar-view';

export async function getBarView(projectId: string): Promise<BarView> {
  const rows = await db
    .select({ v: schema.projects.barView })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  return parseBarView(rows[0]?.v ?? null);
}
