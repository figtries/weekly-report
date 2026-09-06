/**
 * What follows what, guessed from the dates that are already there.
 *
 * Nobody links 285 tasks by hand. MS Project makes you, which is why most real
 * plans in this industry have no links at all and every schedule revision is
 * done by dragging every bar individually. The dates, though, already say it:
 * when IFA starts the day after IFR finishes, and it does that on every
 * engineering triple in the plan, that is a chain whether or not anyone typed
 * one. On Gundih the guess finds 167 of them across 285 rows.
 *
 * So links here are INFERRED and never stored. Nothing to migrate, nothing to go
 * stale, and no second source of truth to disagree with the dates. The cost is
 * that a guess can be wrong, which is why every consequence of a guess is shown
 * before it is applied — see `shiftPreview`.
 *
 * The rule is deliberately narrow:
 *
 *   B follows A when they are SIBLINGS, B comes straight after A in the plan,
 *   and B starts between the day A finishes and MAX_GAP days later.
 *
 * Same parent only, consecutive only. A wider rule — anything that starts after
 * anything else finishes — produces a graph where everything follows everything
 * and every row is critical, which says nothing at all.
 *
 * Pure: no database, no React. `scripts/verify-chains.ts` runs the real plan
 * through it.
 */

const MS_PER_DAY = 86_400_000;

/** A weekend plus a day. Beyond this the two jobs are not waiting on each other. */
export const MAX_GAP = 3;

export interface ChainNode {
  id: string;
  parentId: string | null;
  order: number;
  isLeaf: boolean;
  startDate: string | null;
  finishDate: string | null;
}

export interface Link {
  fromId: string;
  toId: string;
  /** Days between A finishing and B starting. 0 means the very next day. */
  gapDays: number;
}

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function days(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / MS_PER_DAY);
}
export function addDays(iso: string, n: number): string {
  return new Date(utc(iso) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

export function inferChains(nodes: ChainNode[]): Link[] {
  const byParent = new Map<string | null, ChainNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? null;
    const list = byParent.get(key);
    if (list) list.push(n);
    else byParent.set(key, [n]);
  }

  const links: Link[] = [];
  for (const siblings of byParent.values()) {
    const ordered = [...siblings].sort((a, b) => a.order - b.order);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (!a.finishDate || !b.startDate) continue;
      const gap = days(a.finishDate, b.startDate) - 1;
      if (gap < 0 || gap > MAX_GAP) continue;
      links.push({ fromId: a.id, toId: b.id, gapDays: gap });
    }
  }
  return links;
}

/* ------------------------------------------------------------- criticality */

export interface Float {
  /** Days this row could slip before the project's own finish moves. */
  totalFloat: number;
  isCritical: boolean;
}

/**
 * Critical path, on the inferred network.
 *
 * The dates in the plan ARE the early dates — this app does not schedule, it
 * records a schedule — so the forward pass is already done. What is computed
 * here is the backward pass: how late each row could finish without pushing the
 * project's own finish, and the float that falls out of it. Zero float is
 * critical.
 *
 * A row with no successors is only held by the project finish, which is exactly
 * right: the last job in a chain that ends in March has months of float against
 * a project that ends in December, and should not be drawn as critical.
 *
 * Summaries are excluded. A summary's dates are its children's, so it can have
 * no float of its own — it is critical exactly when one of its children is, and
 * saying so twice would double-paint the chart.
 */
export function computeFloat(nodes: ChainNode[], links: Link[]): Map<string, Float> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const successors = new Map<string, Link[]>();
  for (const l of links) {
    const list = successors.get(l.fromId);
    if (list) list.push(l);
    else successors.set(l.fromId, [l]);
  }

  const scheduled = nodes.filter((n) => n.isLeaf && n.startDate && n.finishDate);
  const projectFinish = scheduled.reduce<string | null>(
    (acc, n) => (!acc || n.finishDate! > acc ? n.finishDate! : acc),
    null
  );
  const out = new Map<string, Float>();
  if (!projectFinish) return out;

  // Backward pass, memoised. The graph is a forest of chains — same-parent,
  // consecutive-sibling links cannot cycle — so recursion terminates, and the
  // seen-set is belt and braces against a malformed input.
  const lateFinish = new Map<string, string>();
  const seen = new Set<string>();
  function lf(id: string): string {
    const cached = lateFinish.get(id);
    if (cached) return cached;
    if (seen.has(id)) return projectFinish!;
    seen.add(id);

    const outgoing = (successors.get(id) ?? []).filter((l) => {
      const s = byId.get(l.toId);
      return s?.isLeaf && s.startDate && s.finishDate;
    });
    let value = projectFinish!;
    for (const l of outgoing) {
      const succ = byId.get(l.toId)!;
      const succLateFinish = lf(succ.id);
      const duration = days(succ.startDate!, succ.finishDate!);
      // The successor's late start, minus the gap, minus one: the last day this
      // row may finish on without pushing it.
      const candidate = addDays(succLateFinish, -(duration + l.gapDays + 1));
      if (candidate < value) value = candidate;
    }
    lateFinish.set(id, value);
    return value;
  }

  for (const n of scheduled) {
    const late = lf(n.id);
    const float = days(n.finishDate!, late);
    out.set(n.id, { totalFloat: float, isCritical: float <= 0 });
  }
  return out;
}

/* ------------------------------------------------------------ shift preview */

export interface ShiftRow {
  id: string;
  name: string;
  fromStart: string;
  toStart: string;
  fromFinish: string;
  toFinish: string;
  days: number;
}

export interface ShiftPreview {
  /** The row the person actually edited, first in the list. */
  moved: ShiftRow[];
  /** Rows dragged along by the chain, in plan order. */
  followers: ShiftRow[];
  /**
   * The span of EVERYTHING — the moved row and every follower, before and
   * after. Only meaningful once the followers actually move; until then the
   * banner uses the moved row's own span, because naming a follower's weeks
   * would report a change nobody has agreed to.
   */
  fromDate: string | null;
  toDate: string | null;
}

/**
 * What else moves if this row moves.
 *
 * Follows the inferred chain forward and shifts every successor by the SAME
 * number of days, keeping each gap exactly as it was. It does not re-level, does
 * not compress, and never shortens anything: a plan revision that quietly
 * changed a duration while claiming to move a date would be the worst kind of
 * help.
 */
export function shiftPreview(
  nodes: ChainNode[],
  links: Link[],
  names: Map<string, string>,
  rowId: string,
  deltaDays: number
): ShiftPreview {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const successors = new Map<string, string[]>();
  for (const l of links) {
    const list = successors.get(l.fromId);
    if (list) list.push(l.toId);
    else successors.set(l.fromId, [l.toId]);
  }

  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const touched = new Set<string>();
  const queue = [rowId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of successors.get(id) ?? []) {
      if (touched.has(next)) continue;
      touched.add(next);
      queue.push(next);
    }
  }

  const row = (id: string): ShiftRow | null => {
    const n = byId.get(id);
    if (!n?.startDate) return null;
    const finish = n.finishDate ?? n.startDate;
    return {
      id,
      name: names.get(id) ?? id,
      fromStart: n.startDate,
      toStart: addDays(n.startDate, deltaDays),
      fromFinish: finish,
      toFinish: addDays(finish, deltaDays),
      days: deltaDays,
    };
  };

  const self = row(rowId);
  const followers = [...touched]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map(row)
    .filter((r): r is ShiftRow => r !== null);

  const all = [...(self ? [self] : []), ...followers];
  const dates = all.flatMap((r) => [r.fromStart, r.toStart, r.fromFinish, r.toFinish]);
  return {
    moved: self ? [self] : [],
    followers,
    fromDate: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
    toDate: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
  };
}

/* ------------------------------------------------------- the weeks it moves */

export interface WeekSpan {
  weekNo: number;
  startDate: string;
  endDate: string;
  status: 'open' | 'submitted' | 'approved';
}

/**
 * Which reporting weeks a change lands in, and which of those are already
 * signed for.
 *
 * The plan curve is DERIVED from the dates — that decision is what lets a
 * schedule revision be a date change instead of a trip back to Excel — and the
 * price of it is sharp: moving a date today changes the planned figure for a
 * week that was approved last month. The sheet never refuses the edit, because
 * a schedule that cannot be revised gets revised in Excel instead. It says which
 * weeks moved, and which of them had already been signed.
 */
export function weeksTouched(
  weeks: WeekSpan[],
  fromDate: string | null,
  toDate: string | null
): { all: WeekSpan[]; reported: WeekSpan[] } {
  if (!fromDate || !toDate) return { all: [], reported: [] };
  const lo = fromDate < toDate ? fromDate : toDate;
  const hi = fromDate < toDate ? toDate : fromDate;
  const all = weeks.filter((w) => w.endDate >= lo && w.startDate <= hi);
  return { all, reported: all.filter((w) => w.status !== 'open') };
}
