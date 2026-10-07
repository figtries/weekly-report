'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

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
    db.update(schema.projects)
      .set({ barView: JSON.stringify(clean) })
      .where(eq(schema.projects.id, projectId))
      .run();
    revalidatePath('/projects', 'layout');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}
