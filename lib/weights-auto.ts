/**
 * Keeping weight in step with price, on the projects where that cannot hurt.
 *
 * `lib/weights-actions.ts` explains why recompute is normally an explicit act:
 * Gundih's 81 construction weights came from a workbook rather than from its
 * prices, and running the derivation over them replaces correct figures with
 * wrong ones. That rule protects weights nobody can re-derive. It was never
 * meant to protect weights that do not exist.
 *
 * And on a project built in the app, they do not. Typing prices into the
 * planner left every leaf at `bobot = NULL`, which is not a small thing: the
 * dashboard's `hasPlan` is `totalBobot > 0`, so a project with a full WBS, real
 * dates and real prices answered "has no weights yet" and sent the person back
 * to the planner they had just come from. The way out was two taps deep behind
 * **Money**, and nothing on screen said so (12 Sep 2026).
 *
 * So: **`weight_basis = 'boq'` is the lock.** An imported project carries it
 * (`scripts/import-gundih.ts`), and so does one whose owner has explicitly
 * applied a derivation that covers the whole plan. Anything else has no
 * authoritative weights to lose, and its prices are the only thing its weights
 * could possibly come from — so they follow along.
 *
 * This runs inside the caller's transaction, after the structure is settled.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { deriveWeights } from './weights';
import { loadWeightNodes } from './weights-read';

/** Anything that can write a row: the connection itself, or a transaction. */
type Writer = Pick<typeof db, 'update'>;

/**
 * Re-derive this project's leaf weights from its prices, unless its weights are
 * authoritative. Returns how many leaves moved — 0 when the project is locked.
 */
export function syncDerivedWeights(projectId: string, tx: Writer = db): number {
  const project = db
    .select({
      basis: schema.projects.weightBasis,
      contractValue: schema.projects.contractValue,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project || project.basis === 'boq') return 0;

  const nodes = loadWeightNodes(projectId);
  if (nodes.length === 0) return 0;

  // Measured against the SIGNED contract when there is one, exactly as the
  // Money panel measures it. Against the sum of the prices typed so far it
  // would close at 100 by definition and never show unpriced work.
  const result = deriveWeights(nodes, project.contractValue ?? undefined);

  let changed = 0;
  for (const n of nodes) {
    // A BRANCH CARRIES NO WEIGHT OF ITS OWN — its figure is its children, added
    // up when the report is built. The flag that says which is which is set
    // while a row is still a leaf and goes stale the moment something is
    // indented under it, and the weight it was holding stays behind: one of
    // these projects had a branch sitting on 100 with four leaves under it
    // adding up to another 100. Same stale-flag family as `isMilestone` in
    // `renumber()`, and cleared for the same reason.
    const next = n.isLeaf ? (result.bobotOf.get(n.id) ?? null) : null;
    const same =
      (n.bobot == null && next == null) ||
      (n.bobot != null && next != null && Math.abs(n.bobot - next) < 1e-9);
    if (same) continue;
    tx.update(schema.wbsNodes).set({ bobot: next }).where(eq(schema.wbsNodes.id, n.id)).run();
    changed += 1;
  }
  return changed;
}

/** The project a row belongs to — every structural action is handed a row id. */
export function projectOfNode(nodeId: string): string | null {
  return (
    db
      .select({ projectId: schema.wbsNodes.projectId })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.id, nodeId))
      .all()[0]?.projectId ?? null
  );
}
