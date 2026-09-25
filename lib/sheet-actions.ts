'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { beforeWrite, db, flushDbSnapshot, schema } from './sqlite';
import { inclusiveDays } from './plan-curve';
import { boxAbove, coverChildren, getActiveBaselineId, rowSpan } from './sheet';
import { addDays as chainAddDays, inferChains, type ChainNode } from './chains';
import { projectOfNode, syncDerivedWeights } from './weights-auto';
import { budgetRefusal } from './weights-read';

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
 * ONE EXCEPTION, and it is about not painting somebody into a corner: when
 * holding the duration would push the finish outside the fence and the row fits
 * perfectly well where it already ends, the finish is held and the duration
 * gives way. Without it, moving a line INSIDE its own package took two edits in
 * one particular order and the refusal said nothing about which — see the
 * `start` branch.
 *
 * **A summary row's dates are its BOX, and everything under it has to fit.**
 * Summary rows used to refuse date writes outright, on MS Project's reasoning
 * that a parent spans its children by definition. On this kind of plan the
 * envelope is the thing people are actually given: a package is awarded with
 * its dates, and the work inside it is planned to fit them. Refusing the write
 * meant the one date somebody had could not be typed anywhere, and adding the
 * first line inside a package silently replaced its 455 days with that line's
 * single day.
 *
 * So a branch can be typed into, and the fence is enforced in both directions
 * instead: a row is refused if it would sit outside the nearest box above it,
 * and a box is refused if it would no longer hold something already inside it.
 * Both refusals NAME the row they are protecting and its dates — a rejection
 * that cannot say what it is protecting is one nobody can act on. Nothing is
 * ever silently clamped: what was typed is either taken or given back.
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

/**
 * Every write here ends in this, and it WAITS for the upload before answering.
 *
 * These five used to answer first and upload the snapshot afterwards, from
 * `after()`. The planner sends its next change the moment the previous one
 * answers, and on the deployment that next change can land on another instance
 * whose pre-write pull (`beforeWrite`) finds the store still holding the bytes
 * from BEFORE the rename. It writes on top of those, pushes the whole file, and
 * whichever push lands last wins. Measured live on the Retrofit project,
 * 25 Sep 2026: two rows added and named one after the other, both renames
 * answered `ok`, and both rows were "New task" in the database afterwards;
 * the name on screen flipped back when the second add's sheet arrived. The
 * same race runs the other way and takes a just-added row with it, which is
 * the row that "hilang". The structural actions have awaited this all along
 * (`settle` in lib/sheet-structure.ts); the cost is the same second of upload,
 * spent behind a screen that has already moved.
 */
async function landed(): Promise<void> {
  revalidatePath('/projects', 'layout');
  await flushDbSnapshot();
}

function hasChildren(nodeId: string): boolean {
  return (
    db.select({ id: schema.wbsNodes.id }).from(schema.wbsNodes).where(eq(schema.wbsNodes.parentId, nodeId)).all()
      .length > 0
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * `29 Dec 25` — the sheet's own format, written out by hand.
 *
 * `toLocaleDateString` resolves differently depending on the ICU the server was
 * built with, and these strings are read next to the columns they are about.
 */
function human(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1] ?? m} ${y.slice(2)}`;
}

/**
 * Does this row still fit the plan around it?
 *
 * Two questions, and both are asked of what the SHEET shows rather than of
 * `node_schedules`: a branch with no dates of its own shows its children's, and
 * a fence it does not draw is not a fence.
 */
function whyNotFits(
  nodeId: string,
  baselineId: string,
  start: string,
  finish: string
): string | null {
  const box = boxAbove(nodeId, baselineId);
  if (box && (start < box.start || finish > box.finish)) {
    return `${box.name} runs ${human(box.start)} to ${human(box.finish)} — this row has to sit inside it`;
  }
  const kids = db
    .select({ id: schema.wbsNodes.id, name: schema.wbsNodes.deskripsi })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.parentId, nodeId))
    .all();
  for (const k of kids) {
    const s = rowSpan(k.id, baselineId);
    if (!s) continue;
    if (s.start < start || s.finish > finish) {
      return `${k.name} runs ${human(s.start)} to ${human(s.finish)}, outside those dates — move it first`;
    }
  }
  return null;
}

function checkFits(nodeId: string, baselineId: string, start: string, finish: string): void {
  const why = whyNotFits(nodeId, baselineId, start, finish);
  if (why) throw new Error(why);
}

/**
 * Renaming and budgeting a row: the writes that touch no dates.
 *
 * A BUDGET IS THE ONLY WAY A ROW GETS WEIGHT (24 Sep 2026). The Weights screen
 * used to take a percent here as well, written to `workstep_factor`, and the
 * row carried two different percents at once: the one typed (a share of its
 * parent) and the one beside it (a share of the SPK). The screen still lets a
 * percent be TYPED, but it turns it into money before it gets here, so this
 * door takes money and nothing else.
 */
export async function updateRowTextAction(
  nodeId: string,
  field: 'name' | 'price',
  value: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await beforeWrite();
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
      // ZERO IS EMPTY: a stored 0 read back as a row somebody had decided.
      const price = n === 0 ? null : n;
      const projectId = projectOfNode(nodeId);
      // THE CAP, checked here as well as on screen, because three screens reach
      // this action and only one of them draws the pools.
      const refusal = projectId ? budgetRefusal(projectId, nodeId, price) : null;
      if (refusal) throw new Error(refusal);
      // A price CLEARS a stored percent: a row holding both would show one
      // figure and report another. So does clearing the box, because the box
      // was showing that percent as money and emptying it means no budget.
      db
        .update(schema.wbsNodes)
        .set({ price, workstepFactor: null })
        .where(eq(schema.wbsNodes.id, nodeId))
        .run();
      // Weight follows the price — BUT ONLY WHERE THERE IS NOTHING TO LOSE.
      //
      // This once rewrote every weight in the project from the sum of all
      // prices, and on Gundih that was a disaster twice over: prices nest, so
      // the sum triple-counts, and only 95 of its 176 stored weights can be
      // re-derived from prices at all — the other 81 came from the workbook.
      // One keystroke in this column would have replaced them and broken a
      // total that closes at exactly 100.000000.
      //
      // Doing nothing at all was the other extreme, and it cost the app its
      // whole front page for projects made in it: prices typed, weights NULL,
      // dashboard answering "has no weights yet". `syncDerivedWeights` is the
      // line between the two — it refuses to touch a project whose weights are
      // authoritative (`weight_basis = 'boq'`) and keeps every other project's
      // weights in step with what its prices now say. Weight is still derived,
      // never typed; on a locked project it is derived only when someone asks,
      // after being shown what would change (`previewWeights` in lib/weights.ts).
      if (projectId) syncDerivedWeights(projectId);
    }
    await landed();
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
  await beforeWrite();
  try {
    const raw = value.trim();
    if (raw && !ISO.test(raw)) throw new Error('That is not a date');
    db.update(schema.wbsNodes)
      .set({ targetDate: raw || null })
      .where(eq(schema.wbsNodes.id, nodeId))
      .run();
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
  await beforeWrite();
  try {
    const node = db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId)).all()[0];
    if (!node) throw new Error('Row not found');

    const baselineId = getActiveBaselineId(node.projectId);
    if (!baselineId) throw new Error('This project has no schedule yet');

    // A fence that is already broken is not a fence. Packages catch up to what
    // they are drawn holding FIRST — before anything below is read — so every
    // box this row is measured against is the one on screen. A plan built
    // before `coverChildren` existed has branches whose stored box lost touch
    // with their children, and every date under such a branch was refused
    // against a range nobody could see or reach.
    coverChildren(node.projectId, baselineId);

    const current = db
      .select()
      .from(schema.nodeSchedules)
      .where(
        and(eq(schema.nodeSchedules.baselineId, baselineId), eq(schema.nodeSchedules.nodeId, nodeId))
      )
      .all()[0];

    // Seeded from what the ROW SHOWS, which for a branch with no dates of its
    // own is its children's span. Typing a start on such a row otherwise held a
    // duration of nothing and collapsed a nine-month package to a single day.
    const shown = rowSpan(nodeId, baselineId);
    let start = current?.startDate ?? shown?.start ?? null;
    let finish = current?.finishDate ?? shown?.finish ?? null;
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
      const heldFinish = finish;
      start = value;
      const keep = duration && duration > 0 ? duration : 1;
      finish = addDays(start, keep - 1);
      duration = keep;

      /**
       * HOLDING THE DURATION IS THE FIRST READING, NOT THE ONLY ONE.
       *
       * Moving a row INSIDE its package took two edits and only one order of
       * the two worked, which nobody can be expected to know. Engineering by
       * Solar had to go from 09 Feb – 17 May 26 to 28 Sep – 25 Oct 26 inside a
       * package ending 08 Nov 26. Typing the finish first was taken (the row
       * became 259 days), and then typing the start dragged that duration to
       * June 2027 and was refused; typing the start first dragged the old 98
       * days to January 2027 and was refused too. Only duration-then-start got
       * there, and the refusal said nothing about that (14 Sep 2026).
       *
       * So when holding the duration would push the finish out of the fence,
       * and the row fits perfectly well where it already ends, the finish is
       * held instead and the duration is what moves. NOTHING TYPED IS CHANGED:
       * the start is taken exactly as given, and the value that gives way is
       * the derived one — the same trade the FINISH column already makes. A
       * start that does not fit on its own is still refused, by name.
       */
      if (
        heldFinish &&
        finish > heldFinish &&
        start <= heldFinish &&
        whyNotFits(nodeId, baselineId, start, finish) &&
        !whyNotFits(nodeId, baselineId, start, heldFinish)
      ) {
        finish = heldFinish;
        duration = inclusiveDays(start, finish);
      }
    } else {
      if (!ISO.test(value)) throw new Error('That is not a date');
      if (!start) throw new Error('Give the row a start date first');
      if (utc(value) < utc(start)) throw new Error('The finish is before the start');
      finish = value;
      duration = inclusiveDays(start, finish);
    }

    // The fence, in both directions, BEFORE anything is written.
    if (start && finish) checkFits(nodeId, baselineId, start, finish);

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

    await landed();
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
  await beforeWrite();
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

/**
 * Move everything that follows a row, by the same number of days.
 *
 * The chain comes from `lib/chains.ts` — inferred from the dates, never stored —
 * and it is re-inferred HERE rather than trusted from the client, because a
 * payload naming its own list of rows to move is a payload that can move any row
 * it likes.
 *
 * Gaps are preserved exactly. Nothing is compressed and no duration changes: a
 * revision that quietly shortened a job while claiming to move a date would be
 * the worst kind of help.
 */
export async function shiftFollowersAction(
  projectId: string,
  nodeId: string,
  deltaDays: number
): Promise<{ ok: true; moved: number } | { ok: false; error: string }> {
  await beforeWrite();
  try {
    if (!Number.isFinite(deltaDays) || deltaDays === 0) return { ok: true, moved: 0 };
    if (Math.abs(deltaDays) > 3650) throw new Error('That is more than ten years');

    const baselineId = getActiveBaselineId(projectId);
    if (!baselineId) throw new Error('This project has no schedule yet');

    const nodes = db
      .select({
        id: schema.wbsNodes.id,
        parentId: schema.wbsNodes.parentId,
        order: schema.wbsNodes.order,
        isLeaf: schema.wbsNodes.isLeaf,
      })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId))
      .orderBy(schema.wbsNodes.order)
      .all();

    const scheds = db
      .select()
      .from(schema.nodeSchedules)
      .where(eq(schema.nodeSchedules.baselineId, baselineId))
      .all();
    const byNode = new Map(scheds.map((s) => [s.nodeId, s]));

    // The chain is inferred from the dates as they were BEFORE the move, by
    // putting the edited row back where it came from.
    //
    // This is not a nicety. The link that makes a row worth following is
    // exactly the link the move breaks: push IFR five days later and it now
    // finishes AFTER IFA starts, so a graph built from the dates as they are
    // finds no chain at all and nothing follows anything. The client showed the
    // person a chain that existed a moment ago; this reproduces it rather than
    // trusting a list of row ids from the browser.
    const chainNodes: ChainNode[] = nodes.map((n) => {
      const s = byNode.get(n.id);
      const rewind = n.id === nodeId ? -deltaDays : 0;
      return {
        id: n.id,
        parentId: n.parentId ?? null,
        order: n.order,
        isLeaf: n.isLeaf,
        startDate: s ? chainAddDays(s.startDate, rewind) : null,
        finishDate: s ? chainAddDays(s.finishDate, rewind) : null,
      };
    });

    const links = inferChains(chainNodes);
    const successors = new Map<string, string[]>();
    for (const l of links) {
      const list = successors.get(l.fromId);
      if (list) list.push(l.toId);
      else successors.set(l.fromId, [l.toId]);
    }
    const moving = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of successors.get(id) ?? []) {
        if (moving.has(next)) continue;
        moving.add(next);
        queue.push(next);
      }
    }

    let moved = 0;
    db.transaction((tx) => {
      for (const id of moving) {
        const s = byNode.get(id);
        if (!s) continue;
        tx.update(schema.nodeSchedules)
          .set({
            startDate: chainAddDays(s.startDate, deltaDays),
            finishDate: chainAddDays(s.finishDate, deltaDays),
          })
          .where(eq(schema.nodeSchedules.id, s.id))
          .run();
        moved += 1;
      }
    });

    await landed();
    return { ok: true, moved };
  } catch (e) {
    return fail(e);
  }
}
