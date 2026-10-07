/**
 * "Lock as contract": today's plan, copied once as the contractual baseline.
 * The plan stays editable; this copy never moves, and nothing in the app
 * unlocks it (revisions are board item 18). approvedBy stays empty until login
 * exists (board 22): the reason is what makes the lock arguable later.
 */
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { getActiveBaselineId } from './sheet';

export function lockContractSqlite(projectId: string, reason: string): { baselineId: string; rows: number } {
  const why = reason.trim();
  if (!why) throw new Error('Say why this plan is the contract: a reason is required');
  const exists = db
    .select({ id: schema.baselines.id })
    .from(schema.baselines)
    .where(and(eq(schema.baselines.projectId, projectId), eq(schema.baselines.kind, 'contractual')))
    .all()[0];
  if (exists) throw new Error('This project already has a contract');
  const active = getActiveBaselineId(projectId);
  if (!active) throw new Error('This project has no schedule yet');
  const leaves = new Set(
    db
      .select({ id: schema.wbsNodes.id })
      .from(schema.wbsNodes)
      .where(and(eq(schema.wbsNodes.projectId, projectId), eq(schema.wbsNodes.isLeaf, true)))
      .all()
      .map((n) => n.id)
  );
  const schedules = db
    .select()
    .from(schema.nodeSchedules)
    .where(eq(schema.nodeSchedules.baselineId, active))
    .all()
    .filter((s) => leaves.has(s.nodeId));
  const baselineId = `${projectId}:contractual`;
  db.transaction((tx) => {
    tx.insert(schema.baselines)
      .values({
        id: baselineId,
        projectId,
        kind: 'contractual',
        revisionNo: 0,
        label: 'Contract',
        reason: why,
        approvedAt: new Date().toISOString(),
      })
      .run();
    for (const s of schedules) {
      tx.insert(schema.nodeSchedules)
        .values({
          id: randomUUID(),
          baselineId,
          nodeId: s.nodeId,
          startDate: s.startDate,
          finishDate: s.finishDate,
          durationDays: s.durationDays,
        })
        .run();
    }
  });
  return { baselineId, rows: schedules.length };
}
