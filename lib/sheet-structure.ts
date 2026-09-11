'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';

import { beforeWrite, db, schema, sqlite } from './sqlite';
import { getActiveBaselineId } from './sheet';

/**
 * Building a plan from nothing — add a row, indent it, move it, delete it.
 *
 * Without this the sheet could only edit rows that already existed, so a
 * project made in the app was a dead end: "No work planned yet" and no way to
 * plan any.
 *
 * **Every structural change ends in one renumber of the whole project.** Four
 * things have to stay true together — `parentId`, `depth`, `sortOrder` (a
 * global depth-first sequence, not a per-parent one) and `wbsCode` — and
 * keeping them in step by hand at each call site is how a tree quietly grows a
 * row that belongs to nobody. Rewriting all of them from the tree costs 285
 * updates in one transaction, which SQLite does in about a millisecond.
 *
 * `wbsCode` is set to the outline code, because that is what it already is:
 * across Gundih's 285 rows the generated outline code matches the imported code
 * on every single one, so renumbering an imported project changes nothing. The
 * rename happens in two passes because `wbs_project_code_idx` is unique — pass
 * one parks every code on a value nothing can collide with, pass two writes the
 * real ones.
 *
 * **A new row is born visible.** It takes the day after its previous sibling
 * finishes, or the project's start, and lasts one day. A row with no dates
 * draws no bar, and an editor where adding something makes nothing appear reads
 * as broken.
 */

export type StructureResult = { ok: true; newId?: string } | { ok: false; error: string };

const MS_PER_DAY = 86_400_000;

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}
function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

interface Node {
  id: string;
  parentId: string | null;
  order: number;
  depth: number;
  wbsCode: string;
  isLeaf: boolean;
}

function loadTree(projectId: string): Node[] {
  return db
    .select({
      id: schema.wbsNodes.id,
      parentId: schema.wbsNodes.parentId,
      order: schema.wbsNodes.order,
      depth: schema.wbsNodes.depth,
      wbsCode: schema.wbsNodes.wbsCode,
      isLeaf: schema.wbsNodes.isLeaf,
    })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(schema.wbsNodes.order)
    .all();
}

/** Rewrites order, depth, wbsCode and isLeaf for the whole project from its shape. */
/** Anything that can issue an update — the db handle or an open transaction. */
type Writer = Pick<typeof db, 'update'>;

function renumber(projectId: string, tx: Writer = db) {
  const nodes = loadTree(projectId);
  const kids = new Map<string | null, Node[]>();
  for (const n of nodes) {
    const list = kids.get(n.parentId ?? null);
    if (list) list.push(n);
    else kids.set(n.parentId ?? null, [n]);
  }

  const flat: {
    id: string;
    order: number;
    depth: number;
    code: string;
    isLeaf: boolean;
  }[] = [];
  let seq = 0;
  const walk = (parentId: string | null, depth: number, prefix: string) => {
    (kids.get(parentId) ?? []).forEach((n, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const children = kids.get(n.id) ?? [];
      flat.push({ id: n.id, order: seq++, depth, code, isLeaf: children.length === 0 });
      walk(n.id, depth + 1, code);
    });
  };
  walk(null, 0, '');

  // Two passes: `wbs_project_code_idx` is unique, so 1.3 becoming 1.2 while the
  // old 1.2 still holds that code would be rejected mid-flight.
  for (const f of flat) {
    tx.update(schema.wbsNodes)
      .set({ wbsCode: `~${f.id}` })
      .where(eq(schema.wbsNodes.id, f.id))
      .run();
  }
  for (const f of flat) {
    tx.update(schema.wbsNodes)
      .set({
        order: f.order,
        depth: f.depth,
        wbsCode: f.code,
        isLeaf: f.isLeaf,
        // A ROW WITH CHILDREN IS NOT A MILESTONE — decision ①, and this is the
        // one place every structural change passes through, so it is the only
        // place that can enforce it. The flag is set while a row is still a
        // leaf and goes stale the moment something is indented under it;
        // nothing used to clear it, and the plan drew a point in time that
        // spanned four months of work.
        ...(f.isLeaf ? {} : { isMilestone: false }),
      })
      .where(eq(schema.wbsNodes.id, f.id))
      .run();
  }
}

function projectOf(nodeId: string): string {
  const n = db
    .select({ projectId: schema.wbsNodes.projectId })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.id, nodeId))
    .all()[0];
  if (!n) throw new Error('Row not found');
  return n.projectId;
}

function touchProject(projectId: string, tx: Writer = db) {
  tx.update(schema.projects)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId))
    .run();
}

/** The day after the row above finishes, else the project's start, else today. */
function defaultStart(projectId: string, afterNodeId: string | null): string {
  const baselineId = getActiveBaselineId(projectId);
  if (baselineId && afterNodeId) {
    const prev = db
      .select({ finishDate: schema.nodeSchedules.finishDate })
      .from(schema.nodeSchedules)
      .where(
        and(
          eq(schema.nodeSchedules.baselineId, baselineId),
          eq(schema.nodeSchedules.nodeId, afterNodeId)
        )
      )
      .all()[0];
    if (prev?.finishDate) return addDays(prev.finishDate, 1);
  }
  const p = db
    .select({ startDate: schema.projects.startDate })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  return p?.startDate ?? new Date().toISOString().slice(0, 10);
}

export async function addRowAction(
  projectId: string,
  opts: { afterNodeId?: string | null; asChild?: boolean; name?: string } = {}
): Promise<StructureResult> {
  await beforeWrite();
  try {
    const after = opts.afterNodeId ?? null;
    let parentId: string | null = null;
    let order = 0;

    if (after) {
      const a = db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, after)).all()[0];
      if (!a) throw new Error('Row not found');
      parentId = opts.asChild ? a.id : a.parentId;
      // Sits immediately after the anchor; renumber turns this into a clean
      // depth-first sequence a moment later.
      order = a.order + (opts.asChild ? 1 : 1);
    } else {
      const last = db
        .select({ order: schema.wbsNodes.order })
        .from(schema.wbsNodes)
        .where(eq(schema.wbsNodes.projectId, projectId))
        .orderBy(schema.wbsNodes.order)
        .all()
        .at(-1);
      order = (last?.order ?? -1) + 1;
    }

    const id = `n${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const start = defaultStart(projectId, after);
    const baselineId = getActiveBaselineId(projectId);

    db.transaction((tx) => {
      // Push everything at or after the insertion point down one, so the new row
      // lands where it was asked for rather than at the end. Written as raw SQL
      // because drizzle has no expression update, and reading 285 rows back to
      // add one to each would be the same work done slowly.
      sqlite
        .prepare('update wbs_nodes set sort_order = sort_order + 1 where project_id = ? and sort_order >= ?')
        .run(projectId, order);

      tx.insert(schema.wbsNodes)
        .values({
          // Parked on a code nothing can collide with; renumber writes the real
          // outline code a few lines below.
          id,
          projectId,
          parentId,
          wbsCode: `~${id}`,
          deskripsi: opts.name?.trim() || 'New task',
          order,
          depth: 0,
          isLeaf: true,
          progressMethod: 'lumpsum',
        })
        .run();

      if (baselineId) {
        tx.insert(schema.nodeSchedules)
          .values({
            id: `${baselineId}:${id}`,
            baselineId,
            nodeId: id,
            startDate: start,
            finishDate: start,
            durationDays: 1,
          })
          .run();
      }

      renumber(projectId, tx);
      touchProject(projectId, tx);
    });
    revalidatePath('/projects', 'layout');
    return { ok: true, newId: id };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Deleting takes the subtree with it — `wbs_nodes.parentId` has no cascade of
 * its own, so the children are collected here rather than left orphaned.
 */
export async function deleteRowAction(nodeId: string): Promise<StructureResult> {
  await beforeWrite();
  try {
    const projectId = projectOf(nodeId);
    const nodes = loadTree(projectId);
    const doomed = new Set<string>([nodeId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of nodes) {
        if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
          doomed.add(n.id);
          grew = true;
        }
      }
    }
    if (doomed.size === nodes.length) throw new Error('A project needs at least one row');

    db.transaction((tx) => {
      for (const id of doomed) {
        tx.delete(schema.wbsNodes).where(eq(schema.wbsNodes.id, id)).run();
      }
      renumber(projectId, tx);
      touchProject(projectId, tx);
    });
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Indent: the row becomes a child of the sibling above it. Tab, in MS Project. */
export async function indentRowAction(nodeId: string): Promise<StructureResult> {
  await beforeWrite();
  try {
    const projectId = projectOf(nodeId);
    const nodes = loadTree(projectId);
    const me = nodes.find((n) => n.id === nodeId);
    if (!me) throw new Error('Row not found');
    const siblings = nodes.filter((n) => (n.parentId ?? null) === (me.parentId ?? null));
    const i = siblings.findIndex((n) => n.id === nodeId);
    if (i <= 0) throw new Error('Nothing above this row to sit under');

    db.transaction((tx) => {
      tx.update(schema.wbsNodes)
        .set({ parentId: siblings[i - 1].id })
        .where(eq(schema.wbsNodes.id, nodeId))
        .run();
      renumber(projectId, tx);
      touchProject(projectId, tx);
    });
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Outdent: the row moves up a level, landing directly after its old parent. */
export async function outdentRowAction(nodeId: string): Promise<StructureResult> {
  await beforeWrite();
  try {
    const projectId = projectOf(nodeId);
    const nodes = loadTree(projectId);
    const me = nodes.find((n) => n.id === nodeId);
    if (!me) throw new Error('Row not found');
    if (!me.parentId) throw new Error('This row is already at the top level');
    const parent = nodes.find((n) => n.id === me.parentId);
    if (!parent) throw new Error('Row not found');

    db.transaction((tx) => {
      tx.update(schema.wbsNodes)
        .set({ parentId: parent.parentId ?? null })
        .where(eq(schema.wbsNodes.id, nodeId))
        .run();
      // A half-step lands it just past its old parent; renumber flattens the
      // sequence back to whole numbers immediately after.
      sqlite
        .prepare('update wbs_nodes set sort_order = ? where id = ?')
        .run(parent.order + 0.5, nodeId);
      renumber(projectId, tx);
      touchProject(projectId, tx);
    });
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Move among siblings. The subtree travels with the row. */
export async function moveRowAction(nodeId: string, dir: 'up' | 'down'): Promise<StructureResult> {
  await beforeWrite();
  try {
    const projectId = projectOf(nodeId);
    const nodes = loadTree(projectId);
    const me = nodes.find((n) => n.id === nodeId);
    if (!me) throw new Error('Row not found');
    const siblings = nodes.filter((n) => (n.parentId ?? null) === (me.parentId ?? null));
    const i = siblings.findIndex((n) => n.id === nodeId);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) throw new Error('Already at the end');

    // Half-steps put the row on the far side of its neighbour; renumber then
    // flattens the sequence back to whole numbers.
    const target = dir === 'up' ? siblings[j].order - 0.5 : siblings[j].order + 0.5;
    db.transaction((tx) => {
      sqlite.prepare('update wbs_nodes set sort_order = ? where id = ?').run(target, nodeId);
      renumber(projectId, tx);
      touchProject(projectId, tx);
    });
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * SPK / package / lot / area. Not decoration: `isReportingUnit` is what earns a
 * node its own section in the report, and a plan that cannot mark one can never
 * produce the client's format.
 */
export async function setReportingUnitAction(
  nodeId: string,
  on: boolean,
  label?: string,
  /**
   * The unit's own signed value. A reporting unit is its own contract even when
   * it sits inside another — SPK-007 at 1.4.4 lives inside SPK-004's 1.4 and
   * its 842,723.72 is NOT part of 1.4's figure. Without a way to type this, the
   * check that the units add up to the contract had nothing to check.
   */
  unitValue?: number | null
): Promise<StructureResult> {
  await beforeWrite();
  try {
    const projectId = projectOf(nodeId);
    db.update(schema.wbsNodes)
      .set({
        isReportingUnit: on,
        unitLabel: on ? label?.trim() || 'Unit' : null,
        unitContractValue: on ? (unitValue ?? null) : null,
        // The unit's value IS its price: a unit is a contract, and a contract's
        // figure is what the money formula spends down its subtree.
        ...(on && unitValue != null ? { price: unitValue } : {}),
      })
      .where(eq(schema.wbsNodes.id, nodeId))
      .run();
    touchProject(projectId);
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
