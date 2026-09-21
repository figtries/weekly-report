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
import { cookies } from 'next/headers';

import { deriveInitial } from './initial';
import { db, ensureFreshDb, schema } from './sqlite';

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
  // THE COOKIE IS READ FIRST, AND THE ORDER IS CORRECTNESS.
  //
  // `ensureFreshDb()` throttles itself on `Date.now()`, and under
  // `cacheComponents` reading the clock BEFORE any request data has been read
  // is a static-generation bailout: "used `Date.now()` before accessing either
  // uncached data or Request data". It only bites where the snapshot layer is
  // actually configured — that is, on the deployment and nowhere else — which
  // is why it survived every local build and every local `next start`.
  //
  // It cost Document Control outright (12 Sep 2026). Every `/dokumen/[week]`
  // path that was NOT in `generateStaticParams` 500d on Vercel, because this is
  // the first thing the section's tab row asks for; weeks 1–60 only looked
  // alive because they were being served from the build-time ISR entry, whose
  // revalidation had been failing silently since the deploy (`X-Vercel-Cache:
  // STALE`, `Age` climbing forever). `/weekly` escaped it by accident:
  // `LegacyChromeGate` calls `connection()` before it ever gets here.
  //
  // Reading the cookie first costs nothing and legitimises the clock for every
  // caller in the app, so no screen has to remember to call `connection()`
  // before asking which project is open.
  const jar = await cookies();
  // Every screen that follows the open project passes through here, and it is
  // already an uncached read, so this is where a deployment catches up with the
  // writes another instance made before answering from its own stale bytes. A
  // 304 at most once every 1.5 s, and nothing at all when no blob store is
  // attached — see lib/db-snapshot.ts.
  await ensureFreshDb();
  const chosen = jar.get(OPEN_PROJECT_COOKIE)?.value;
  if (chosen) {
    if (isOpenable(chosen)) return chosen;
    // A COOKIE NAMING A PROJECT THIS DATABASE HAS NEVER HEARD OF IS NOT PROOF
    // THE PROJECT IS GONE.
    //
    // On the deployment the database is a snapshot pulled over a copy of
    // `data/seed.db` (see lib/db-snapshot.ts), and a cold instance can answer a
    // request from the seed before that pull has landed. The seed holds Gundih
    // and nothing made since, so any newer project's cookie failed this test
    // and the reader fell through to `app_state` — which in the seed also says
    // Gundih. That is the whole of "sometimes, on first open, Data Overall is
    // Gundih whatever I had open": not a stale render, a cookie silently
    // overruled by bytes that had not arrived yet.
    //
    // So a MISS re-checks against fresh bytes before giving up. An archived
    // project still falls through, because that is a real answer.
    const known = getProject(chosen) !== null;
    if (!known) {
      await ensureFreshDb(true);
      if (isOpenable(chosen)) return chosen;
    }
  }

  const state = db.select().from(schema.appState).where(eq(schema.appState.id, 'singleton')).all()[0];
  if (state?.activeProjectId && isOpenable(state.activeProjectId)) return state.activeProjectId;
  const first = db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(isNull(schema.projects.archivedAt))
    .orderBy(asc(schema.projects.createdAt))
    .all()[0];
  return first?.id ?? null;
}

/** Live and not archived — the two ways a stored pointer goes bad. */
function isOpenable(id: string): boolean {
  const row = db
    .select({ id: schema.projects.id, archivedAt: schema.projects.archivedAt })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .all()[0];
  return !!row && !row.archivedAt;
}

export function getProject(projectId: string) {
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0] ?? null;
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
    // Stable, so everything behind the open card keeps the newest-touch order
    // the query just gave it.
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
