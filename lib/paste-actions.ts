'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db, schema, sqlite } from './sqlite';
import { getActiveBaselineId } from './sheet';
import { completeDates, parsePaste, type ParseResult } from './paste';

/**
 * Writing a pasted plan.
 *
 * The parse itself is pure and lives in `lib/paste.ts`; this is the part that
 * touches the database, and it does the whole paste in ONE transaction. 285
 * rows arriving one insert at a time would leave a half-built tree behind if
 * anything threw halfway, and a half-built tree is worse than no tree — the
 * outline codes would be wrong and nobody could tell which rows were real.
 *
 * **Preview first, always.** `previewPasteAction` returns exactly what
 * `applyPasteAction` would write, so the UI can show the tree, the count and
 * every assumption before a single row exists. This is the same shape as the
 * weights recalculation: an irreversible bulk write shows its damage first.
 *
 * **Dates land on the ACTIVE baseline**, like every other schedule write here.
 */

export type PasteResult = { ok: true; added: number } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

/** A shrunk-down parse, safe to send to the client and enough to draw a preview. */
export interface PastePreview {
  ok: true;
  count: number;
  depthFrom: ParseResult['depthFrom'];
  notes: string[];
  skipped: { line: number; text: string }[];
  /** The first rows, to show the shape without shipping 285 of them twice. */
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
      // Only a COUNT of priced rows, never their sum: prices nest, so
      // adding them all up gives 16.9M against Gundih's 5.9M contract — the
      // same money three times over. See topLevelPricedTotal in lib/weights.ts.
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
  /** Paste under this row instead of at the end of the plan. */
  afterNodeId?: string | null
): Promise<PasteResult> {
  try {
    const parsed = parsePaste(text);
    if (parsed.rows.length === 0) throw new Error('Nothing in that paste looked like a row');
    if (parsed.rows.length > 5000) throw new Error('That is more than 5,000 rows — split it up');

    const project = db
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .all()[0];
    if (!project) throw new Error('Project not found');

    const baselineId = getActiveBaselineId(projectId);

    // Where the block goes. Pasting "after" a row means after its WHOLE subtree,
    // not between it and its first child — otherwise a paste onto a summary
    // silently adopts the block into it.
    const all = db
      .select({ id: schema.wbsNodes.id, parentId: schema.wbsNodes.parentId, order: schema.wbsNodes.order })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId))
      .orderBy(schema.wbsNodes.order)
      .all();

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

    // Build the whole block in memory first, parents resolved by depth — the
    // last row seen at depth d-1 is the parent of a row at depth d, which is
    // exactly how an outline reads.
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
        // Parked out of the way; `renumberProject` writes the real outline code
        // a moment later, in the same transaction.
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

    db.transaction((tx) => {
      sqlite
        .prepare('update wbs_nodes set sort_order = sort_order + ? where project_id = ? and sort_order >= ?')
        .run(values.length, projectId, insertAt);

      // Chunked because SQLite caps a statement at 999 bound parameters and a
      // wbs_nodes row binds a dozen of them.
      for (let i = 0; i < values.length; i += 50) {
        tx.insert(schema.wbsNodes).values(values.slice(i, i + 50)).run();
      }
      for (let i = 0; i < schedules.length; i += 100) {
        tx.insert(schema.nodeSchedules).values(schedules.slice(i, i + 100)).run();
      }

      renumberProject(projectId, tx);
      tx.update(schema.projects)
        .set({ updatedAt: new Date().toISOString() })
        .where(eq(schema.projects.id, projectId))
        .run();
    });

    revalidatePath('/projects', 'layout');
    return { ok: true, added: values.length };
  } catch (e) {
    return fail(e);
  }
}

type Writer = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The same two-pass renumber `lib/sheet-structure.ts` runs after every
 * structural change, duplicated here rather than exported from a `'use server'`
 * file — every export of one of those becomes a server action, and a
 * transaction-scoped helper cannot be one.
 */
function renumberProject(projectId: string, tx: Writer) {
  const nodes = db
    .select({
      id: schema.wbsNodes.id,
      parentId: schema.wbsNodes.parentId,
      order: schema.wbsNodes.order,
    })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(schema.wbsNodes.order)
    .all();

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

  for (const f of flat) {
    tx.update(schema.wbsNodes).set({ wbsCode: `~${f.id}` }).where(eq(schema.wbsNodes.id, f.id)).run();
  }
  for (const f of flat) {
    tx.update(schema.wbsNodes)
      .set({ order: f.order, depth: f.depth, wbsCode: f.code, isLeaf: f.isLeaf })
      .where(eq(schema.wbsNodes.id, f.id))
      .run();
  }
}
