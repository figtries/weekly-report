/**
 * Where a project's db.json record lives, and the one guard left on db.json.
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

import { db, schema } from './sqlite';
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
  const p = db
    .select({ id: schema.projects.id, name: schema.projects.name })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .all()[0];
  return p ?? null;
}

/**
 * WHICH JSON RECORD A PROJECT READS AND WRITES: its own, keyed by its SQLite id.
 *
 * `db.json` has held a map of projects since the portfolio tier, and only
 * `readDb()` insisted on returning whichever one the FILE called active — which
 * is why the daily report could once only belong to one project. Keyed, two
 * projects can never write over each other's days. (The imported project used
 * to read its own record through `legacy_json_id`; it was removed 26 Sep 2026.)
 *
 * Kept as a function rather than inlined at its callers so the key has one
 * definition.
 */
export function jsonKeyFor(projectId: string): string {
  return projectId;
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
 * which is not the project on screen — so while a project is open it refuses,
 * rather than writing that project's data into another one's record. No
 * project reads its weekly figures from db.json any more, so nothing open can
 * use `mutateDb` legitimately.
 */
export async function assertLegacyWritable(): Promise<void> {
  const open = await getOpenProject();
  if (open) {
    throw new Error(
      `"${open.name}" keeps its weekly figures in the project database, and saving here would write them into another project's record.`
    );
  }
}
