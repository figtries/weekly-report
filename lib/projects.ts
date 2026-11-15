/**
 * Projects — the reads.
 *
 * This is the layer the app's first screen stands on. It replaces
 * `lib/workspace.ts`'s view of "which projects exist", which could only ever
 * see the JSON store, and which had no dates to draw a schedule from.
 *
 * Writes live in `lib/project-actions.ts`; a file with `'use server'` at the
 * top turns every export into a server action, so they cannot share this one.
 */
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { deriveInitial } from './initial';
import { db } from './pg';
import * as schema from './schema';

/**
 * WHICH PROJECT IS OPEN LIVES IN THE BROWSER, NOT IN THE DATABASE.
 *
 * It used to be one row in `app_state`, and on the deployment that row is not
 * shared with anybody: `lib/sqlite.ts` copies `data/seed.db` into the lambda's
 * own temp directory, so "open this project" was written into whichever
 * instance served the click and every other instance went on answering from the
 * seed — where the open project is Gundih. The result was the app disagreeing
 * with itself on one screen: the sidebar naming one project while the page
 * beside it said another was open. A deployment wiped the choice outright.
 *
 * A cookie follows the person instead of the instance. It survives a deploy, it
 * cannot be prerendered into a shared static shell, and two people can hold
 * different projects open — which is what a global pointer could never do and
 * this app will need the moment it has logins.
 *
 * The `app_state` row is still written and still read, as the fallback for a
 * browser that has never chosen (a fresh phone, a shared link).
 */
export const OPEN_PROJECT_COOKIE = 'figtries_open_project';

/** A year: the choice should outlive the session, and it is not a secret. */
export const OPEN_PROJECT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface ProjectCard {
  id: string;
  name: string;
  /** Short handle. Null on projects made before 12 Sep 2026. */
  alias: string | null;
  /**
   * The handle to PRINT, which is not the same question as which one is
   * STORED. `alias` when the project has one, derived from the name when it
   * does not — the sidebar and the mobile bar both identify the open project
   * by three letters, and a project predating the column fell through to its
   * name there: seventy characters truncated into a 150px row reads
   * "RELOKASI 2 …", which identifies nothing. Display only. Nothing is written
   * back, so the field in Project details stays honestly empty until somebody
   * types one.
   */
  initial: string;
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
export async function getActiveProjectId(): Promise<string | null> {
  const jar = await cookies();
  const chosen = jar.get(OPEN_PROJECT_COOKIE)?.value;
  if (chosen && (await isOpenable(chosen))) return chosen;

  const state = await db
    .select({ activeProjectId: schema.appState.activeProjectId })
    .from(schema.appState)
    .where(eq(schema.appState.id, 'singleton'));
  const stateId = state[0]?.activeProjectId;
  if (stateId && (await isOpenable(stateId))) return stateId;

  const first = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt))
    .orderBy(asc(schema.projects.createdAt))
    .limit(1);
  return first[0]?.id ?? null;
}

/** Live and not archived — the two ways a stored pointer goes bad. */
async function isOpenable(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id, archivedAt: schema.projects.archivedAt })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  return rows.length > 0 && !rows[0].archivedAt;
}

export async function getProject(projectId: string) {
  const rows = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveProject() {
  const id = await getActiveProjectId();
  return id ? getProject(id) : null;
}

/**
 * The list, newest touch first, WITH THE OPEN PROJECT PINNED TO THE TOP.
 *
 * The pin was here, was taken out on 8 Sep 2026, and was put back on 15 Sep
 * 2026 on the user's explicit call. Both halves of that matter, because the
 * reason it came out has not stopped being true: opening a project refreshes
 * this list, the newly opened card jumps to position one, and every other card
 * shifts down — under a finger already moving toward the next one. Reported
 * then as "the wrong project comes out" and "other projects cannot be opened",
 * and reproduced exactly.
 *
 * What outweighed it is the complaint from the other side, on a phone: the
 * open project was the fourth card down a scrolling list, wearing a badge the
 * same colour as the text around it. The app follows ONE project everywhere,
 * and the screen that says which one made you hunt for the answer. It is first
 * now, and the badge is the action blue.
 *
 * The opening tap is a bottom sheet rather than the card itself, which is what
 * makes this survivable: the sheet closes, THEN the list re-lays. If the
 * shifting bites again, freeze the order for the life of the screen inside
 * `ProjectList` — do not unpin it and lose the answer again.
 */
export async function listProjects(opts: { includeArchived?: boolean } = {}): Promise<ProjectCard[]> {
  const activeId = await getActiveProjectId();

  const [countsRows, weekCountsRows, rows] = await Promise.all([
    db
      .select({ projectId: schema.wbsNodes.projectId, n: count() })
      .from(schema.wbsNodes)
      .groupBy(schema.wbsNodes.projectId),
    db
      .select({ projectId: schema.weeks.projectId, n: count() })
      .from(schema.weeks)
      .groupBy(schema.weeks.projectId),
    db
      .select()
      .from(schema.projects)
      .orderBy(desc(schema.projects.updatedAt), desc(schema.projects.createdAt)),
  ]);

  const counts = new Map(countsRows.map((r) => [r.projectId, Number(r.n)]));
  const weekCounts = new Map(weekCountsRows.map((r) => [r.projectId, Number(r.n)]));

  return rows
    .filter((p) => opts.includeArchived || !p.archivedAt)
    .map((p) => ({
      id: p.id,
      name: p.name,
      alias: p.alias,
      initial: p.alias || deriveInitial(p.name),
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

export async function countArchived(): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(schema.projects)
    .where(sql`${schema.projects.archivedAt} is not null`);
  return Number(rows[0]?.n ?? 0);
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

export async function getProjectContents(projectId: string): Promise<ProjectContents> {
  const [wbsRows, leaves, reportingUnits, scheduledRows, baselines, weeksCount, documents] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(schema.wbsNodes)
        .where(eq(schema.wbsNodes.projectId, projectId)),
      db
        .select({ n: count() })
        .from(schema.wbsNodes)
        .where(and(eq(schema.wbsNodes.projectId, projectId), eq(schema.wbsNodes.isLeaf, true))),
      db
        .select({ n: count() })
        .from(schema.wbsNodes)
        .where(
          and(eq(schema.wbsNodes.projectId, projectId), eq(schema.wbsNodes.isReportingUnit, true))
        ),
      db.execute(
        sql`select count(distinct s.node_id) as n from node_schedules s
            join wbs_nodes n on n.id = s.node_id
            where n.project_id = ${projectId}`
      ),
      db
        .select({ n: count() })
        .from(schema.baselines)
        .where(eq(schema.baselines.projectId, projectId)),
      db
        .select({ n: count() })
        .from(schema.weeks)
        .where(eq(schema.weeks.projectId, projectId)),
      db
        .select({ n: count() })
        .from(schema.documents)
        .where(eq(schema.documents.projectId, projectId)),
    ]);

  return {
    wbsRows: Number(wbsRows[0]?.n ?? 0),
    leaves: Number(leaves[0]?.n ?? 0),
    reportingUnits: Number(reportingUnits[0]?.n ?? 0),
    scheduledRows: Number((scheduledRows[0] as { n: string | number } | undefined)?.n ?? 0),
    baselines: Number(baselines[0]?.n ?? 0),
    weeks: Number(weeksCount[0]?.n ?? 0),
    documents: Number(documents[0]?.n ?? 0),
  };
}
