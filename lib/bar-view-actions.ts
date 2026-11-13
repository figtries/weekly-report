'use server';

import { requireEdit } from './auth/require-edit';
import { revalidatePath } from 'next/cache';
import { and, eq, isNotNull, notInArray } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { parseBarView, type BarView } from './bar-view';

/**
 * Save the Bars panel's choices. The panel calls this on every press and has
 * already drawn the change, so this only has to make it stick.
 */
export async function setBarViewAction(
  projectId: string,
  view: BarView
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireEdit();
  try {
    const clean = parseBarView(JSON.stringify(view));
    await db.transaction(async (tx) => {
      await tx
        .update(schema.projects)
        .set({ barView: JSON.stringify(clean) })
        .where(eq(schema.projects.id, projectId));
      const ids = clean.labels.map((l) => l.id);
      await tx
        .update(schema.wbsNodes)
        .set({ barLabel: null })
        .where(
          and(
            eq(schema.wbsNodes.projectId, projectId),
            isNotNull(schema.wbsNodes.barLabel),
            ids.length ? notInArray(schema.wbsNodes.barLabel, ids) : undefined
          )
        );
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
  await requireEdit();
  try {
    const projectRows = await db
      .select({ v: schema.projects.barView })
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    const project = projectRows[0];
    if (!project) throw new Error('Project not found');
    if (labelId && !parseBarView(project.v).labels.some((l) => l.id === labelId)) {
      throw new Error('That label no longer exists');
    }
    const updated = await db
      .update(schema.wbsNodes)
      .set({ barLabel: labelId })
      .where(and(eq(schema.wbsNodes.id, nodeId), eq(schema.wbsNodes.projectId, projectId)));
    if (!updated.length) throw new Error('Row not found');
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}
