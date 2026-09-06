'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { asc, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { DEFAULT_BAR_STYLES, type BarCondition, type BarPaint, type BarShape } from './bar-styles';

/**
 * Editing the bar-style list.
 *
 * **Every write materialises the defaults first.** A project starts with no rows
 * at all and reads through `DEFAULT_BAR_STYLES`, which keeps reads free of
 * writes; the first edit copies that list into the table and then edits it. So
 * "move the lateness rule down" behaves the same whether or not anything was
 * ever configured, and Reset is a plain delete rather than a re-seed.
 *
 * **Order is rewritten wholesale after every change**, the same habit as the WBS
 * renumber: four rules holding a gapless sequence between them by hand is how a
 * list quietly ends up with two rules at position 3.
 */

export type StyleResult = { ok: true } | { ok: false; error: string };

function fail(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : 'Something went wrong' };
}

type Writer = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function materialise(projectId: string, tx: Writer) {
  const existing = db
    .select({ id: schema.barStyles.id })
    .from(schema.barStyles)
    .where(eq(schema.barStyles.projectId, projectId))
    .all();
  if (existing.length > 0) return;
  tx.insert(schema.barStyles)
    .values(
      DEFAULT_BAR_STYLES.map((s, i) => ({
        id: `bs${Date.now().toString(36)}${i}${randomUUID().slice(0, 4)}`,
        projectId,
        order: i,
        label: s.label,
        condition: s.condition,
        conditionValue: s.conditionValue,
        paint: s.paint,
        shape: s.shape,
        hatched: s.hatched,
        enabled: s.enabled,
      }))
    )
    .run();
}

function resequence(projectId: string, tx: Writer) {
  const rows = db
    .select({ id: schema.barStyles.id })
    .from(schema.barStyles)
    .where(eq(schema.barStyles.projectId, projectId))
    .orderBy(asc(schema.barStyles.order))
    .all();
  rows.forEach((r, i) => {
    tx.update(schema.barStyles).set({ order: i }).where(eq(schema.barStyles.id, r.id)).run();
  });
}

function done() {
  revalidatePath('/projects', 'layout');
  return { ok: true } as const;
}

export async function addBarStyleAction(projectId: string): Promise<StyleResult> {
  try {
    db.transaction((tx) => {
      materialise(projectId, tx);
      const last = db
        .select({ order: schema.barStyles.order })
        .from(schema.barStyles)
        .where(eq(schema.barStyles.projectId, projectId))
        .orderBy(asc(schema.barStyles.order))
        .all()
        .at(-1);
      tx.insert(schema.barStyles)
        .values({
          id: `bs${Date.now().toString(36)}${randomUUID().slice(0, 6)}`,
          projectId,
          // Above the catch-all, never below it: a rule added under "Anything"
          // can never fire, and an editor whose new rule does nothing is an
          // editor people decide is broken.
          order: (last?.order ?? 0) - 1,
          label: 'New rule',
          condition: 'past_target',
          conditionValue: null,
          paint: 'warn',
          shape: 'auto',
          hatched: false,
          enabled: true,
        })
        .run();
      resequence(projectId, tx);
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function updateBarStyleAction(
  projectId: string,
  styleId: string,
  patch: {
    label?: string;
    condition?: BarCondition;
    conditionValue?: string | null;
    paint?: BarPaint;
    shape?: BarShape;
    hatched?: boolean;
    enabled?: boolean;
  }
): Promise<StyleResult> {
  try {
    db.transaction((tx) => {
      materialise(projectId, tx);
      // The id only exists after materialising when the list was still the
      // defaults, so match by POSITION in that case: `default:summary` is the
      // third row, and the copy kept the order.
      const target = resolveId(projectId, styleId);
      if (!target) throw new Error('That rule is gone');
      const clean = { ...patch };
      if (clean.label !== undefined) {
        clean.label = clean.label.trim();
        if (!clean.label) throw new Error('A rule needs a name');
      }
      tx.update(schema.barStyles).set(clean).where(eq(schema.barStyles.id, target)).run();
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function moveBarStyleAction(
  projectId: string,
  styleId: string,
  direction: 'up' | 'down'
): Promise<StyleResult> {
  try {
    db.transaction((tx) => {
      materialise(projectId, tx);
      const target = resolveId(projectId, styleId);
      const rows = db
        .select()
        .from(schema.barStyles)
        .where(eq(schema.barStyles.projectId, projectId))
        .orderBy(asc(schema.barStyles.order))
        .all();
      const i = rows.findIndex((r) => r.id === target);
      const j = direction === 'up' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= rows.length) return;
      tx.update(schema.barStyles).set({ order: rows[j].order }).where(eq(schema.barStyles.id, rows[i].id)).run();
      tx.update(schema.barStyles).set({ order: rows[i].order }).where(eq(schema.barStyles.id, rows[j].id)).run();
      resequence(projectId, tx);
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function deleteBarStyleAction(
  projectId: string,
  styleId: string
): Promise<StyleResult> {
  try {
    db.transaction((tx) => {
      materialise(projectId, tx);
      const target = resolveId(projectId, styleId);
      if (!target) return;
      const n = db
        .select({ id: schema.barStyles.id })
        .from(schema.barStyles)
        .where(eq(schema.barStyles.projectId, projectId))
        .all().length;
      if (n <= 1) throw new Error('The last rule cannot go — a plan with no rules draws nothing');
      tx.delete(schema.barStyles).where(eq(schema.barStyles.id, target)).run();
      resequence(projectId, tx);
    });
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Back to the defaults, which is simply having no rows of one's own again. */
export async function resetBarStylesAction(projectId: string): Promise<StyleResult> {
  try {
    db.delete(schema.barStyles).where(eq(schema.barStyles.projectId, projectId)).run();
    return done();
  } catch (e) {
    return fail(e);
  }
}

/**
 * A `default:*` id names a POSITION in the default list, not a row. Once the
 * defaults have been copied in, that position is the row at the same index.
 */
function resolveId(projectId: string, styleId: string): string | null {
  if (!styleId.startsWith('default:')) return styleId;
  const index = DEFAULT_BAR_STYLES.findIndex((s) => s.id === styleId);
  if (index < 0) return null;
  const rows = db
    .select({ id: schema.barStyles.id })
    .from(schema.barStyles)
    .where(eq(schema.barStyles.projectId, projectId))
    .orderBy(asc(schema.barStyles.order))
    .all();
  return rows[index]?.id ?? null;
}
