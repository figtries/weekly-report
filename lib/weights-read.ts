/**
 * The money summary for one project, straight off the database.
 *
 * Split from `lib/weights.ts` so the formula itself stays pure and testable
 * without a database — `scripts/verify-weights.ts` exercises it that way.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { summariseWeights, type WeightNode, type WeightSummary } from './weights';

export function loadWeightNodes(projectId: string): WeightNode[] {
  return db
    .select({
      id: schema.wbsNodes.id,
      parentId: schema.wbsNodes.parentId,
      order: schema.wbsNodes.order,
      price: schema.wbsNodes.price,
      workstepFactor: schema.wbsNodes.workstepFactor,
      isReportingUnit: schema.wbsNodes.isReportingUnit,
      unitContractValue: schema.wbsNodes.unitContractValue,
      bobot: schema.wbsNodes.bobot,
      isLeaf: schema.wbsNodes.isLeaf,
    })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(schema.wbsNodes.order)
    .all()
    .map((n) => ({ ...n, parentId: n.parentId ?? null }));
}

export function getWeightSummary(projectId: string): WeightSummary | null {
  const project = db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project) return null;
  const nodes = loadWeightNodes(projectId);
  if (nodes.length === 0) return null;
  // `projects.contract_value` is the SIGNED figure now, not a cache of the sum.
  // One source, read here and nowhere else, so the list card and the project
  // page can never show two different numbers for the same project again.
  return summariseWeights(nodes, project.currency, project.contractValue);
}
