/**
 * The only writer of `wbs_nodes.waits_for`. Not a server action, so the verify
 * scripts can call it; `saveRowLinksAction` in lib/sheet-actions.ts wraps it.
 *
 * Everything the Links panel and the Gantt drag refuse is refused here too,
 * because a payload from the browser can say anything.
 */
import { eq } from 'drizzle-orm';

import { db, type Db } from './pg';
import * as schema from './schema';
import { wouldLoop, type NetNode } from './chains';
import { cleanLink, parseLinks, serializeLinks, type StoredLink } from './links';

type Writer = Pick<Db, 'update'>;

async function projectNodes(projectId: string) {
  return db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.projectId, projectId));
}

async function validate(projectId: string, nodeId: string, links: StoredLink[]): Promise<StoredLink[]> {
  const nodes = await projectNodes(projectId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const self = byId.get(nodeId);
  if (!self) throw new Error('Row not found');
  if (!self.isLeaf) throw new Error('A group row cannot wait for anything; link the activities inside it');
  const clean: StoredLink[] = [];
  const seen = new Set<string>();
  for (const raw of links) {
    const l = cleanLink(raw);
    if (!l) throw new Error('That link is not valid');
    if (l.id === nodeId) throw new Error('An activity cannot wait for itself');
    const other = byId.get(l.id);
    if (!other) throw new Error('That activity was not found');
    if (!other.isLeaf) throw new Error('A group row cannot be waited for; pick an activity inside it');
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    clean.push(l);
  }
  const graph: NetNode[] = nodes.map((n) => ({
    id: n.id,
    isLeaf: n.isLeaf,
    isMilestone: n.isMilestone,
    startDate: '2000-01-01',
    finishDate: '2000-01-01',
    links: n.id === nodeId ? [] : parseLinks(n.waitsFor),
  }));
  const me = graph.find((n) => n.id === nodeId)!;
  for (const l of clean) {
    const path = wouldLoop(graph, l.id, nodeId);
    if (path) {
      const name = (id: string) => byId.get(id)?.deskripsi ?? id;
      throw new Error(`That would loop back: ${path.map(name).join(' → ')}`);
    }
    me.links = [...(me.links ?? []), l];
  }
  return clean;
}

export async function setLinksSqlite(projectId: string, nodeId: string, links: StoredLink[]): Promise<void> {
  const clean = await validate(projectId, nodeId, links);
  await db.update(schema.wbsNodes).set({ waitsFor: serializeLinks(clean) }).where(eq(schema.wbsNodes.id, nodeId));
}

/**
 * The panel's Save: this row's own links, and how each follower waits for it.
 */
export async function saveRowLinksSqlite(projectId: string, nodeId: string, waitsFor: StoredLink[], holdsUp: StoredLink[]): Promise<void> {
  const known = new Set((await projectNodes(projectId)).map((n) => n.id));
  for (const h of holdsUp) if (!known.has(h.id)) throw new Error('That activity was not found');

  await db.transaction(async (tx) => {
    const own = await validate(projectId, nodeId, waitsFor);
    await tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(own) }).where(eq(schema.wbsNodes.id, nodeId));

    const wanted = new Map(holdsUp.map((h) => [h.id, h]));
    const nodes = await projectNodes(projectId);
    for (const n of nodes) {
      if (n.id === nodeId) continue;
      const current = parseLinks(n.waitsFor);
      const had = (current ?? []).some((l) => l.id === nodeId);
      const want = wanted.get(n.id);
      if (!had && !want) continue;
      const rest = (current ?? []).filter((l) => l.id !== nodeId);
      const next = want ? [...rest, { id: nodeId, type: want.type, wait: want.wait }] : rest;
      const clean = await validate(projectId, n.id, next);
      await tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(clean) }).where(eq(schema.wbsNodes.id, n.id));
    }
  });
}

/**
 * Called from both `renumber()` copies: a group row carries no links, and no
 * link points at a row that is gone or has become a group.
 */
export async function pruneLinks(projectId: string, tx?: Writer): Promise<void> {
  const writer = tx ?? db;
  const nodes = await projectNodes(projectId);
  const leaf = new Set(nodes.filter((n) => n.isLeaf).map((n) => n.id));
  await Promise.all(
    nodes
      .filter((n) => n.waitsFor)
      .map(async (n) => {
        if (!n.isLeaf) {
          await writer.update(schema.wbsNodes).set({ waitsFor: null }).where(eq(schema.wbsNodes.id, n.id));
          return;
        }
        const links = parseLinks(n.waitsFor);
        if (links === null) return;
        const kept = links.filter((l) => leaf.has(l.id) && l.id !== n.id);
        if (kept.length !== links.length) {
          await writer.update(schema.wbsNodes).set({ waitsFor: serializeLinks(kept) }).where(eq(schema.wbsNodes.id, n.id));
        }
      })
  );
}
