/**
 * The guesses offered in the Links panel, one list per activity: the chain the
 * dates already describe (`inferChains`: siblings that start right after one
 * another) and EPC order's guess (`unansweredLinks`, fetched by the panel from
 * /api/projects/[id]/link-suggestions because it needs work kinds and ladders
 * the sheet does not carry). Only for activities nobody has answered
 * (links === null). Each is applied by its own press, never in bulk: a
 * one-press "link everything" was shipped and removed on 27 Sep 2026 because
 * nothing showed what it had done.
 */
import { inferChains } from './chains';
import type { SheetRow } from './sheet';

export function suggestionsFor(
  rows: Pick<SheetRow, 'id' | 'parentId' | 'isLeaf' | 'startDate' | 'finishDate' | 'links'>[],
  epc: Record<string, string[]> = {}
): Map<string, string[]> {
  const asked = new Set(rows.filter((r) => r.links !== null).map((r) => r.id));
  const leaf = new Set(rows.filter((r) => r.isLeaf).map((r) => r.id));
  const out = new Map<string, string[]>();
  const add = (to: string, from: string) => {
    if (asked.has(to) || !leaf.has(to) || !leaf.has(from) || to === from) return;
    const list = out.get(to);
    if (!list) out.set(to, [from]);
    else if (!list.includes(from)) list.push(from);
  };
  const nodes = rows.map((r, i) => ({
    id: r.id,
    parentId: r.parentId,
    order: i,
    isLeaf: r.isLeaf,
    startDate: r.startDate,
    finishDate: r.finishDate,
  }));
  for (const l of inferChains(nodes)) add(l.toId, l.fromId);
  for (const [to, froms] of Object.entries(epc)) for (const from of froms) add(to, from);
  return out;
}
