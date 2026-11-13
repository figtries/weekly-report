'use server';

import { requireEdit } from './auth/require-edit';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { eq, isNull, sql } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { syncDerivedWeights } from './weights-auto';
import { formatMoney, isKnownCurrency } from './currency';
import { deriveWeights } from './weights';
import { loadWeightNodes } from './weights-read';
import { deriveInitial, INITIAL_LENGTH } from './initial';
import { FIELDS, fieldOf } from './fields';
import { SIGNATURE_PARTS, mergeSignature, type SignatureField } from './signature';
import { OPEN_PROJECT_COOKIE, OPEN_PROJECT_COOKIE_MAX_AGE } from './projects';
import { relayWeeks, weekRowsFor } from './week-grid';
import { currentWeekForProject } from './data';

/**
 * Projects — the writes.
 */

export type ProjectResult =
  | { ok: true; id: string; week?: number | null }
  | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

async function touch(projectId: string) {
  await db.update(schema.projects)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId));
}

async function revalidateEverything() {
  revalidatePath('/', 'layout');
}

export async function createProjectAction(input: {
  name: string;
  alias?: string | null;
  field?: string | null;
  clientName?: string;
  contractorName?: string;
  startDate: string;
  finishDate: string;
  contractValue?: number | null;
  currency?: string;
}): Promise<ProjectResult> {
  await requireEdit();
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Give the project a name');
    if (!(Number(input.contractValue) > 0)) throw new Error('Give the contract value');
    if (!ISO_DATE.test(input.startDate)) throw new Error('Start date is not a date');
    if (!ISO_DATE.test(input.finishDate)) throw new Error('Finish date is not a date');
    if (utc(input.finishDate) < utc(input.startDate)) {
      throw new Error('The finish date is before the start date');
    }

    const alias =
      (input.alias?.trim().toUpperCase().slice(0, INITIAL_LENGTH) || deriveInitial(name)) || null;

    const id = `p${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
    const now = new Date().toISOString();
    const weeks = weekRowsFor(id, input.startDate, input.finishDate);

    await db.transaction(async (tx) => {
      await tx.insert(schema.projects).values({
        id,
        name,
        alias,
        docNoPrefix: alias,
        clientName: input.clientName?.trim() || null,
        contractorName: input.contractorName?.trim() || null,
        startDate: input.startDate,
        finishDate: input.finishDate,
        updatedAt: now,
        contractValue: input.contractValue ?? null,
        field: fieldOf(input.field).id,
        currency: input.currency && isKnownCurrency(input.currency) ? input.currency : 'IDR',
        weightBasis: 'even',
      });

      await tx.insert(schema.baselines).values({
        id: `${id}:active`,
        projectId: id,
        kind: 'active',
        revisionNo: 0,
        label: 'Working plan',
      });

      if (weeks.length) await tx.insert(schema.weeks).values(weeks);

      await tx.insert(schema.appState)
        .values({ id: 'singleton', activeProjectId: id, updatedAt: now })
        .onConflictDoUpdate({
          target: schema.appState.id,
          set: { activeProjectId: id, updatedAt: now },
        });
    });

    await revalidateEverything();
    return { ok: true, id };
  } catch (e) {
    return fail(e);
  }
}

export async function setActiveProjectAction(projectId: string): Promise<ProjectResult> {
  await requireEdit();
  try {
    const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    const p = rows[0];
    if (!p) throw new Error('Project not found');
    if (p.archivedAt) throw new Error('That project is archived');
    await syncDerivedWeights(projectId);
    const now = new Date().toISOString();
    await db.insert(schema.appState)
      .values({ id: 'singleton', activeProjectId: projectId, updatedAt: now })
      .onConflictDoUpdate({ target: schema.appState.id, set: { activeProjectId: projectId, updatedAt: now } });
    const jar = await cookies();
    jar.set(OPEN_PROJECT_COOKIE, projectId, {
      maxAge: OPEN_PROJECT_COOKIE_MAX_AGE,
      path: '/',
      sameSite: 'lax',
      httpOnly: true,
    });
    await revalidateEverything();
    let week: number | null = null;
    try {
      week = await currentWeekForProject(projectId);
    } catch {
      week = null;
    }
    return { ok: true, id: projectId, week };
  } catch (e) {
    return fail(e);
  }
}

export async function renameProjectAction(projectId: string, name: string): Promise<ProjectResult> {
  await requireEdit();
  try {
    const clean = name.trim();
    if (!clean) throw new Error('A project needs a name');
    await db.update(schema.projects)
      .set({ name: clean, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId));
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
  await requireEdit();
  try {
    const liveRows = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.projects)
      .where(isNull(schema.projects.archivedAt));
    if (archived && Number(liveRows[0]?.n ?? 0) <= 1) {
      throw new Error('This is the only live project — archiving it would leave nothing open');
    }
    await db.update(schema.projects)
      .set({ archivedAt: archived ? new Date().toISOString() : null, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId));
    const stateRows = await db.select().from(schema.appState).where(eq(schema.appState.id, 'singleton'));
    if (archived && stateRows[0]?.activeProjectId === projectId) {
      const nextRows = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(isNull(schema.projects.archivedAt));
      await db.update(schema.appState)
        .set({ activeProjectId: nextRows[0]?.id ?? null, updatedAt: new Date().toISOString() })
        .where(eq(schema.appState.id, 'singleton'));
    }
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteProjectAction(projectId: string): Promise<ProjectResult> {
  await requireEdit();
  try {
    const all = await db.select({ id: schema.projects.id }).from(schema.projects);
    if (all.length <= 1) throw new Error('The last project cannot be deleted');
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    const stateRows = await db.select().from(schema.appState).where(eq(schema.appState.id, 'singleton'));
    if (!stateRows[0]?.activeProjectId) {
      const nextRows = await db
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(isNull(schema.projects.archivedAt));
      if (nextRows[0]) {
        await db.update(schema.appState)
          .set({ activeProjectId: nextRows[0].id, updatedAt: new Date().toISOString() })
          .where(eq(schema.appState.id, 'singleton'));
      }
    }
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export type ProjectField =
  | 'name'
  | 'alias'
  | 'clientName'
  | 'contractorName'
  | 'contractNo'
  | 'workLocation'
  | 'docNoPrefix'
  | 'documentNoWeekly'
  | 'documentNoDaily'
  | 'signatureLeftCompany'
  | 'signatureLeftName'
  | 'signatureRightCompany'
  | 'signatureRightName'
  | 'contractValue'
  | 'startDate'
  | 'finishDate'
  | 'field';

export async function updateProjectFieldAction(
  projectId: string,
  field: ProjectField,
  value: string
): Promise<ProjectResult> {
  await requireEdit();
  try {
    const raw = value.trim();
    let next: string | number | null = raw || null;

    if (field === 'name' && !raw) throw new Error('A project needs a name');
    if (field === 'field' && !FIELDS.some((f) => f.id === raw)) throw new Error('Pick one of the fields on the list');

    if (field === 'alias') next = raw.toUpperCase().slice(0, INITIAL_LENGTH) || null;

    if (field === 'contractValue') {
      const n = raw === '' ? null : Number(raw.replace(/[^0-9.]/g, ''));
      if (n !== null && (!Number.isFinite(n) || n < 0)) throw new Error('That is not a contract value');
      if (n != null && n > 0) {
        const nodes = await loadWeightNodes(projectId);
        const budget = deriveWeights(nodes).projectBudget;
        const projectRows = await db
          .select({ was: schema.projects.contractValue, currency: schema.projects.currency })
          .from(schema.projects)
          .where(eq(schema.projects.id, projectId));
        const row = projectRows[0];
        if (n < budget - 0.5 && (row?.was == null || n < row.was)) {
          const say = (v: number) => formatMoney(v, row?.currency ?? 'IDR');
          throw new Error(
            `The work packages already add up to ${say(budget)}. Keep the contract value at ${say(budget)} or more, or lower a work package on Weights first.`
          );
        }
      }
      next = n;
    }

    if (field === 'startDate' || field === 'finishDate') {
      if (raw && !ISO_DATE.test(raw)) throw new Error('That is not a date');
      next = raw || null;
    }

    const sig = SIGNATURE_PARTS[field as SignatureField];
    if (sig) {
      const projectRows = await db
        .select({ left: schema.projects.signatureLeft, right: schema.projects.signatureRight })
        .from(schema.projects)
        .where(eq(schema.projects.id, projectId));
      const row = projectRows[0];
      if (!row) throw new Error('That project is gone');
      const stored = sig.column === 'signatureLeft' ? row.left : row.right;
      await db.update(schema.projects)
        .set({
          [sig.column]: mergeSignature(stored, field as SignatureField, raw),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.projects.id, projectId));
      await revalidateEverything();
      return { ok: true, id: projectId };
    }

    await db.update(schema.projects)
      .set({ [field]: next, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId));
    if (field === 'startDate' || field === 'finishDate') await relayWeeks(projectId);
    if (field === 'contractValue') await syncDerivedWeights(projectId);
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}

export async function setProjectCurrencyAction(
  projectId: string,
  currency: string
): Promise<ProjectResult> {
  await requireEdit();
  try {
    const code = currency.trim().toUpperCase();
    if (!isKnownCurrency(code)) throw new Error('That currency is not one this app knows');
    await db.update(schema.projects)
      .set({ currency: code, updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, projectId));
    await revalidateEverything();
    return { ok: true, id: projectId };
  } catch (e) {
    return fail(e);
  }
}
