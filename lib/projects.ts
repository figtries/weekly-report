/**
 * Projects — the reads.
 *
 * This is the layer the app's first screen stands on. It replaces
 * `lib/workspace.ts`'s view of "which projects exist", which could only ever
 * see the JSON store, and which had no dates to draw a schedule from.
 *
 * Every query here is synchronous, and that is load-bearing rather than
 * stylistic: better-sqlite3 under Cache Components counts as a deterministic
 * operation, so these complete during prerendering and land in the static
 * shell. `app/layout.tsx` calls into this on every route in the app — an async
 * read here would force a `<Suspense>` around it and fail the build on
 * `/_not-found`. See the note at the top of `lib/sqlite.ts`.
 *
 * Writes live in `lib/project-actions.ts`; a file with `'use server'` at the
 * top turns every export into a server action, so they cannot share this one.
 */
import { asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db, schema } from './sqlite';

export interface ProjectCard {
  id: string;
  name: string;
  clientName: string | null;
  contractorName: string | null;
  contractNo: string | null;
  contractValue: number | null;
  currency: string;
  startDate: string | null;
  finishDate: string | null;
  archivedAt: string | null;
  updatedAt: string | null;
  isActive: boolean;
  /** How many WBS rows the project actually holds — what makes "empty" visible. */
  rowCount: number;
  /** Reporting weeks generated from the project's dates. Lets a card say "week 45 of 60". */
  weekCount: number;
}

/**
 * The project the rest of the app is looking at.
 *
 * Two fallbacks, and both are about never handing the app nothing: a pointer
 * that names a deleted project comes back null from the join (`set null` on
 * delete), and a pointer at an archived project is ignored in favour of a live
 * one. `lib/workspace.ts:52` has refused to leave the app empty since the JSON
 * days; this keeps that promise.
 */
export function getActiveProjectId(): string | null {
  const state = db.select().from(schema.appState).where(eq(schema.appState.id, 'singleton')).all()[0];
  if (state?.activeProjectId) {
    const live = db
      .select({ id: schema.projects.id, archivedAt: schema.projects.archivedAt })
      .from(schema.projects)
      .where(eq(schema.projects.id, state.activeProjectId))
      .all()[0];
    if (live && !live.archivedAt) return live.id;
  }
  const first = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt))
    .orderBy(asc(schema.projects.createdAt))
    .all()[0];
  return first?.id ?? null;
}

export function getProject(projectId: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0] ?? null;
}

export function getActiveProject() {
  const id = getActiveProjectId();
  return id ? getProject(id) : null;
}

/**
 * The list, newest touch first, with the open project pinned to the top.
 *
 * Ordering is done here rather than in SQL because "the open one first" is a
 * property of the app's state, not of the table, and mixing the two into one
 * ORDER BY reads worse than saying it in a line of TypeScript.
 */
export function listProjects(opts: { includeArchived?: boolean } = {}): ProjectCard[] {
  const activeId = getActiveProjectId();

  const counts = new Map<string, number>(
    db
      .select({ projectId: schema.wbsNodes.projectId, n: sql<number>`count(*)` })
      .from(schema.wbsNodes)
      .groupBy(schema.wbsNodes.projectId)
      .all()
      .map((r) => [r.projectId, Number(r.n)])
  );

  const weekCounts = new Map<string, number>(
    db
      .select({ projectId: schema.weeks.projectId, n: sql<number>`count(*)` })
      .from(schema.weeks)
      .groupBy(schema.weeks.projectId)
      .all()
      .map((r) => [r.projectId, Number(r.n)])
  );

  const rows = db
    .select()
    .from(schema.projects)
    .orderBy(desc(schema.projects.updatedAt), desc(schema.projects.createdAt))
    .all()
    .filter((p) => opts.includeArchived || !p.archivedAt);

  return rows
    .map((p) => ({
      id: p.id,
      name: p.name,
      clientName: p.clientName,
      contractorName: p.contractorName,
      contractNo: p.contractNo,
      contractValue: p.contractValue,
      currency: p.currency,
      startDate: p.startDate,
      finishDate: p.finishDate,
      archivedAt: p.archivedAt,
      updatedAt: p.updatedAt,
      isActive: p.id === activeId,
      rowCount: counts.get(p.id) ?? 0,
      weekCount: weekCounts.get(p.id) ?? 0,
    }))
    .sort((a, b) => Number(b.isActive) - Number(a.isActive));
}

export function countArchived(): number {
  const r = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.projects)
    .where(sql`${schema.projects.archivedAt} is not null`)
    .all()[0];
  return Number(r?.n ?? 0);
}

/**
 * What a project actually holds, for the "isi proyek" block and for the delete
 * confirmation — which names what disappears rather than asking "are you sure?".
 */
export interface ProjectContents {
  wbsRows: number;
  leaves: number;
  reportingUnits: number;
  scheduledRows: number;
  baselines: number;
  weeks: number;
  documents: number;
}

export function getProjectContents(projectId: string): ProjectContents {
  return {
    wbsRows: countRaw('select count(*) c from wbs_nodes where project_id = ?', projectId),
    leaves: countRaw('select count(*) c from wbs_nodes where project_id = ? and is_leaf = 1', projectId),
    reportingUnits: countRaw(
      'select count(*) c from wbs_nodes where project_id = ? and is_reporting_unit = 1',
      projectId
    ),
    scheduledRows: countRaw(
      `select count(distinct s.node_id) c from node_schedules s
       join wbs_nodes n on n.id = s.node_id where n.project_id = ?`,
      projectId
    ),
    baselines: countRaw('select count(*) c from baselines where project_id = ?', projectId),
    weeks: countRaw('select count(*) c from weeks where project_id = ?', projectId),
    documents: countRaw('select count(*) c from documents where project_id = ?', projectId),
  };
}

function countRaw(query: string, ...params: unknown[]): number {
  const row = db.$client.prepare(query).get(...(params as never[])) as { c: number } | undefined;
  return Number(row?.c ?? 0);
}
