'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { previewWeights } from './weights';
import { loadWeightNodes } from './weights-read';

/**
 * Deriving weights from prices — deliberately, and only when asked.
 *
 * This used to run on every keystroke in the Price column. It cannot: Gundih's
 * prices reach 216 of its 218 leaves but reproduce only 95 of its 176 stored
 * weights, because the construction rows carry weights that came from the
 * workbook rather than from money. Running it silently would have moved 121
 * rows and broken a total that closes at exactly 100.000000.
 *
 * So the caller sees the damage first (`previewWeightsAction`) and then decides.
 * It is the same rule the schedule follows: nothing moves until its effect has
 * been shown.
 */

export interface WeightPreview {
  ok: true;
  contractValue: number;
  basis: 'boq' | 'partial' | 'even';
  storedTotal: number;
  derivedTotal: number;
  covers: number;
  leaves: number;
  changes: number;
  /** The largest movers, so the preview names names rather than a bare count. */
  biggest: { code: string; name: string; before: number | null; after: number | null }[];
}

export async function previewWeightsAction(
  projectId: string
): Promise<WeightPreview | { ok: false; error: string }> {
  try {
    const nodes = loadWeightNodes(projectId);
    if (nodes.length === 0) throw new Error('This project has no work breakdown yet');
    const { result, changes, storedTotal } = previewWeights(nodes);

    const meta = new Map(
      db
        .select({
          id: schema.wbsNodes.id,
          code: schema.wbsNodes.wbsCode,
          name: schema.wbsNodes.deskripsi,
        })
        .from(schema.wbsNodes)
        .where(eq(schema.wbsNodes.projectId, projectId))
        .all()
        .map((r) => [r.id, r])
    );

    const biggest = [...changes]
      .sort(
        (a, b) =>
          Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0))
      )
      .slice(0, 5)
      .map((c) => ({
        code: meta.get(c.id)?.code ?? '?',
        name: meta.get(c.id)?.name ?? '',
        before: c.before,
        after: c.after,
      }));

    return {
      ok: true,
      contractValue: result.contractValue,
      basis: result.basis,
      storedTotal,
      derivedTotal: result.total,
      covers: result.covered,
      leaves: result.leaves,
      changes: changes.length,
      biggest,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}

export async function applyWeightsAction(
  projectId: string
): Promise<{ ok: true; changed: number } | { ok: false; error: string }> {
  try {
    const nodes = loadWeightNodes(projectId);
    const { result } = previewWeights(nodes);
    if (result.contractValue <= 0) throw new Error('Give the plan some prices first');

    let changed = 0;
    db.transaction((tx) => {
      for (const n of nodes) {
        if (!n.isLeaf) continue;
        const next = result.bobotOf.get(n.id) ?? null;
        tx.update(schema.wbsNodes).set({ bobot: next }).where(eq(schema.wbsNodes.id, n.id)).run();
        changed += 1;
      }
      tx.update(schema.projects)
        .set({
          contractValue: result.contractValue,
          // `boq` only when the prices actually cover the plan. A partial BOQ
          // labelled `boq` is a report claiming a whole it does not have.
          weightBasis: result.basis === 'boq' ? 'boq' : 'even',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.projects.id, projectId))
        .run();
    });

    revalidatePath('/projects', 'layout');
    revalidatePath('/', 'layout');
    return { ok: true, changed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}
