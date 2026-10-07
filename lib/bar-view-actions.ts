'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull, notInArray } from 'drizzle-orm';

import { beforeWrite, db, schema } from './sqlite';
import { parseBarView, type BarView } from './bar-view';

/**
 * Save the Bars panel's choices. The panel calls this on every press and has
 * already drawn the change, so this only has to make it stick.
 */
export async function setBarViewAction(
  projectId: string,
  view: BarView
): Promise<{ ok: true } | { ok: false; error: string }> {
  await beforeWrite();
  try {
    // Round-tripped through the parser: a client payload never stores a paint
    // the palette does not offer, or a field the panel does not have.
    const clean = parseBarView(JSON.stringify(view));
    db.transaction((tx) => {
      tx.update(schema.projects)
        .set({ barView: JSON.stringify(clean) })
        .where(eq(schema.projects.id, projectId))
        .run();
      // A label that was deleted leaves no row pointing at it.
      const ids = clean.labels.map((l) => l.id);
      tx.update(schema.wbsNodes)
        .set({ barLabel: null })
        .where(
          and(
            eq(schema.wbsNodes.projectId, projectId),
            isNotNull(schema.wbsNodes.barLabel),
            ids.length ? notInArray(schema.wbsNodes.barLabel, ids) : undefined
          )
        )
        .run();
    });
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}

/** Put one of the project's own labels on a row, or take it off (null). */
export async function setBarLabelAction(
  projectId: string,
  nodeId: string,
  labelId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  await beforeWrite();
  try {
    const project = db
      .select({ v: schema.projects.barView })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId))
      .all()[0];
    if (!project) throw new Error('Project not found');
    if (labelId && !parseBarView(project.v).labels.some((l) => l.id === labelId)) {
      throw new Error('That label no longer exists');
    }
    const res = db
      .update(schema.wbsNodes)
      .set({ barLabel: labelId })
      .where(and(eq(schema.wbsNodes.id, nodeId), eq(schema.wbsNodes.projectId, projectId)))
      .run();
    if (res.changes === 0) throw new Error('Row not found');
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}
