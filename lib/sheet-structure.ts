'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { db, type Db } from './pg';
import * as schema from './schema';
import { boxAt, coverChildren, getActiveBaselineId, getSheet, rowSpan, type Sheet } from './sheet';
import { pruneLinks } from './links-sqlite';
import { inheritKind } from './kind-plan';
import { syncDerivedWeights } from './weights-auto';

/**
 * Building a plan from nothing — add a row, indent it, move it, delete it.
 */

export type StructureResult =
  | { ok: true; newId?: string; undoId?: string; sheet?: Sheet }
  | { ok: false; error: string; gone?: true };

export async function readSheetAction(projectId: string): Promise<Sheet> {
  return getSheet(projectId);
}

const GONE = 'That row is no longer in the plan';
const UNDO_ENTITY = 'wbs_subtree';

type RemovedSubtree = {
  nodes: (typeof schema.wbsNodes.$inferSelect)[];
  milestones: (typeof schema.milestones.$inferSelect)[];
  schedules: (typeof schema.nodeSchedules.$inferSelect)[];
  progress: (typeof schema.leafProgress.$inferSelect)[];
  msProgress: (typeof schema.milestoneProgress.$inferSelect)[];
};

const MS_PER_DAY = 86_400_000;

function fail(err: unknown): { ok: false; error: string; gone?: true } {
  const error = err instanceof Error ? err.message : 'Something went wrong';
  return error === GONE ? { ok: false, error, gone: true } : { ok: false, error };
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

type Writer = Pick<Db, 'update' | 'select'>;

async function loadTree(projectId: string): Promise<Node[]> {
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
    .orderBy(schema.wbsNodes.order);
}

/** Rewrites order, depth, wbsCode and isLeaf for the whole project from its shape. */
async function renumber(projectId: string, tx: Writer = db) {
  const nodes = await loadTree(projectId);
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
  await Promise.all(
    flat.map((f) =>
      tx.update(schema.wbsNodes).set({ wbsCode: `~${f.id}` }).where(eq(schema.wbsNodes.id, f.id))
    )
  );
  await Promise.all(
    flat.map((f) =>
      tx
        .update(schema.wbsNodes)
        .set({
          order: f.order,
          depth: f.depth,
          wbsCode: f.code,
          isLeaf: f.isLeaf,
          ...(f.isLeaf ? {} : { isMilestone: false }),
        })
        .where(eq(schema.wbsNodes.id, f.id))
    )
  );

  const baselineId = await getActiveBaselineId(projectId);
  if (baselineId) await coverChildren(projectId, baselineId, tx);

  await pruneLinks(projectId, tx);
  await syncDerivedWeights(projectId, tx);
}

async function projectOf(nodeId: string): Promise<string> {
  const rows = await db
    .select({ projectId: schema.wbsNodes.projectId })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.id, nodeId));
  if (!rows[0]) throw new Error(GONE);
  return rows[0].projectId;
}

async function settle(projectId: string): Promise<Sheet> {
  const sheet = await getSheet(projectId);
  revalidatePath('/projects', 'layout');
  return sheet;
}

async function touchProject(projectId: string, tx: Writer = db) {
  await tx.update(schema.projects)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId));
}

async function defaultStart(
  projectId: string,
  afterNodeId: string | null,
  asChild: boolean,
  parentId: string | null
): Promise<string> {
  const baselineId = await getActiveBaselineId(projectId);
  const projectRows = await db
    .select({ startDate: schema.projects.startDate, finishDate: schema.projects.finishDate })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const project = projectRows[0];

  let start: string | null = null;
  if (baselineId && afterNodeId) {
    if (asChild) {
      const kids = await db
        .select({ id: schema.wbsNodes.id })
        .from(schema.wbsNodes)
        .where(eq(schema.wbsNodes.parentId, afterNodeId));
      let last: string | null = null;
      for (const k of kids) {
        const s = await rowSpan(k.id, baselineId);
        if (s && (!last || s.finish > last)) last = s.finish;
      }
      start = last ? addDays(last, 1) : ((await rowSpan(afterNodeId, baselineId))?.start ?? null);
    } else {
      const anchor = await rowSpan(afterNodeId, baselineId);
      if (anchor) start = addDays(anchor.finish, 1);
    }
  }
  start ??= project?.startDate ?? new Date().toISOString().slice(0, 10);

  if (baselineId && parentId) {
    const box = await boxAt(parentId, baselineId);
    if (box) {
      if (start < box.start) start = box.start;
      if (start > box.finish) start = box.finish;
    }
  } else if (!parentId && project?.finishDate && start > project.finishDate) {
    start = project.finishDate;
  }
  return start;
}

export async function addRowAction(
  projectId: string,
  opts: { afterNodeId?: string | null; asChild?: boolean; name?: string } = {}
): Promise<StructureResult> {
  try {
    const after = opts.afterNodeId ?? null;
    let parentId: string | null = null;
    let order = 0;

    if (after) {
      const rows = await db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, after));
      const a = rows[0];
      if (!a) throw new Error(GONE);
      parentId = opts.asChild ? a.id : a.parentId;
      order = a.order + 1;
      if (opts.asChild) {
        const kids = await db
          .select({ order: schema.wbsNodes.order })
          .from(schema.wbsNodes)
          .where(eq(schema.wbsNodes.parentId, a.id));
        if (kids.length) order = Math.max(...kids.map((k) => k.order)) + 0.5;
      }
    } else {
      const all = await db
        .select({ order: schema.wbsNodes.order })
        .from(schema.wbsNodes)
        .where(eq(schema.wbsNodes.projectId, projectId))
        .orderBy(schema.wbsNodes.order);
      order = (all.at(-1)?.order ?? -1) + 1;
    }

    const id = `n${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
    const start = await defaultStart(projectId, after, !!opts.asChild, parentId);
    const baselineId = await getActiveBaselineId(projectId);

    await db.transaction(async (tx) => {
      await tx
        .update(schema.wbsNodes)
        .set({ order: sql`sort_order + 1` })
        .where(and(eq(schema.wbsNodes.projectId, projectId), gte(schema.wbsNodes.order, order)));

      await tx.insert(schema.wbsNodes).values({
        id,
        projectId,
        parentId,
        wbsCode: `~${id}`,
        deskripsi: opts.name?.trim() || 'New task',
        order,
        depth: 0,
        isLeaf: true,
        progressMethod: 'lumpsum',
      });

      if (baselineId) {
        await tx.insert(schema.nodeSchedules).values({
          id: `${baselineId}:${id}`,
          baselineId,
          nodeId: id,
          startDate: start,
          finishDate: start,
          durationDays: 1,
        });
      }

      await renumber(projectId, tx);
      await touchProject(projectId, tx);
    });
    await inheritKind(projectId, id);
    return { ok: true, newId: id, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteRowAction(nodeId: string): Promise<StructureResult> {
  try {
    const projectId = await projectOf(nodeId);
    const nodes = await loadTree(projectId);
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

    const ids = [...doomed];
    const [removedNodes, removedMilestones, removedSchedules, removedProgress] = await Promise.all([
      db
        .select()
        .from(schema.wbsNodes)
        .where(inArray(schema.wbsNodes.id, ids))
        .orderBy(schema.wbsNodes.depth, schema.wbsNodes.order),
      db.select().from(schema.milestones).where(inArray(schema.milestones.nodeId, ids)),
      db.select().from(schema.nodeSchedules).where(inArray(schema.nodeSchedules.nodeId, ids)),
      db.select().from(schema.leafProgress).where(inArray(schema.leafProgress.nodeId, ids)),
    ]);

    const msIds = removedMilestones.map((m) => m.id);
    const removedMsProgress = msIds.length
      ? await db
          .select()
          .from(schema.milestoneProgress)
          .where(inArray(schema.milestoneProgress.milestoneId, msIds))
      : [];

    const removed: RemovedSubtree = {
      nodes: removedNodes,
      milestones: removedMilestones,
      schedules: removedSchedules,
      progress: removedProgress,
      msProgress: removedMsProgress,
    };

    const undoId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(schema.auditLog).values({
        id: undoId,
        projectId,
        entityType: UNDO_ENTITY,
        entityId: nodeId,
        field: 'delete',
        oldValue: JSON.stringify(removed),
        at: new Date().toISOString(),
      });
      for (const id of ids) {
        await tx.delete(schema.wbsNodes).where(eq(schema.wbsNodes.id, id));
      }
      await renumber(projectId, tx);
      await touchProject(projectId, tx);
    });
    return { ok: true, undoId, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function undoDeleteRowAction(undoId: string): Promise<StructureResult> {
  try {
    const records = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, undoId));
    const record = records[0];
    if (!record || record.entityType !== UNDO_ENTITY || !record.oldValue) {
      throw new Error('That delete can no longer be undone');
    }
    const projectId = record.projectId;
    const removed = JSON.parse(record.oldValue) as RemovedSubtree;
    const aliveRows = await db
      .select({ id: schema.wbsNodes.id })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId));
    const alive = new Set(aliveRows.map((r) => r.id));
    const coming = new Set(removed.nodes.map((n) => n.id));

    await db.transaction(async (tx) => {
      for (const n of removed.nodes) {
        const parentId = n.parentId && (alive.has(n.parentId) || coming.has(n.parentId)) ? n.parentId : null;
        await tx.insert(schema.wbsNodes).values({ ...n, parentId }).onConflictDoNothing();
      }
      for (const m of removed.milestones) {
        await tx.insert(schema.milestones).values(m).onConflictDoNothing();
      }
      for (const sc of removed.schedules) {
        await tx.insert(schema.nodeSchedules).values(sc).onConflictDoNothing();
      }
      for (const pr of removed.progress) {
        await tx.insert(schema.leafProgress).values(pr).onConflictDoNothing();
      }
      for (const mp of removed.msProgress) {
        await tx.insert(schema.milestoneProgress).values(mp).onConflictDoNothing();
      }
      await tx.delete(schema.auditLog).where(eq(schema.auditLog.id, undoId));
      await renumber(projectId, tx);
      await touchProject(projectId, tx);
    });
    return { ok: true, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function indentRowAction(nodeId: string): Promise<StructureResult> {
  try {
    const projectId = await projectOf(nodeId);
    const nodes = await loadTree(projectId);
    const me = nodes.find((n) => n.id === nodeId);
    if (!me) throw new Error(GONE);
    const siblings = nodes.filter((n) => (n.parentId ?? null) === (me.parentId ?? null));
    const i = siblings.findIndex((n) => n.id === nodeId);
    if (i <= 0) throw new Error('Nothing above this row to sit under');

    await db.transaction(async (tx) => {
      await tx
        .update(schema.wbsNodes)
        .set({ parentId: siblings[i - 1].id })
        .where(eq(schema.wbsNodes.id, nodeId));
      await renumber(projectId, tx);
      await touchProject(projectId, tx);
    });
    return { ok: true, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function outdentRowAction(nodeId: string): Promise<StructureResult> {
  try {
    const projectId = await projectOf(nodeId);
    const nodes = await loadTree(projectId);
    const me = nodes.find((n) => n.id === nodeId);
    if (!me) throw new Error(GONE);
    if (!me.parentId) throw new Error('This row is already at the top level');
    const parent = nodes.find((n) => n.id === me.parentId);
    if (!parent) throw new Error(GONE);

    await db.transaction(async (tx) => {
      await tx
        .update(schema.wbsNodes)
        .set({ parentId: parent.parentId ?? null })
        .where(eq(schema.wbsNodes.id, nodeId));
      await tx
        .update(schema.wbsNodes)
        .set({ order: parent.order + 0.5 })
        .where(eq(schema.wbsNodes.id, nodeId));
      await renumber(projectId, tx);
      await touchProject(projectId, tx);
    });
    return { ok: true, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function moveRowToAction(
  nodeId: string,
  parentId: string | null,
  afterNodeId: string | null
): Promise<StructureResult> {
  try {
    const projectId = await projectOf(nodeId);
    const nodes = await loadTree(projectId);
    const me = nodes.find((n) => n.id === nodeId);
    if (!me) throw new Error(GONE);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (let cursor = parentId, hops = 0; cursor && hops < 256; hops += 1) {
      if (cursor === nodeId) throw new Error('A row cannot be moved inside itself');
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    if (parentId && !byId.has(parentId)) throw new Error(GONE);
    if (afterNodeId && !byId.has(afterNodeId)) throw new Error(GONE);

    let order: number;
    if (afterNodeId) {
      order = (byId.get(afterNodeId)?.order ?? me.order) + 0.5;
    } else {
      const kids = nodes.filter((n) => (n.parentId ?? null) === parentId && n.id !== nodeId);
      const firstOrder = kids.length ? Math.min(...kids.map((k) => k.order)) : null;
      const parentOrder = parentId ? (byId.get(parentId)?.order ?? -1) : -1;
      order = firstOrder !== null ? firstOrder - 0.5 : parentOrder + 0.5;
    }

    await db.transaction(async (tx) => {
      await tx
        .update(schema.wbsNodes)
        .set({ parentId: parentId ?? null, order })
        .where(eq(schema.wbsNodes.id, nodeId));
      await renumber(projectId, tx);
      await touchProject(projectId, tx);
    });
    return { ok: true, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function moveRowAction(nodeId: string, dir: 'up' | 'down'): Promise<StructureResult> {
  try {
    const projectId = await projectOf(nodeId);
    const nodes = await loadTree(projectId);
    const me = nodes.find((n) => n.id === nodeId);
    if (!me) throw new Error(GONE);
    const siblings = nodes.filter((n) => (n.parentId ?? null) === (me.parentId ?? null));
    const i = siblings.findIndex((n) => n.id === nodeId);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) throw new Error('Already at the end');

    const target = dir === 'up' ? siblings[j].order - 0.5 : siblings[j].order + 0.5;
    await db.transaction(async (tx) => {
      await tx.update(schema.wbsNodes).set({ order: target }).where(eq(schema.wbsNodes.id, nodeId));
      await renumber(projectId, tx);
      await touchProject(projectId, tx);
    });
    return { ok: true, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}

export async function setReportingUnitAction(
  nodeId: string,
  on: boolean,
  label?: string,
  unitValue?: number | null
): Promise<StructureResult> {
  try {
    const projectId = await projectOf(nodeId);
    await db
      .update(schema.wbsNodes)
      .set({
        isReportingUnit: on,
        unitLabel: on ? label?.trim() || 'Unit' : null,
        unitContractValue: on ? (unitValue ?? null) : null,
        ...(on && unitValue != null ? { price: unitValue } : {}),
      })
      .where(eq(schema.wbsNodes.id, nodeId));
    await touchProject(projectId);
    return { ok: true, sheet: await settle(projectId) };
  } catch (e) {
    return fail(e);
  }
}
