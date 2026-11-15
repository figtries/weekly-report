/**
 * The money summary for one project, straight off the database.
 *
 * Split from `lib/weights.ts` so the formula itself stays pure and testable
 * without a database — `scripts/verify-weights.ts` exercises it that way.
 */
import { eq } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { formatMoney } from './currency';
import {
  checkBudgetEdit,
  deriveWeights,
  describeIssue,
  issueHref,
  summariseWeights,
  weightIssues,
  type WeightNode,
  type WeightSummary,
} from './weights';

export async function loadWeightNodes(projectId: string): Promise<WeightNode[]> {
  const rows = await db
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
      isMilestone: schema.wbsNodes.isMilestone,
    })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(schema.wbsNodes.order);
  return rows.map((n) => ({
    ...n,
    parentId: n.parentId ?? null,
    workstepFactor: n.workstepFactor != null && n.workstepFactor > 0 ? n.workstepFactor : null,
  }));
}

export async function getWeightSummary(projectId: string): Promise<WeightSummary | null> {
  const projectRows = await db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const project = projectRows[0];
  if (!project) return null;
  const nodes = await loadWeightNodes(projectId);
  return summariseWeights(nodes, project.currency, project.contractValue);
}

export interface WeightFix {
  key: string;
  title: string;
  detail: string;
  action: string;
  href: string;
}

/**
 * Every money issue on a project, in words and with the one place it is fixed.
 */
export async function loadWeightFixes(projectId: string, week: number): Promise<WeightFix[]> {
  const projectRows = await db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const project = projectRows[0];
  if (!project) return [];

  const [rows, nodes] = await Promise.all([
    db
      .select({
        id: schema.wbsNodes.id,
        code: schema.wbsNodes.wbsCode,
        name: schema.wbsNodes.deskripsi,
        milestone: schema.wbsNodes.isMilestone,
      })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId)),
    loadWeightNodes(projectId),
  ]);

  const label = new Map(rows.map((r) => [r.id, `${r.code ?? ''} ${r.name ?? ''}`.trim()]));
  const milestones = new Set(rows.filter((r) => r.milestone).map((r) => r.id));
  const result = deriveWeights(nodes, project.contractValue ?? undefined);
  const say = (amount: number) => formatMoney(amount, project.currency);
  return weightIssues(result, milestones).map((issue) => ({
    key: 'id' in issue ? `${issue.kind}:${issue.id}` : issue.kind,
    ...describeIssue(issue, 'id' in issue ? (label.get(issue.id) ?? 'This row') : '', say),
    href: issueHref(issue, projectId, week),
  }));
}

/**
 * Why giving `nodeId` a budget of `next` would break the cap, or null when it
 * would not.
 */
export async function budgetRefusal(projectId: string, nodeId: string, next: number | null): Promise<string | null> {
  const projectRows = await db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));
  const project = projectRows[0];
  if (!project) return null;

  const [nodeRows, nodes] = await Promise.all([
    db
      .select({ id: schema.wbsNodes.id, code: schema.wbsNodes.wbsCode, name: schema.wbsNodes.deskripsi })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId)),
    loadWeightNodes(projectId),
  ]);

  const names = new Map(nodeRows.map((r) => [r.id, `${r.code ?? ''} ${r.name ?? ''}`.trim()]));
  return checkBudgetEdit(
    nodes,
    project.contractValue,
    nodeId,
    next,
    (id) => (id == null ? 'the contract' : (names.get(id) ?? 'this heading')),
    (amount) => formatMoney(amount, project.currency)
  );
}
