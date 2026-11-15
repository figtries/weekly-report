/**
 * "Lock as contract": today's plan, copied once as the contractual baseline.
 * The plan stays editable; this copy never moves, and nothing in the app
 * unlocks it (revisions are board item 18). approvedBy stays empty until login
 * exists (board 22): the reason is what makes the lock arguable later.
 */
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { getActiveBaselineId } from './sheet';

export async function lockContractSqlite(projectId: string, reason: string): Promise<{ baselineId: string; rows: number }> {
  const why = reason.trim();
  if (!why) throw new Error('Say why this plan is the contract: a reason is required');

  const [existsRows, active] = await Promise.all([
    db
      .select({ id: schema.baselines.id })
      .from(schema.baselines)
      .where(and(eq(schema.baselines.projectId, projectId), eq(schema.baselines.kind, 'contractual'))),
    getActiveBaselineId(projectId),
  ]);

  if (existsRows.length > 0) throw new Error('This project already has a contract');
  if (!active) throw new Error('This project has no schedule yet');

  const [leafRows, schedules] = await Promise.all([
    db
      .select({ id: schema.wbsNodes.id })
      .from(schema.wbsNodes)
      .where(and(eq(schema.wbsNodes.projectId, projectId), eq(schema.wbsNodes.isLeaf, true))),
    db
      .select()
      .from(schema.nodeSchedules)
      .where(eq(schema.nodeSchedules.baselineId, active)),
  ]);

  const leaves = new Set(leafRows.map((n) => n.id));
  const filtered = schedules.filter((s) => leaves.has(s.nodeId));
  const baselineId = `${projectId}:contractual`;

  await db.transaction(async (tx) => {
    await tx.insert(schema.baselines).values({
      id: baselineId,
      projectId,
      kind: 'contractual',
      revisionNo: 0,
      label: 'Contract',
      reason: why,
      approvedAt: new Date().toISOString(),
    });
    if (filtered.length) {
      await tx.insert(schema.nodeSchedules).values(
        filtered.map((s) => ({
          id: randomUUID(),
          baselineId,
          nodeId: s.nodeId,
          startDate: s.startDate,
          finishDate: s.finishDate,
          durationDays: s.durationDays,
        }))
      );
    }
  });

  return { baselineId, rows: filtered.length };
}
