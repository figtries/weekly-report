'use server';

import { requireEdit } from './auth/require-edit';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { and, eq, gte, sql } from 'drizzle-orm';

import { db, type Db } from './pg';
import * as schema from './schema';
import { coverChildren, getActiveBaselineId } from './sheet';
import { pruneLinks } from './links-sqlite';
import { syncDerivedWeights } from './weights-auto';
import { completeDates, parsePaste, type ParseResult } from './paste';

/**
 * Writing a pasted plan.
 */

export type PasteResult = { ok: true; added: number } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

export interface PastePreview {
  ok: true;
  count: number;
  depthFrom: ParseResult['depthFrom'];
  notes: string[];
  skipped: { line: number; text: string }[];
  sample: { depth: number; name: string; start: string | null; finish: string | null; price: number | null }[];
  withDates: number;
  withPrices: number;
  milestones: number;
}

export async function previewPasteAction(
  text: string
): Promise<PastePreview | { ok: false; error: string }> {
  try {
    const parsed = parsePaste(text);
    if (parsed.rows.length === 0) throw new Error('Nothing in that paste looked like a row');

    let withDates = 0;
    let withPrices = 0;
    let milestones = 0;
    for (const r of parsed.rows) {
      const d = completeDates(r);
      if (d.startDate) withDates += 1;
      if (r.price != null && r.price > 0) withPrices += 1;
      if (r.isMilestone) milestones += 1;
    }

    return {
      ok: true,
      count: parsed.rows.length,
      depthFrom: parsed.depthFrom,
      notes: parsed.notes,
      skipped: parsed.skipped.slice(0, 8),
      sample: parsed.rows.slice(0, 12).map((r) => {
        const d = completeDates(r);
        return {
          depth: r.depth,
          name: r.name,
          start: d.startDate,
          finish: d.finishDate,
          price: r.price,
        };
      }),
      withDates,
      withPrices,
      milestones,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function applyPasteAction(
  projectId: string,
  text: string,
  afterNodeId?: string | null
): Promise<PasteResult> {
  await requireEdit();
  try {
    const parsed = parsePaste(text);
    if (parsed.rows.length === 0) throw new Error('Nothing in that paste looked like a row');
    if (parsed.rows.length > 5000) throw new Error('That is more than 5,000 rows. Split it up');

    const projectRows = await db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (!projectRows[0]) throw new Error('Project not found');

    const baselineId = await getActiveBaselineId(projectId);

    const all = await db
      .select({ id: schema.wbsNodes.id, parentId: schema.wbsNodes.parentId, order: schema.wbsNodes.order })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId))
      .orderBy(schema.wbsNodes.order);

    let anchorParent: string | null = null;
    let insertAt = all.length;
    if (afterNodeId) {
      const anchor = all.find((n) => n.id === afterNodeId);
      if (anchor) {
        anchorParent = anchor.parentId ?? null;
        const descendants = new Set<string>([anchor.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const n of all) {
            if (n.parentId && descendants.has(n.parentId) && !descendants.has(n.id)) {
              descendants.add(n.id);
              grew = true;
            }
          }
        }
        insertAt = Math.max(...all.filter((n) => descendants.has(n.id)).map((n) => n.order)) + 1;
      }
    }

    const stamp = Date.now().toString(36);
    const lastAtDepth: (string | null)[] = [anchorParent];
    const values: (typeof schema.wbsNodes.$inferInsert)[] = [];
    const schedules: (typeof schema.nodeSchedules.$inferInsert)[] = [];

    parsed.rows.forEach((r, i) => {
      const id = `n${stamp}${i.toString(36)}${randomUUID().slice(0, 4)}`;
      const parentId = lastAtDepth[r.depth] ?? anchorParent;
      lastAtDepth[r.depth + 1] = id;
      lastAtDepth.length = r.depth + 2;

      values.push({
        id,
        projectId,
        parentId,
        wbsCode: `~${id}`,
        deskripsi: r.name,
        order: insertAt + i,
        depth: r.depth,
        isLeaf: true,
        isMilestone: r.isMilestone,
        price: r.price,
        targetDate: r.targetDate,
        progressMethod: 'lumpsum',
      });

      const d = completeDates(r);
      if (baselineId && d.startDate && d.finishDate) {
        schedules.push({
          id: `${baselineId}:${id}`,
          baselineId,
          nodeId: id,
          startDate: d.startDate,
          finishDate: d.finishDate,
          durationDays: d.durationDays ?? 1,
        });
      }
    });

    await db.transaction(async (tx) => {
      await tx
        .update(schema.wbsNodes)
        .set({ order: sql`sort_order + ${values.length}` })
        .where(and(eq(schema.wbsNodes.projectId, projectId), gte(schema.wbsNodes.order, insertAt)));

      for (let i = 0; i < values.length; i += 50) {
        await tx.insert(schema.wbsNodes).values(values.slice(i, i + 50));
      }
      for (let i = 0; i < schedules.length; i += 100) {
        await tx.insert(schema.nodeSchedules).values(schedules.slice(i, i + 100));
      }

      await renumberProject(projectId, tx);
      await syncDerivedWeights(projectId, tx);
      await tx.update(schema.projects)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.projects.id, projectId));
    });

    revalidatePath('/projects', 'layout');
    return { ok: true, added: values.length };
  } catch (e) {
    return fail(e);
  }
}

async function renumberProject(projectId: string, tx: Pick<Db, 'update' | 'select'>) {
  const nodes = await tx
    .select({
      id: schema.wbsNodes.id,
      parentId: schema.wbsNodes.parentId,
      order: schema.wbsNodes.order,
    })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(schema.wbsNodes.order);

  const kids = new Map<string | null, typeof nodes>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const list = kids.get(key);
    if (list) list.push(n);
    else kids.set(key, [n]);
  }

  const flat: { id: string; order: number; depth: number; code: string; isLeaf: boolean }[] = [];
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
}
