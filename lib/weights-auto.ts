/**
 * Keeping weight in step with price, on the projects where that cannot hurt.
 *
 * Recompute is never run over a locked project (`weight_basis = 'boq'`): Gundih's 81 construction weights came from a workbook rather than from its
 * prices, and running the derivation over them replaces correct figures with
 * wrong ones. That rule protects weights nobody can re-derive. It was never
 * meant to protect weights that do not exist.
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

import { db, type Db } from './pg';
import * as schema from './schema';
import { bobotWrites, deriveWeights } from './weights';
import { loadWeightNodes } from './weights-read';

/** Anything that can write a row: the connection itself, or a transaction. */
type Writer = Pick<Db, 'update'>;

/**
 * Re-derive this project's leaf weights from its prices, unless its weights are
 * authoritative. Returns how many leaves moved — 0 when the project is locked.
 */
export async function syncDerivedWeights(projectId: string, tx?: Writer): Promise<number> {
  const writer = tx ?? db;
  const projectRows = await db
    .select({
      basis: schema.projects.weightBasis,
      contractValue: schema.projects.contractValue,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const project = projectRows[0];
  if (!project || project.basis === 'boq') return 0;

  const nodes = await loadWeightNodes(projectId);
  if (nodes.length === 0) return 0;

  const signed = (project.contractValue ?? 0) > 0 ? (project.contractValue ?? undefined) : undefined;
  const result = deriveWeights(nodes, signed);

  const writes = bobotWrites(nodes, result);
  await Promise.all(
    writes.map((w) =>
      writer.update(schema.wbsNodes).set({ bobot: w.bobot }).where(eq(schema.wbsNodes.id, w.id))
    )
  );
  return writes.length;
}

/** The project a row belongs to — every structural action is handed a row id. */
export async function projectOfNode(nodeId: string): Promise<string | null> {
  const rows = await db
    .select({ projectId: schema.wbsNodes.projectId })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.id, nodeId));
  return rows[0]?.projectId ?? null;
}
