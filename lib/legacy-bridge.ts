/**
 * Where a project's db.json record lives.
 *
 * This file used to answer "does the open project have v1 data?" — whether it
 * was the imported project, Gundih, whose weekly figures lived in db.json while
 * every other project's lived in SQLite. Gundih was removed on 26 Sep 2026 and
 * with it every weekly read of db.json; no project carries `legacy_json_id`
 * any more (the column stays in the schema: dropping it is the drizzle
 * table-rebuild AGENTS.md warns deletes child rows).
 *
 * What remains is db.json's real job: each project's DAILY reports and its own
 * catalogs, keyed by the project's SQLite id.
 */
import { eq } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { getActiveProjectId } from './projects';
import { emptyDatabase } from './workspace';
import type { Database } from './types';

export interface OpenProject {
  id: string;
  name: string;
}

export async function getOpenProject(): Promise<OpenProject | null> {
  const id = await getActiveProjectId();
  if (!id) return null;
  const rows = await db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.id, id));
  return rows[0] ?? null;
}

/**
 * WHICH JSON RECORD A PROJECT READS AND WRITES: its own, keyed by its SQLite id.
 */
export function jsonKeyFor(projectId: string): string {
  return projectId;
}

/**
 * The record a project starts from the first time it saves a daily report.
 *
 * Seeded with the identity SQLite already holds rather than left blank.
 * Now async because it queries PostgreSQL.
 */
export async function jsonSeedFor(projectId: string): Promise<Database> {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const p = rows[0];
  const seeded = emptyDatabase(p?.name ?? '');
  if (p) {
    seeded.project.contractNo = p.contractNo ?? '';
    seeded.project.customer = p.clientName ?? '';
    seeded.project.contractor = p.contractorName ?? '';
  }
  return seeded;
}
