'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { eq, sql } from 'drizzle-orm';

import { beforeWrite, db, flushDbSnapshot, schema } from './sqlite';
import { syncDerivedWeights } from './weights-auto';
import { isKnownCurrency } from './currency';
import { deriveInitial, INITIAL_LENGTH } from './initial';
import { OPEN_PROJECT_COOKIE, OPEN_PROJECT_COOKIE_MAX_AGE } from './projects';

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

async function revalidateEverything() {
  // Switching project changes what EVERY destination shows, not just this page.
  revalidatePath('/', 'layout');
  // And on a deployment it changes what OTHER INSTANCES show, which they only
  // learn from the blob store. Awaited rather than left to after(): every
  // one of these actions is followed immediately by a navigation, and a push
  // still in flight is a redirect landing on a project the next lambda has
  // never heard of. No store attached, no wait — the call returns at once.
  await flushDbSnapshot();
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
  /**
   * The project's INITIAL, three letters. Blank is normal: `deriveInitial`
   * fills it from the name, and the dialog shows that guess as its placeholder
   * so nobody is surprised by what lands. Longer than three is truncated here
   * rather than rejected — there is nothing to tell a caller off about.
   */
  alias?: string | null;
  clientName?: string;
  /** Not asked for at creation — it belongs to the project page, once one exists. */
  contractorName?: string;
  startDate: string;
  finishDate: string;
  /**
   * The SIGNED contract value. Asked here because a contract exists before a
   * single WBS row does — deriving it from prices later forced signed and
   * allocated to be equal, which deleted the gap between them.
   */
  contractValue?: number | null;
  currency?: string;
}): Promise<ProjectResult> {
  await beforeWrite();
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Give the project a name');
    if (!ISO_DATE.test(input.startDate)) throw new Error('Start date is not a date');
    if (!ISO_DATE.test(input.finishDate)) throw new Error('Finish date is not a date');
    if (utc(input.finishDate) < utc(input.startDate)) {
      throw new Error('The finish date is before the start date');
    }

    // Typed wins; otherwise the guess. Empty after both means a name with no
    // letters or digits in it at all, and null is the honest answer for that.
    // Derived HERE rather than in the dialog so a project created by any other
    // path — a script, a future importer — gets one too.
    //
    // The cap is enforced here as well as on the input. `maxLength` on a text
    // field is a courtesy to whoever is typing, not a rule: a payload that
    // never went through the dialog would otherwise store a fourth letter.
    const alias =
      (input.alias?.trim().toUpperCase().slice(0, INITIAL_LENGTH) || deriveInitial(name)) || null;

    const id = `p${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
    const now = new Date().toISOString();
    const weeks = weekRowsFor(id, input.startDate, input.finishDate);

    db.transaction((tx) => {
      tx.insert(schema.projects)
        .values({
          id,
          name,
          alias,
          // The document number prefix starts as the alias because they want
          // the same thing: a short, stable handle for this project. It stays
          // separately editable on the project page, and nothing here ever
          // overwrites a prefix that already exists.
          docNoPrefix: alias,
          clientName: input.clientName?.trim() || null,
          contractorName: input.contractorName?.trim() || null,
          startDate: input.startDate,
          finishDate: input.finishDate,
          updatedAt: now,
          contractValue: input.contractValue ?? null,
          currency: input.currency && isKnownCurrency(input.currency) ? input.currency : 'IDR',
          // Weight comes from prices, and there are none yet. `even` is the
          // honest label until a BOQ exists — see AGENTS.md.
          // Not 'boq': 'boq' is the LOCK that keeps a derivation away from
          // weights nobody could re-derive, and a project with no prices yet
          // has none to protect. See lib/weights-auto.ts.
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

    await revalidateEverything();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function setActiveProjectAction(projectId: string): Promise<ProjectResult> {
  await beforeWrite();
  try {
    const p = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0];
    if (!p) throw new Error('Project not found');
    if (p.archivedAt) throw new Error('That project is archived');
    // Weights, before the dashboard is asked for them.
    //
    // Every edit keeps them in step now (lib/weights-auto.ts), but a project
    // priced BEFORE that was true sits there with prices and no weights, and
    // the front page answers "has no weights yet" for a plan that is finished.
    // Opening a project is the moment to settle that: it already writes, it is
    // the last thing to happen before every figure in the app is read, and on
    // a project with nothing to change it writes nothing and costs nothing.
    syncDerivedWeights(projectId);
    const now = new Date().toISOString();
    db.insert(schema.appState)
      .values({ id: 'singleton', activeProjectId: projectId, updatedAt: now })
      .onConflictDoUpdate({ target: schema.appState.id, set: { activeProjectId: projectId, updatedAt: now } })
      .run();
    // The cookie is the one that counts (see lib/projects.ts). The row above is
    // kept as the answer for a browser that has never chosen — and because on
    // a real machine, with one database, the two agree anyway.
    const jar = await cookies();
    jar.set(OPEN_PROJECT_COOKIE, projectId, {
      maxAge: OPEN_PROJECT_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    });
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export async function renameProjectAction(projectId: string, name: string): Promise<ProjectResult> {
  await beforeWrite();
  try {
    const clean = name.trim();
    if (!clean) throw new Error('A project needs a name');
    db.update(schema.projects)
      .set({ name: clean, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId))
      .run();
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export async function setProjectArchivedAction(
  projectId: string,
  archived: boolean
): Promise<ProjectResult> {
  await beforeWrite();
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
    await revalidateEverything();
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
  await beforeWrite();
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
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Everything a project is, apart from its plan.
 *
 * This existed for a day as dead code — written, exported, never called from
 * anywhere — which is why a project made in the app could never be given a
 * contractor, a contract number, a site, or a document-number prefix. Document
 * Control cannot number a single drawing without that last one.
 *
 * The contract value is here because of decision ②: it is SIGNED, typed by a
 * person, not derived from whatever prices happen to have been entered. What is
 * derived is how much of it has been allocated, and the gap between the two is
 * the most useful number on the project screen.
 */
export type ProjectField =
  | 'name'
  /**
   * The three-letter initial. It was writable only by `createProjectAction`
   * until 12 Sep 2026, which left it stranded: a typo was permanent, and the
   * three projects that predate the column had no way to be given one at all.
   */
  | 'alias'
  | 'clientName'
  | 'contractorName'
  | 'contractNo'
  | 'workLocation'
  | 'docNoPrefix'
  /**
   * The two report document numbers. `lib/dashboard-db.ts` has always READ
   * these into the printed header, and until 12 Sep 2026 nothing could write
   * them: two columns the client's own deliverable prints, with no way in.
   */
  | 'documentNoWeekly'
  | 'documentNoDaily'
  | 'contractValue'
  | 'startDate'
  | 'finishDate';

export async function updateProjectFieldAction(
  projectId: string,
  field: ProjectField,
  value: string
): Promise<ProjectResult> {
  await beforeWrite();
  try {
    const raw = value.trim();
    let next: string | number | null = raw || null;

    if (field === 'name' && !raw) throw new Error('A project needs a name');

    // The same shaping the creation path does, for the same reason: `maxLength`
    // on the input is a courtesy to whoever is typing, not a rule. Cleared on
    // purpose is allowed — null means the UI falls back to the full name.
    if (field === 'alias') next = raw.toUpperCase().slice(0, INITIAL_LENGTH) || null;

    if (field === 'contractValue') {
      const n = raw === '' ? null : Number(raw.replace(/[^0-9.]/g, ''));
      if (n !== null && (!Number.isFinite(n) || n < 0)) throw new Error('That is not a contract value');
      next = n;
    }

    if (field === 'startDate' || field === 'finishDate') {
      if (raw && !ISO_DATE.test(raw)) throw new Error('That is not a date');
      next = raw || null;
    }

    db.update(schema.projects)
      .set({ [field]: next, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId))
      .run();
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

/**
 * The currency a project is priced in.
 *
 * Changing it RELABELS, it does not convert. A figure typed as 12,313 stays
 * 12,313 — the app holds no exchange rate, and inventing one would silently
 * restate a signed contract. The list itself lives in lib/currency.ts, because
 * a  file may only export async functions.
 */
export async function setProjectCurrencyAction(
  projectId: string,
  currency: string
): Promise<ProjectResult> {
  await beforeWrite();
  try {
    const code = currency.trim().toUpperCase();
    if (!isKnownCurrency(code)) throw new Error('That currency is not one this app knows');
    db.update(schema.projects)
      .set({ currency: code, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId))
      .run();
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}
