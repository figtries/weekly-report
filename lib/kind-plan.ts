/**
 * The kind of work, set in the plan (7 Oct 2026).
 *
 * It used to be asked in Data Overall during the weekly update, so a plan could
 * be built without anyone saying what each activity was. Now the planner asks.
 * A row is written exactly as Data Overall wrote it (`setWorkKindSqlite`, which
 * carries recorded progress across rather than zeroing it). A heading hands
 * its kind down to the rows under it that have none of their own, or that still
 * carry its previous one; a row somebody gave a different kind is left alone,
 * and so is a heading with its own kind, with everything under it.
 *
 * Synchronous, like every write here; `lib/kind-plan-actions.ts` is the door.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { setWorkKindSqlite } from './progress-sqlite';
import { ladderFor } from './work-kind-apply';
import { BUILT_IN_KINDS, shapeOf, type Shape } from './work-kind';
import { reachOf } from './kind-reach';
import type { Milestone, ProgressMethod } from './types';

const methodFor = (s: Shape): ProgressMethod => (s === 'qty' ? 'qty' : s === 'manual' ? 'lumpsum' : 'milestone');

function writeLeaf(
  id: string,
  name: string,
  kindId: string,
  shape: Shape,
  steps?: Milestone[]
) {
  const milestones = steps ?? ladderFor(kindId, shape, name, BUILT_IN_KINDS);
  setWorkKindSqlite(id, kindId, methodFor(shape), shape === 'qty' ? {} : { milestones });
}

/**
 * Construction with no part yet (8 Oct 2026): the plan asks only the kind, and
 * Data Overall asks which part, which is what brings the stages. Until then a
 * typed percent, so whatever was recorded stands as it was.
 */
function writeUnanswered(id: string, name: string) {
  writeLeaf(id, name, 'construction', 'manual', []);
}

function nodesOf(projectId: string) {
  return db
    .select({
      id: schema.wbsNodes.id,
      parentId: schema.wbsNodes.parentId,
      name: schema.wbsNodes.deskripsi,
      kind: schema.wbsNodes.workKind,
    })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .all();
}

type Node = ReturnType<typeof nodesOf>[number];

function childrenOf(nodes: Node[]): Map<string, Node[]> {
  const kids = new Map<string, Node[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n);
    else kids.set(n.parentId, [n]);
  }
  return kids;
}

/** Set a row's kind; on a heading, hand it down. Returns the ids written. */
export function applyKindInPlan(
  projectId: string,
  nodeId: string,
  kindId: string,
  shape: Shape,
  steps: Milestone[]
): string[] {
  const nodes = nodesOf(projectId);
  const target = nodes.find((n) => n.id === nodeId);
  if (!target) throw new Error('Row not found');
  const kids = childrenOf(nodes);

  if (!kids.has(nodeId)) {
    if (kindId === 'construction') writeUnanswered(nodeId, target.name);
    else writeLeaf(nodeId, target.name, kindId, shape, steps);
    return [nodeId];
  }

  if (shape === 'qty') throw new Error('Set quantities row by row: each one needs its own total.');
  const kind = BUILT_IN_KINDS.find((k) => k.id === kindId);
  if (!kind) throw new Error('Unknown kind of work');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reach = reachOf(target, kindId, kids);

  db.update(schema.wbsNodes).set({ workKind: kindId }).where(eq(schema.wbsNodes.id, nodeId)).run();
  for (const id of reach) {
    const n = byId.get(id)!;
    if (kids.has(id)) {
      db.update(schema.wbsNodes).set({ workKind: kindId }).where(eq(schema.wbsNodes.id, id)).run();
    } else if (kindId === 'construction') {
      writeUnanswered(id, n.name);
    } else {
      writeLeaf(id, n.name, kindId, shapeOf(n.name, kind));
    }
  }
  return [nodeId, ...reach];
}

/**
 * A new row under a heading takes the nearest heading's kind. A construction
 * row's part is never guessed from its siblings: nobody has said it yet, so
 * Data Overall asks (8 Oct 2026).
 */
export function inheritKind(projectId: string, nodeId: string): void {
  const all = nodesOf(projectId);
  const byId = new Map(all.map((n) => [n.id, n]));
  const me = byId.get(nodeId);
  if (!me) return;
  let p = me.parentId ? byId.get(me.parentId) : undefined;
  while (p && !p.kind) p = p.parentId ? byId.get(p.parentId) : undefined;
  const kind = p?.kind ? BUILT_IN_KINDS.find((k) => k.id === p!.kind) : undefined;
  if (!kind) return;
  if (kind.id === 'construction') return writeUnanswered(nodeId, me.name);
  writeLeaf(nodeId, me.name, kind.id, shapeOf(me.name, kind));
}
