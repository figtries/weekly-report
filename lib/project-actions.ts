'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';

import { db, schema } from './sqlite';

/**
 * Projects — the writes.
 *
 * Split from `lib/projects.ts` because `'use server'` at the top of a file
 * turns every export into a server action, and the reads must stay plain
 * synchronous functions that prerender.
 *
 * Two rules hold this file together.
 *
 * **A new project is born alive.** Asking only for a name produced the dead row
 * this screen exists to fix: no dates means no weeks, no weeks means nothing to
 * open. So `createProject` takes start and finish, generates the week rows, and
 * opens an `active` baseline for the schedule to hang off. There is no
 * `contractual` baseline yet — you cannot have signed a plan you have not
 * written. Locking one is board item 18.
 *
 * **Deleting says what disappears.** The confirmation is built from
 * `getProjectContents`, not from the word "sure".
 */

export type ProjectResult = { ok: true; id: string } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function touch(projectId: string) {
  db.update(schema.projects)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId))
    .run();
}

function revalidateEverything() {
  // Switching project changes what EVERY destination shows, not just this page.
  revalidatePath('/', 'layout');
}

/**
 * Seven-day blocks from the project start, the last one clipped at the finish.
 *
 * Gundih's weeks end on a Thursday because its reporting week does; that is a
 * per-project agreement nobody has been asked for yet, so a new project gets
 * the one rule that needs no answer — week 1 starts the day the project does.
 */
function weekRowsFor(projectId: string, startDate: string, finishDate: string) {
  const start = utc(startDate);
  const finish = utc(finishDate);
  const rows: { id: string; projectId: string; weekNo: number; startDate: string; endDate: string }[] = [];
  let cursor = start;
  let n = 1;
  // 20 years of weeks is far past any EPC contract and stops a typo'd century
  // from trying to write a million rows.
  while (cursor <= finish && n <= 1040) {
    const end = Math.min(cursor + 6 * MS_PER_DAY, finish);
    rows.push({
      id: `${projectId}:W${n}`,
      projectId,
      weekNo: n,
      startDate: iso(cursor),
      endDate: iso(end),
    });
    cursor = end + MS_PER_DAY;
    n += 1;
  }
  return rows;
}

export async function createProjectAction(input: {
  name: string;
  clientName?: string;
  /** Not asked for at creation — it belongs to the project page, once one exists. */
  contractorName?: string;
  startDate: string;
  finishDate: string;
}): Promise<ProjectResult> {
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Give the project a name');
    if (!ISO_DATE.test(input.startDate)) throw new Error('Start date is not a date');
    if (!ISO_DATE.test(input.finishDate)) throw new Error('Finish date is not a date');
    if (utc(input.finishDate) < utc(input.startDate)) {
      throw new Error('The finish date is before the start date');
    }

    const id = `p${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
    const now = new Date().toISOString();
    const weeks = weekRowsFor(id, input.startDate, input.finishDate);

    db.transaction((tx) => {
      tx.insert(schema.projects)
        .values({
          id,
          name,
          clientName: input.clientName?.trim() || null,
          contractorName: input.contractorName?.trim() || null,
          startDate: input.startDate,
          finishDate: input.finishDate,
          updatedAt: now,
          // Weight comes from prices, and there are none yet. `even` is the
          // honest label until a BOQ exists — see AGENTS.md.
          weightBasis: 'even',
        })
        .run();

      tx.insert(schema.baselines)
        .values({ id: `${id}:active`, projectId: id, kind: 'active', revisionNo: 0, label: 'Working plan' })
        .run();

      if (weeks.length) tx.insert(schema.weeks).values(weeks).run();

      tx.insert(schema.appState)
        .values({ id: 'singleton', activeProjectId: id, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.appState.id,
          set: { activeProjectId: id, updatedAt: now },
        })
        .run();
    });

    revalidateEverything();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function setActiveProjectAction(projectId: string): Promise<ProjectResult> {
  try {
    const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0];
    if (!p) throw new Error('Project not found');
    if (p.archivedAt) throw new Error('That project is archived');
    const now = new Date().toISOString();
    db.insert(schema.appState)
      .values({ id: 'singleton', activeProjectId: projectId, updatedAt: now })
      .onConflictDoUpdate({ target: schema.appState.id, set: { activeProjectId: projectId, updatedAt: now } })
      .run();
    revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export async function renameProjectAction(projectId: string, name: string): Promise<ProjectResult> {
  try {
    const clean = name.trim();
    if (!clean) throw new Error('A project needs a name');
    db.update(schema.projects)
      .set({ name: clean, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId))
      .run();
    revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export async function setProjectArchivedAction(
  projectId: string,
  archived: boolean
): Promise<ProjectResult> {
  try {
    const live = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.projects)
      .where(sql`${schema.projects.archivedAt} is null`)
      .all()[0];
    if (archived && Number(live?.n ?? 0) <= 1) {
      throw new Error('This is the only live project — archiving it would leave nothing open');
    }
    db.update(schema.projects)
      .set({ archivedAt: archived ? new Date().toISOString() : null, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId))
      .run();
    // Archiving the open project leaves the pointer dangling at something the
    // list no longer shows; getActiveProjectId falls through, but the stored
    // pointer should follow rather than rot.
    const state = db.select().from(schema.appState).where(eq(schema.appState.id, 'singleton')).all()[0];
    if (archived && state?.activeProjectId === projectId) {
      const next = db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(sql`${schema.projects.archivedAt} is null`)
        .all()[0];
      db.update(schema.appState)
        .set({ activeProjectId: next?.id ?? null, updatedAt: new Date().toISOString() })
        .where(eq(schema.appState.id, 'singleton'))
        .run();
    }
    revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Really gone, with every child row it owns — `wbs_nodes`, `weeks`,
 * `leaf_progress`, `documents` and the rest cascade. The UI must have named
 * those counts before this is called.
 */
export async function deleteProjectAction(projectId: string): Promise<ProjectResult> {
  try {
    const all = db.select({ id: schema.projects.id }).from(schema.projects).all();
    if (all.length <= 1) throw new Error('The last project cannot be deleted');
    db.delete(schema.projects).where(eq(schema.projects.id, projectId)).run();
    const state = db.select().from(schema.appState).where(eq(schema.appState.id, 'singleton')).all()[0];
    if (!state?.activeProjectId) {
      const next = db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(sql`${schema.projects.archivedAt} is null`)
        .all()[0];
      if (next) {
        db.update(schema.appState)
          .set({ activeProjectId: next.id, updatedAt: new Date().toISOString() })
          .where(eq(schema.appState.id, 'singleton'))
          .run();
      }
    }
    revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export async function updateProjectFieldAction(
  projectId: string,
  field: 'clientName' | 'contractorName' | 'contractNo' | 'workLocation' | 'docNoPrefix',
  value: string
): Promise<ProjectResult> {
  try {
    const clean = value.trim() || null;
    db.update(schema.projects)
      .set({ [field]: clean, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId))
      .run();
    touch(projectId);
    revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}
