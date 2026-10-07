/**
 * Where an arrow between two bars runs. Pure, so its shape is tested rather
 * than eyeballed. Elbows only: the corners carry no meaning, the ends do —
 * after it finishes leaves the right end and enters the left, after it starts
 * leaves and enters on the left, finishes after it finishes on the right.
 */
import type { LinkType } from './links';

const STUB = 8;
const GAP = 2;

export function arrowPath(
  type: LinkType,
  from: { x1: number; x2: number; y: number },
  to: { x1: number; x2: number; y: number; milestone: boolean },
  rowH: number
): string {
  const toLeft = to.milestone ? to.x1 - 6 : to.x1;
  if (type === 'SS') {
    // Never left of the chart's own edge: a bar that starts on day one would
    // otherwise send its arrow out of the drawing.
    const x = Math.max(2, Math.min(from.x1, toLeft) - 10);
    return `M${from.x1} ${from.y} H${x} V${to.y} H${toLeft - GAP}`;
  }
  if (type === 'FF') {
    const toRight = to.milestone ? to.x1 + 6 : to.x2;
    const x = Math.max(from.x2, toRight) + 10;
    return `M${from.x2} ${from.y} H${x} V${to.y} H${toRight + GAP}`;
  }
  if (toLeft - 10 >= from.x2 + STUB) return `M${from.x2} ${from.y} H${from.x2 + STUB} V${to.y} H${toLeft - GAP}`;
  const mid = from.y + (to.y > from.y ? rowH / 2 : -rowH / 2);
  return `M${from.x2} ${from.y} H${from.x2 + STUB} V${mid} H${toLeft - 12} V${to.y} H${toLeft - GAP}`;
}

/** The row an arrow ends on: itself if shown, else its nearest shown group. */
export function visibleEnd(
  id: string,
  visibleIndex: Map<string, number>,
  parentOf: Map<string, string | null>
): { index: number; collapsed: boolean } | null {
  let cur: string | null | undefined = id;
  let collapsed = false;
  while (cur) {
    const i = visibleIndex.get(cur);
    if (i !== undefined) return { index: i, collapsed };
    collapsed = true;
    cur = parentOf.get(cur);
  }
  return null;
}
