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
import { disciplineOf, findDiscipline } from './disciplines';
import type { Milestone, ProgressMethod } from './types';

const methodFor = (s: Shape): ProgressMethod => (s === 'qty' ? 'qty' : s === 'manual' ? 'lumpsum' : 'milestone');

function writeLeaf(
  id: string,
  name: string,
  kindId: string,
  shape: Shape,
  disciplineId: string | null,
  steps?: Milestone[]
) {
  const milestones = steps ?? ladderFor(kindId, shape, name, BUILT_IN_KINDS, disciplineId);
  setWorkKindSqlite(id, kindId, methodFor(shape), shape === 'qty' ? {} : { milestones });
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

/**
 * The rows under a heading that a new kind would reach, without writing them.
 * The panel counts these for "Applies to the N rows under it"; the write below
 * walks the same way, so the number said is the number written.
 */
export function reachOf(
  heading: { id: string; kind: string | null },
  kindId: string,
  kids: Map<string, { id: string; kind: string | null }[]>
): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    for (const c of kids.get(id) ?? []) {
      const follows = c.kind == null || c.kind === heading.kind;
      const isHeading = kids.has(c.id);
      if (isHeading && !follows) continue; // a heading with its own kind governs its subtree
      if (follows && c.kind !== kindId) out.push(c.id);
      if (isHeading) walk(c.id);
    }
  };
  walk(heading.id);
  return out;
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
    writeLeaf(nodeId, target.name, kindId, shape, null, steps);
    return [nodeId];
  }

  if (shape === 'qty') throw new Error('Set quantities row by row: each one needs its own total.');
  const kind = BUILT_IN_KINDS.find((k) => k.id === kindId);
  if (!kind) throw new Error('Unknown kind of work');
  const disciplineId = kindId === 'construction' ? disciplineOf(steps)?.id ?? null : null;
  const pattern = findDiscipline(disciplineId) ?? kind;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const reach = reachOf(target, kindId, kids);

  db.update(schema.wbsNodes).set({ workKind: kindId }).where(eq(schema.wbsNodes.id, nodeId)).run();
  for (const id of reach) {
    const n = byId.get(id)!;
    if (kids.has(id)) {
      db.update(schema.wbsNodes).set({ workKind: kindId }).where(eq(schema.wbsNodes.id, id)).run();
    } else {
      writeLeaf(id, n.name, kindId, shapeOf(n.name, pattern), disciplineId);
    }
  }
  return [nodeId, ...reach];
}

/**
 * A new row under a heading takes the nearest heading's kind. For construction
 * it takes a sibling's discipline too, because a heading stores the kind and
 * the discipline lives in its rows' rungs.
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

  let disciplineId: string | null = null;
  if (kind.id === 'construction') {
    for (const s of all) {
      if (s.parentId !== me.parentId || s.id === nodeId || s.kind !== 'construction') continue;
      const ms = db
        .select({ id: schema.milestones.id })
        .from(schema.milestones)
        .where(eq(schema.milestones.nodeId, s.id))
        .all();
      disciplineId = disciplineOf(ms)?.id ?? null;
      if (disciplineId) break;
    }
  }
  writeLeaf(nodeId, me.name, kind.id, shapeOf(me.name, findDiscipline(disciplineId) ?? kind), disciplineId);
}
