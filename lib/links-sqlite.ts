/**
 * The only writer of `wbs_nodes.waits_for`. Not a server action, so the verify
 * scripts can call it; `saveRowLinksAction` in lib/sheet-actions.ts wraps it.
 *
 * Everything the Links panel and the Gantt drag refuse is refused here too,
 * because a payload from the browser can say anything. Reads go through `db`
 * (inside a better-sqlite3 transaction it is the same connection and sees the
 * transaction's own writes); writes go through the writer handed in.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { wouldLoop, type NetNode } from './chains';
import { cleanLink, parseLinks, serializeLinks, type StoredLink } from './links';

type Writer = Pick<typeof db, 'update'>;

function projectNodes(projectId: string) {
  return db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.projectId, projectId)).all();
}

function validate(projectId: string, nodeId: string, links: StoredLink[]): StoredLink[] {
  const nodes = projectNodes(projectId);
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
  // Loops, against the rest of the stored graph. Dates do not matter here, but
  // the network only reads scheduled leaves, so every leaf gets a nominal day.
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

export function setLinksSqlite(projectId: string, nodeId: string, links: StoredLink[]): void {
  const clean = validate(projectId, nodeId, links);
  db.update(schema.wbsNodes).set({ waitsFor: serializeLinks(clean) }).where(eq(schema.wbsNodes.id, nodeId)).run();
}

/**
 * The panel's Save: this row's own links, and how each follower waits for it.
 * A follower that was waiting for this row and is no longer listed stops
 * waiting for it; its other links are left alone. One transaction.
 */
export function saveRowLinksSqlite(projectId: string, nodeId: string, waitsFor: StoredLink[], holdsUp: StoredLink[]): void {
  const known = new Set(projectNodes(projectId).map((n) => n.id));
  for (const h of holdsUp) if (!known.has(h.id)) throw new Error('That activity was not found');
  db.transaction((tx) => {
    const own = validate(projectId, nodeId, waitsFor);
    tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(own) }).where(eq(schema.wbsNodes.id, nodeId)).run();

    const wanted = new Map(holdsUp.map((h) => [h.id, h]));
    for (const n of projectNodes(projectId)) {
      if (n.id === nodeId) continue;
      const current = parseLinks(n.waitsFor);
      const had = (current ?? []).some((l) => l.id === nodeId);
      const want = wanted.get(n.id);
      if (!had && !want) continue;
      const rest = (current ?? []).filter((l) => l.id !== nodeId);
      const next = want ? [...rest, { id: nodeId, type: want.type, wait: want.wait }] : rest;
      const clean = validate(projectId, n.id, next);
      tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(clean) }).where(eq(schema.wbsNodes.id, n.id)).run();
    }
  });
}

/**
 * Called from both `renumber()` copies, the funnel every structural change
 * passes through: a group row carries no links, and no link points at a row
 * that is gone or has become a group. The stale-flag family of `isMilestone`.
 * An undo that brings a deleted row back restores its own links, not the
 * links other rows had to it.
 */
export function pruneLinks(projectId: string, tx: Writer = db): void {
  const nodes = projectNodes(projectId);
  const leaf = new Set(nodes.filter((n) => n.isLeaf).map((n) => n.id));
  for (const n of nodes) {
    if (!n.waitsFor) continue;
    if (!n.isLeaf) {
      tx.update(schema.wbsNodes).set({ waitsFor: null }).where(eq(schema.wbsNodes.id, n.id)).run();
      continue;
    }
    const links = parseLinks(n.waitsFor);
    if (links === null) continue;
    const kept = links.filter((l) => leaf.has(l.id) && l.id !== n.id);
    if (kept.length !== links.length) {
      tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(kept) }).where(eq(schema.wbsNodes.id, n.id)).run();
    }
  }
}
