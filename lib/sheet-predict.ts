import type { SheetRow } from '@/lib/sheet';

/**
 * What the sheet draws while the server is still thinking.
 *
 * Lives apart from `ScheduleSheet` because it is not only the toolbar that
 * edits the plan. The row menu behind each `⋯` has its own Add, Indent, Move
 * and Delete, and the confirm panel for a row WITH CHILDREN is one of them —
 * which is how "Delete is still slow" survived the first pass at this: a leaf
 * went through the toolbar's optimistic path and everything with children went
 * through the panel's, which awaited the whole round trip with the subtree
 * still sitting on screen under a "Deleting…" label.
 *
 * One set of functions, used by both.
 *
 * Structural edits used to show NOTHING until both a server action and a
 * `router.refresh()` had come back — 1.5 to 3 seconds on the deployment, of
 * which the bulk is one ~2 MB snapshot upload that is awaited on purpose. The
 * work was never the problem; the silence was. Editing a cell has always gone
 * through the same wait and has always felt fine, because `patch()` moves the
 * screen first.
 *
 * So the sheet now guesses, and it guesses only what it can actually know: that
 * a row exists here, that this row is one level deeper, that this row is gone.
 * The outline codes are NOT guessed — reproducing `renumber()` in the browser
 * is exactly the trap the old comment warned about — so a pending row wears no
 * code and the rows below it keep theirs until the answer lands. A moment of a
 * stale code costs nothing; a wrong one that then corrects itself is what makes
 * a sheet untrustworthy.
 */
export const TMP = 'tmp-';
export const isPending = (id: string) => id.startsWith(TMP);
let tmpSeq = 0;
/** A placeholder id. Being a `tmp-` is the entire record that a row is unconfirmed. */
export function tmpRowId(): string {
  tmpSeq += 1;
  return `${TMP}${tmpSeq}`;
}

/** Everything under `rows[i]`, by depth — the subtree travels with its row. */
function subtreeEnd(rows: SheetRow[], i: number): number {
  const depth = rows[i].depth;
  let end = i + 1;
  while (end < rows.length && rows[end].depth > depth) end += 1;
  return end;
}

/**
 * A placeholder row, born where the server is about to put the real one.
 *
 * Dates are left null on purpose. The server's rule is "the day after the row
 * above finishes", which this could copy — but a bar that draws in one place
 * and then moves is worse than a bar that arrives a beat late, and the row is
 * on screen either way.
 */
function blankRow(id: string, depth: number, parentId: string | null): SheetRow {
  return {
    id,
    parentId,
    code: '',
    wbsCode: '',
    name: 'New task',
    depth,
    isLeaf: true,
    isMilestone: false,
    isReportingUnit: false,
    unitLabel: null,
    price: null,
    bobot: null,
    startDate: null,
    finishDate: null,
    targetDate: null,
    daysLate: null,
    durationDays: null,
    childCount: 0,
    isSummary: false,
    colorGroup: -1,
    groupLabel: null,
    unitId: null,
    unitName: null,
    totalFloat: null,
    isCritical: false,
  };
}

/** Add: after the anchor's whole subtree, or as its first child. */
export function predictAdd(rows: SheetRow[], anchorId: string | null, asChild: boolean, tmpId: string): SheetRow[] {
  const i = anchorId ? rows.findIndex((r) => r.id === anchorId) : -1;
  if (i < 0) return [...rows, blankRow(tmpId, 0, null)];
  const a = rows[i];
  const at = asChild ? i + 1 : subtreeEnd(rows, i);
  const row = blankRow(tmpId, a.depth + (asChild ? 1 : 0), asChild ? a.id : a.parentId);
  const next = [...rows.slice(0, at), row, ...rows.slice(at)];
  if (asChild) next[i] = { ...a, isLeaf: false, childCount: a.childCount + 1 };
  return next;
}

/** Indent: the row and everything under it drop a level, under the sibling above. */
export function predictIndent(rows: SheetRow[], id: string): SheetRow[] {
  const i = rows.findIndex((r) => r.id === id);
  if (i <= 0) return rows;
  const me = rows[i];
  let p = i - 1;
  while (p >= 0 && rows[p].depth > me.depth) p -= 1;
  if (p < 0 || rows[p].depth !== me.depth) return rows;
  const end = subtreeEnd(rows, i);
  const next = rows.map((r, k) => (k >= i && k < end ? { ...r, depth: r.depth + 1 } : r));
  next[i] = { ...next[i], parentId: rows[p].id };
  next[p] = { ...rows[p], isLeaf: false, childCount: rows[p].childCount + 1 };
  return next;
}

/** Outdent: the row and its subtree come up a level, landing past the old parent's. */
export function predictOutdent(rows: SheetRow[], id: string): SheetRow[] {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0 || rows[i].depth === 0) return rows;
  const me = rows[i];
  const parentAt = rows.findIndex((r) => r.id === me.parentId);
  if (parentAt < 0) return rows;
  const end = subtreeEnd(rows, i);
  const moving = rows.slice(i, end).map((r) => ({ ...r, depth: r.depth - 1 }));
  moving[0] = { ...moving[0], parentId: rows[parentAt].parentId };
  const rest = [...rows.slice(0, i), ...rows.slice(end)];
  const landing = subtreeEnd(rest, rest.findIndex((r) => r.id === me.parentId));
  return [...rest.slice(0, landing), ...moving, ...rest.slice(landing)];
}

/** Delete: the row and its subtree go, and the parent loses a child. */
export function predictDelete(rows: SheetRow[], id: string): SheetRow[] {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return rows;
  const end = subtreeEnd(rows, i);
  const parentId = rows[i].parentId;
  const next = [...rows.slice(0, i), ...rows.slice(end)];
  return next.map((r) =>
    r.id === parentId
      ? { ...r, childCount: Math.max(0, r.childCount - 1), isLeaf: r.childCount <= 1 }
      : r
  );
}


/**
 * Move among siblings, subtree and all.
 *
 * The server does this with a half-step on `sort_order` and a renumber; here it
 * is a splice, which is the same answer for anything the eye can check. Up
 * lands before the previous sibling, down after the next one's own subtree.
 */
export function predictMove(rows: SheetRow[], id: string, dir: 'up' | 'down'): SheetRow[] {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return rows;
  const me = rows[i];
  const end = subtreeEnd(rows, i);
  const block = rows.slice(i, end);
  const rest = [...rows.slice(0, i), ...rows.slice(end)];

  if (dir === 'up') {
    // The previous sibling is the nearest row above at the same depth; anything
    // between the two belongs to it.
    let p = i - 1;
    while (p >= 0 && rows[p].depth > me.depth) p -= 1;
    if (p < 0 || rows[p].depth !== me.depth) return rows;
    const at = rest.findIndex((r) => r.id === rows[p].id);
    return [...rest.slice(0, at), ...block, ...rest.slice(at)];
  }

  const next = rest.find((r, k) => k >= i && r.depth === me.depth);
  if (!next || next.parentId !== me.parentId) return rows;
  const at = subtreeEnd(rest, rest.findIndex((r) => r.id === next.id));
  return [...rest.slice(0, at), ...block, ...rest.slice(at)];
}

/**
 * A flag flipped on one row, and nothing else claimed.
 *
 * Marking a reporting unit really does repaint a whole subtree — `colorGroup`,
 * `unitId` and the legend all move — and none of that is guessed here. The
 * badge appears, the colours settle when the answer lands. Showing the part
 * that is certain beats showing nothing for a second and a half.
 */
export function predictFlags(rows: SheetRow[], id: string, next: Partial<SheetRow>): SheetRow[] {
  return rows.map((r) => (r.id === id ? { ...r, ...next } : r));
}
