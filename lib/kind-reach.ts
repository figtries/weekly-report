/**
 * The rows under a heading that a new kind of work would reach, without
 * writing them: every row with no kind, or still carrying the heading's
 * previous one, and not already the new kind. A heading with a kind of its
 * own governs its subtree and is skipped with it.
 *
 * Pure, so the planner's panel counts "Applies to the N rows under it" with
 * the same walk lib/kind-plan.ts writes with: the number said is the number
 * written.
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
      if (isHeading && !follows) continue;
      if (follows && c.kind !== kindId) out.push(c.id);
      if (isHeading) walk(c.id);
    }
  };
  walk(heading.id);
  return out;
}
