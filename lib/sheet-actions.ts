'use server';

import { requireEdit } from './auth/require-edit';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { inclusiveDays } from './plan-curve';
import { boxAbove, coverChildren, getActiveBaselineId, getSheet, rowSpan, type Sheet } from './sheet';
import { saveRowLinksSqlite } from './links-sqlite';
import { lockContractSqlite } from './contract-sqlite';
import type { StoredLink } from './links';
import { conflictMoves } from './chains';
import { projectOfNode, syncDerivedWeights } from './weights-auto';
import { budgetRefusal } from './weights-read';

export type SheetResult =
  | { ok: true; startDate: string | null; finishDate: string | null; durationDays: number | null }
  | { ok: false; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(iso: string, days: number): string {
  return new Date(utc(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

async function landed(): Promise<void> {
  revalidatePath('/projects', 'layout');
}

async function hasChildren(nodeId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.wbsNodes.id })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.parentId, nodeId));
  return rows.length > 0;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function human(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

async function whyNotFits(
  nodeId: string,
  baselineId: string,
  start: string,
  finish: string
): Promise<string | null> {
  const box = await boxAbove(nodeId, baselineId);
  if (box && (start < box.start || finish > box.finish)) {
    return `${box.name} runs ${human(box.start)} to ${human(box.finish)} — this row has to sit inside it`;
  }
  const kids = await db
    .select({ id: schema.wbsNodes.id, name: schema.wbsNodes.deskripsi })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.parentId, nodeId));
  for (const k of kids) {
    const s = await rowSpan(k.id, baselineId);
    if (!s) continue;
    if (s.start < start || s.finish > finish) {
      return `${k.name} runs ${human(s.start)} to ${human(s.finish)}, outside those dates — move it first`;
    }
  }
  return null;
}

async function checkFits(nodeId: string, baselineId: string, start: string, finish: string): Promise<void> {
  const why = await whyNotFits(nodeId, baselineId, start, finish);
  if (why) throw new Error(why);
}

export async function updateRowTextAction(
  nodeId: string,
  field: 'name' | 'price',
  value: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireEdit();
  try {
    if (field === 'name') {
      const clean = value.trim();
      if (!clean) throw new Error('A row needs a name');
      await db.update(schema.wbsNodes).set({ deskripsi: clean }).where(eq(schema.wbsNodes.id, nodeId));
    } else {
      const raw = value.replace(/[^0-9.-]/g, '');
      const n = raw === '' ? null : Number(raw);
      if (n !== null && (!Number.isFinite(n) || n < 0)) throw new Error('That is not a price');
      const price = n === 0 ? null : n;
      const projectId = await projectOfNode(nodeId);
      const refusal = projectId ? await budgetRefusal(projectId, nodeId, price) : null;
      if (refusal) throw new Error(refusal);
      await db
        .update(schema.wbsNodes)
        .set({ price, workstepFactor: null })
        .where(eq(schema.wbsNodes.id, nodeId));
      if (projectId) await syncDerivedWeights(projectId);
    }
    await landed();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateRowTargetAction(
  nodeId: string,
  value: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireEdit();
  try {
    const raw = value.trim();
    if (raw && !ISO.test(raw)) throw new Error('That is not a date');
    await db.update(schema.wbsNodes)
      .set({ targetDate: raw || null })
      .where(eq(schema.wbsNodes.id, nodeId));
    await landed();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateRowDatesAction(
  nodeId: string,
  edited: 'duration' | 'start' | 'finish',
  value: string
): Promise<SheetResult> {
  await requireEdit();
  try {
    const nodeRows = await db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId));
    const node = nodeRows[0];
    if (!node) throw new Error('Row not found');

    const baselineId = await getActiveBaselineId(node.projectId);
    if (!baselineId) throw new Error('This project has no schedule yet');

    await coverChildren(node.projectId, baselineId);

    const currentRows = await db
      .select()
      .from(schema.nodeSchedules)
      .where(
        and(eq(schema.nodeSchedules.baselineId, baselineId), eq(schema.nodeSchedules.nodeId, nodeId))
      );
    const current = currentRows[0];

    const shown = await rowSpan(nodeId, baselineId);
    let start = current?.startDate ?? shown?.start ?? null;
    let finish = current?.finishDate ?? shown?.finish ?? null;
    let duration = current?.durationDays ?? (start && finish ? inclusiveDays(start, finish) : null);

    if (edited === 'duration') {
      const d = Math.round(Number(value.replace(/[^0-9.-]/g, '')));
      if (!Number.isFinite(d) || d < 0) throw new Error('Duration is a number of days');
      duration = node.isMilestone ? 0 : d;
      if (!start) start = node.createdAt.slice(0, 10);
      finish = addDays(start, Math.max(0, duration - 1));
      if (duration === 0) finish = start;
    } else if (edited === 'start') {
      if (!ISO.test(value)) throw new Error('That is not a date');
      const heldFinish = finish;
      start = value;
      const keep = duration && duration > 0 ? duration : 1;
      finish = addDays(start, keep - 1);
      duration = keep;

      if (heldFinish && finish > heldFinish && start <= heldFinish) {
        const [wouldFail, wouldFit] = await Promise.all([
          whyNotFits(nodeId, baselineId, start, finish),
          whyNotFits(nodeId, baselineId, start, heldFinish),
        ]);
        if (wouldFail && !wouldFit) {
          finish = heldFinish;
          duration = inclusiveDays(start, finish);
        }
      }
    } else {
      if (!ISO.test(value)) throw new Error('That is not a date');
      if (!start) throw new Error('Give the row a start date first');
      if (utc(value) < utc(start)) throw new Error('The finish is before the start');
      finish = value;
      duration = inclusiveDays(start, finish);
    }

    if (start && finish) await checkFits(nodeId, baselineId, start, finish);

    const row = {
      id: current?.id ?? `${baselineId}:${nodeId}`,
      baselineId,
      nodeId,
      startDate: start!,
      finishDate: finish!,
      durationDays: duration!,
    };
    await db.insert(schema.nodeSchedules)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.nodeSchedules.baselineId, schema.nodeSchedules.nodeId],
        set: { startDate: row.startDate, finishDate: row.finishDate, durationDays: row.durationDays },
      });

    await db.update(schema.projects)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, node.projectId));

    await landed();
    return { ok: true, startDate: start, finishDate: finish, durationDays: duration };
  } catch (e) {
    return fail(e);
  }
}

export async function setMilestoneAction(nodeId: string, on: boolean): Promise<SheetResult> {
  await requireEdit();
  try {
    const nodeRows = await db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId));
    const node = nodeRows[0];
    if (!node) throw new Error('Row not found');
    if (await hasChildren(nodeId)) throw new Error('A summary row cannot be a milestone');

    await db.update(schema.wbsNodes)
      .set(on ? { isMilestone: true, price: null, workstepFactor: null } : { isMilestone: false })
      .where(eq(schema.wbsNodes.id, nodeId));
    if (on && ((node.price ?? 0) > 0 || (node.workstepFactor ?? 0) > 0)) {
      await syncDerivedWeights(node.projectId);
    }

    const baselineId = await getActiveBaselineId(node.projectId);
    const currentRows = baselineId
      ? await db
          .select()
          .from(schema.nodeSchedules)
          .where(
            and(
              eq(schema.nodeSchedules.baselineId, baselineId),
              eq(schema.nodeSchedules.nodeId, nodeId)
            )
          )
      : [];
    const current = currentRows[0];

    if (on && baselineId && current) {
      await db.update(schema.nodeSchedules)
        .set({ finishDate: current.startDate, durationDays: 0 })
        .where(eq(schema.nodeSchedules.id, current.id));
      await landed();
      return { ok: true, startDate: current.startDate, finishDate: current.startDate, durationDays: 0 };
    }

    await landed();
    return {
      ok: true,
      startDate: current?.startDate ?? null,
      finishDate: current?.finishDate ?? null,
      durationDays: current?.durationDays ?? null,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function moveFollowersAction(
  projectId: string,
  fromIds: string[]
): Promise<{ ok: true; moved: number; sheet: Sheet } | { ok: false; error: string }> {
  await requireEdit();
  try {
    const baselineId = await getActiveBaselineId(projectId);
    if (!baselineId) throw new Error('This project has no schedule yet');
    const sheet = await getSheet(projectId);
    const known = new Set(sheet.rows.map((r) => r.id));
    const moves = conflictMoves(
      sheet.rows,
      fromIds.filter((id) => known.has(id)),
      new Map(sheet.rows.map((r) => [r.id, r.name]))
    );
    await db.transaction(async (tx) => {
      for (const m of moves) {
        await tx.update(schema.nodeSchedules)
          .set({ startDate: m.toStart, finishDate: m.toFinish })
          .where(and(eq(schema.nodeSchedules.baselineId, baselineId), eq(schema.nodeSchedules.nodeId, m.id)));
      }
      if (moves.length) await coverChildren(projectId, baselineId, tx);
    });
    await landed();
    return { ok: true, moved: moves.length, sheet: await getSheet(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function saveRowLinksAction(
  nodeId: string,
  waitsFor: StoredLink[],
  holdsUp: StoredLink[]
): Promise<{ ok: true; sheet: Sheet } | { ok: false; error: string }> {
  await requireEdit();
  try {
    const projectId = await projectOfNode(nodeId);
    if (!projectId) throw new Error('Row not found');
    await saveRowLinksSqlite(projectId, nodeId, waitsFor, holdsUp);
    await landed();
    return { ok: true, sheet: await getSheet(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function lockContractAction(
  projectId: string,
  reason: string
): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  await requireEdit();
  try {
    const { rows } = await lockContractSqlite(projectId, reason);
    await landed();
    return { ok: true, rows };
  } catch (e) {
    return fail(e);
  }
}
