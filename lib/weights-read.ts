/**
 * The money summary for one project, straight off the database.
 *
 * Split from `lib/weights.ts` so the formula itself stays pure and testable
 * without a database — `scripts/verify-weights.ts` exercises it that way.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { formatMoney } from './currency';
import {
  checkBudgetEdit,
  summariseWeights,
  type WeightNode,
  type WeightSummary,
} from './weights';

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
    .map((n) => ({
      ...n,
      parentId: n.parentId ?? null,
      // A stored 0% is nobody's decision: the percent box wrote one when
      // someone typed 0, and it read back as a row that had been set. The
      // action writes null for it now; this covers what is already stored.
      workstepFactor: n.workstepFactor != null && n.workstepFactor > 0 ? n.workstepFactor : null,
    }));
}

export function getWeightSummary(projectId: string): WeightSummary | null {
  const project = db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project) return null;
  // A project with no rows still has money. Returning null here hid the
  // contract figure on exactly the project where it had just been typed, along
  // with the currency picker and the gap — which on a new project is the whole
  // contract. `summariseWeights` handles an empty list; the strip hides the
  // parts that need rows.
  const nodes = loadWeightNodes(projectId);
  // `projects.contract_value` is the SIGNED figure now, not a cache of the sum.
  // One source, read here and nowhere else, so the list card and the project
  // page can never show two different numbers for the same project again.
  return summariseWeights(nodes, project.currency, project.contractValue);
}

/**
 * Why giving `nodeId` a budget of `next` would break the cap, or null when it
 * would not. The pure rule is `checkBudgetEdit`; this only gathers what it
 * needs from the database and says the figures in the project's own currency.
 */
export function budgetRefusal(projectId: string, nodeId: string, next: number | null): string | null {
  const project = db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project) return null;
  const names = new Map(
    db
      .select({ id: schema.wbsNodes.id, code: schema.wbsNodes.wbsCode, name: schema.wbsNodes.deskripsi })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId))
      .all()
      .map((r) => [r.id, `${r.code ?? ''} ${r.name ?? ''}`.trim()])
  );
  return checkBudgetEdit(
    loadWeightNodes(projectId),
    project.contractValue,
    nodeId,
    next,
    (id) => (id == null ? 'the contract' : (names.get(id) ?? 'this heading')),
    (amount) => formatMoney(amount, project.currency)
  );
}
