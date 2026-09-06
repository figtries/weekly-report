'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { inclusiveDays } from './plan-curve';
import { getActiveBaselineId } from './sheet';

/**
 * The schedule sheet — the writes.
 *
 * **The triangle.** Duration, start and finish are three views of two facts, and
 * all three can be typed. The rule is that the one you just typed wins and the
 * cheapest other one moves:
 *
 *   type DURATION → start stays, finish moves
 *   type START    → duration stays, finish moves   (Microsoft Project's rule)
 *   type FINISH   → start stays, duration is recomputed
 *
 * Typing a start could equally have held the finish and stretched the duration.
 * It does not, because a start date usually moves when work slips, and work
 * that slips takes just as long as it always did — holding the finish would
 * silently compress the job instead.
 *
 * **Summary rows refuse date writes.** Their span is their children's, computed
 * on read. This is the one behaviour of MS Project this sheet deliberately
 * removes: there, typing a duration onto a summary quietly detaches it from its
 * children and the schedule starts lying.
 *
 * **Writes land on the ACTIVE baseline.** The contractual one is claim
 * evidence; nothing on an editing screen may reach it.
 */

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

function hasChildren(nodeId: string): boolean {
  return (
    db.select({ id: schema.wbsNodes.id }).from(schema.wbsNodes).where(eq(schema.wbsNodes.parentId, nodeId)).all()
      .length > 0
  );
}

/** Renaming and pricing are the two writes that touch no dates at all. */
export async function updateRowTextAction(
  nodeId: string,
  field: 'name' | 'price',
  value: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (field === 'name') {
      const clean = value.trim();
      if (!clean) throw new Error('A row needs a name');
      db.update(schema.wbsNodes).set({ deskripsi: clean }).where(eq(schema.wbsNodes.id, nodeId)).run();
    } else {
      // A BRANCH MAY BE PRICED, and forbidding it was a contradiction this app
      // held against itself: `lib/weights.ts` is built on a branch price being
      // the value of everything under it, and 27 of Gundih's 37 priced nodes
      // ARE branches. The sheet refused to type what the formula assumed and
      // the data already did.
      const raw = value.replace(/[^0-9.-]/g, '');
      const n = raw === '' ? null : Number(raw);
      if (n !== null && (!Number.isFinite(n) || n < 0)) throw new Error('That is not a price');
      db.update(schema.wbsNodes).set({ price: n }).where(eq(schema.wbsNodes.id, nodeId)).run();
      // NO automatic recompute here, and that is the important part.
      //
      // It used to rewrite every weight in the project from the sum of all
      // prices. On Gundih that would have been a disaster twice over: prices
      // are nested, so the sum triple-counts, and only 95 of its 176 stored
      // weights can be re-derived from prices at all — the other 81 came from
      // the workbook. One keystroke in this column would have replaced them and
      // broken a total that closes at exactly 100.000000.
      //
      // Weight is still derived, never typed. It is derived when someone asks,
      // after being shown what would change: `previewWeights` in lib/weights.ts.
    }
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}


/**
 * The target date — the one date a summary row is allowed to have.
 *
 * It writes to the NODE, not to a schedule, and it moves nothing. That is the
 * whole reason it can sit on a branch while start and finish cannot: a branch's
 * span is an observation about its children and typing over it makes the
 * schedule lie, whereas a deadline is a promise the contract made about the
 * branch itself. Nothing recomputes off the back of this — the row is simply
 * marked when its finish lands past it.
 */
export async function updateRowTargetAction(
  nodeId: string,
  value: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const raw = value.trim();
    if (raw && !ISO.test(raw)) throw new Error('That is not a date');
    db.update(schema.wbsNodes)
      .set({ targetDate: raw || null })
      .where(eq(schema.wbsNodes.id, nodeId))
      .run();
    revalidatePath('/projects', 'layout');
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
  try {
    const node = db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId)).all()[0];
    if (!node) throw new Error('Row not found');
    if (hasChildren(nodeId)) {
      throw new Error('A summary row spans its children — change the rows underneath it');
    }

    const baselineId = getActiveBaselineId(node.projectId);
    if (!baselineId) throw new Error('This project has no schedule yet');

    const current = db
      .select()
      .from(schema.nodeSchedules)
      .where(
        and(eq(schema.nodeSchedules.baselineId, baselineId), eq(schema.nodeSchedules.nodeId, nodeId))
      )
      .all()[0];

    let start = current?.startDate ?? null;
    let finish = current?.finishDate ?? null;
    let duration = current?.durationDays ?? (start && finish ? inclusiveDays(start, finish) : null);

    if (edited === 'duration') {
      const d = Math.round(Number(value.replace(/[^0-9.-]/g, '')));
      if (!Number.isFinite(d) || d < 0) throw new Error('Duration is a number of days');
      duration = node.isMilestone ? 0 : d;
      // A milestone is a point: zero days means start and finish are the same
      // day, not a zero-length span nobody can draw.
      if (!start) start = node.createdAt.slice(0, 10);
      finish = addDays(start, Math.max(0, duration - 1));
      if (duration === 0) finish = start;
    } else if (edited === 'start') {
      if (!ISO.test(value)) throw new Error('That is not a date');
      start = value;
      const keep = duration && duration > 0 ? duration : 1;
      finish = addDays(start, keep - 1);
      duration = keep;
    } else {
      if (!ISO.test(value)) throw new Error('That is not a date');
      if (!start) throw new Error('Give the row a start date first');
      if (utc(value) < utc(start)) throw new Error('The finish is before the start');
      finish = value;
      duration = inclusiveDays(start, finish);
    }

    const row = {
      id: current?.id ?? `${baselineId}:${nodeId}`,
      baselineId,
      nodeId,
      startDate: start!,
      finishDate: finish!,
      durationDays: duration!,
    };
    db.insert(schema.nodeSchedules)
      .values(row)
      .onConflictDoUpdate({
        target: [schema.nodeSchedules.baselineId, schema.nodeSchedules.nodeId],
        set: { startDate: row.startDate, finishDate: row.finishDate, durationDays: row.durationDays },
      })
      .run();

    db.update(schema.projects)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(schema.projects.id, node.projectId))
      .run();

    revalidatePath('/projects', 'layout');
    return { ok: true, startDate: start, finishDate: finish, durationDays: duration };
  } catch (e) {
    return fail(e);
  }
}

/**
 * A milestone is a property of the row, and the zero duration follows from it —
 * not the other way round. MS Project writes `0 days` and leaves you to infer
 * the rest; here a one-day task and a milestone are never confused.
 */
export async function setMilestoneAction(nodeId: string, on: boolean): Promise<SheetResult> {
  try {
    const node = db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId)).all()[0];
    if (!node) throw new Error('Row not found');
    if (hasChildren(nodeId)) throw new Error('A summary row cannot be a milestone');

    db.update(schema.wbsNodes).set({ isMilestone: on }).where(eq(schema.wbsNodes.id, nodeId)).run();

    const baselineId = getActiveBaselineId(node.projectId);
    const current = baselineId
      ? db
          .select()
          .from(schema.nodeSchedules)
          .where(
            and(
              eq(schema.nodeSchedules.baselineId, baselineId),
              eq(schema.nodeSchedules.nodeId, nodeId)
            )
          )
          .all()[0]
      : undefined;

    if (on && baselineId && current) {
      db.update(schema.nodeSchedules)
        .set({ finishDate: current.startDate, durationDays: 0 })
        .where(eq(schema.nodeSchedules.id, current.id))
        .run();
      revalidatePath('/projects', 'layout');
      return { ok: true, startDate: current.startDate, finishDate: current.startDate, durationDays: 0 };
    }

    revalidatePath('/projects', 'layout');
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
