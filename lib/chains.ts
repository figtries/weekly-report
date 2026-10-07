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
 * Pure: no database, no React. It was proved against Gundih's 285-row plan by
 * a script removed with that project on 26 Sep 2026.
 */

import type { LinkType, StoredLink } from './links';

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

/* ---------------------------------------------------------------- network */

/**
 * The stored links, read against the TYPED plan (7 Oct 2026, spec
 * docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md).
 *
 * The plan's dates are not computed from the links: they are a promise
 * somebody typed. So no forward pass is run; each link is CHECKED. Its slack is
 * how far the waiting side sits past the bound the link sets: below zero is a
 * conflict, zero means the link is what sets that date.
 *
 * Only leaves carry links. A row with children has no dates of its own, and a
 * link on it would be a link to everything inside it.
 */
export interface NetNode {
  id: string;
  isLeaf: boolean;
  isMilestone: boolean;
  startDate: string | null;
  finishDate: string | null;
  /** This row's own `waits_for`: the links INTO it. Null = never asked. */
  links: StoredLink[] | null;
}

export interface LinkState {
  fromId: string;
  toId: string;
  type: LinkType;
  wait: number;
  /** Days the waiting side sits past `bound`; negative is a conflict. */
  slack: number;
  /** The earliest the waiting side (its start, or its finish for FF) may be. */
  bound: string;
}

export interface RowLogic {
  incoming: LinkState[];
  outgoing: LinkState[];
  /** Predecessors whose link has slack 0: they set this row's date. */
  setsDateBy: string[];
  conflicts: LinkState[];
  /** Linked, through what it holds up, to an activity that ends the project. */
  reachesFinish: boolean;
  /** Days it can slip before the project finish moves; null off the finish. */
  canSlip: number | null;
  setsProjectFinish: boolean;
  /** The latest it may finish without moving the project finish; null off it. */
  lateFinish: string | null;
}

export interface Network {
  rows: Map<string, RowLogic>;
  links: LinkState[];
  /** Links that close a loop. Ignored by everything, named by Check. */
  ignored: { fromId: string; toId: string }[];
  projectFinish: string | null;
}

type Dated = NetNode & { startDate: string; finishDate: string };

// Cached: the same few hundred dates are read thousands of times per pass,
// and a plan's dates are a bounded set.
const dayCache = new Map<string, number>();
const dayNo = (iso: string) => {
  let d = dayCache.get(iso);
  if (d === undefined) {
    d = Math.round(utc(iso) / MS_PER_DAY);
    dayCache.set(iso, d);
  }
  return d;
};
const isoOf = (day: number) => new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

function scheduled(n: NetNode | undefined): n is Dated {
  return Boolean(n && n.isLeaf && n.startDate && n.finishDate);
}

/** The bound a link sets on its waiting side, and that side's day. */
function measure(a: Dated, b: Dated, type: LinkType, wait: number): { bound: number; side: number } {
  if (type === 'SS') return { bound: dayNo(a.startDate) + wait, side: dayNo(b.startDate) };
  if (type === 'FF') return { bound: dayNo(a.finishDate) + wait, side: dayNo(b.finishDate) };
  // FS. A milestone is an event at the END of its date, so a milestone that
  // waits for A may sit on A's own finish day.
  return { bound: dayNo(a.finishDate) + (b.isMilestone ? 0 : 1) + wait, side: dayNo(b.startDate) };
}

interface Edge {
  from: string;
  to: string;
  type: LinkType;
  wait: number;
}

/** Links between scheduled leaves, minus the ones that close a loop. */
function liveLinks(nodes: NetNode[]): { live: Edge[]; ignored: { fromId: string; toId: string }[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const candidates: Edge[] = [];
  for (const b of nodes) {
    if (!scheduled(b)) continue;
    for (const l of b.links ?? []) {
      if (l.id === b.id || !scheduled(byId.get(l.id))) continue;
      candidates.push({ from: l.id, to: b.id, type: l.type, wait: l.wait });
    }
  }
  // One depth-first walk, in plan order then stored order: an edge back into
  // a row still on the walk's stack closes a loop and is set aside. O(V + E)
  // and deterministic; the planner reruns this on every date change.
  const out = new Map<string, Edge[]>();
  for (const c of candidates) {
    const list = out.get(c.from);
    if (list) list.push(c);
    else out.set(c.from, [c]);
  }
  const back = new Set<Edge>();
  const state = new Map<string, 1 | 2>(); // 1 on the stack, 2 finished
  for (const n of nodes) {
    if (state.has(n.id)) continue;
    const stack: { id: string; i: number }[] = [{ id: n.id, i: 0 }];
    state.set(n.id, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const edges = out.get(top.id) ?? [];
      if (top.i >= edges.length) {
        state.set(top.id, 2);
        stack.pop();
        continue;
      }
      const e = edges[top.i++];
      const s = state.get(e.to);
      if (s === 1) back.add(e);
      else if (s === undefined) {
        state.set(e.to, 1);
        stack.push({ id: e.to, i: 0 });
      }
    }
  }
  const live = candidates.filter((c) => !back.has(c));
  const ignored = candidates.filter((c) => back.has(c)).map((c) => ({ fromId: c.from, toId: c.to }));
  return { live, ignored };
}

export function analyseNetwork(nodes: NetNode[]): Network {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { live, ignored } = liveLinks(nodes);

  const rows = new Map<string, RowLogic>();
  for (const n of nodes) {
    if (!scheduled(n)) continue;
    rows.set(n.id, {
      incoming: [], outgoing: [], setsDateBy: [], conflicts: [],
      reachesFinish: false, canSlip: null, setsProjectFinish: false, lateFinish: null,
    });
  }

  const links: LinkState[] = live.map((c) => {
    const { bound, side } = measure(byId.get(c.from) as Dated, byId.get(c.to) as Dated, c.type, c.wait);
    return { fromId: c.from, toId: c.to, type: c.type, wait: c.wait, slack: side - bound, bound: isoOf(bound) };
  });
  for (const l of links) {
    rows.get(l.fromId)!.outgoing.push(l);
    const into = rows.get(l.toId)!;
    into.incoming.push(l);
    if (l.slack === 0) into.setsDateBy.push(l.fromId);
    if (l.slack < 0) into.conflicts.push(l);
  }

  let last: number | null = null;
  for (const id of rows.keys()) {
    const f = dayNo((byId.get(id) as Dated).finishDate);
    if (last === null || f > last) last = f;
  }

  // Backward pass over the links that lead to the finish. The live graph has
  // no loops, so the recursion ends.
  const reach = new Map<string, boolean>();
  const reachesFinish = (id: string): boolean => {
    const known = reach.get(id);
    if (known !== undefined) return known;
    const finishing = dayNo((byId.get(id) as Dated).finishDate) === last;
    const value = finishing || rows.get(id)!.outgoing.some((l) => reachesFinish(l.toId));
    reach.set(id, value);
    return value;
  };
  const lf = new Map<string, number>();
  const lateFinish = (id: string): number => {
    const known = lf.get(id);
    if (known !== undefined) return known;
    const n = byId.get(id) as Dated;
    const dur = dayNo(n.finishDate) - dayNo(n.startDate) + 1;
    let value = dayNo(n.finishDate) === last ? last! : Infinity;
    for (const l of rows.get(id)!.outgoing) {
      if (!reachesFinish(l.toId)) continue;
      const s = byId.get(l.toId) as Dated;
      const sLF = lateFinish(l.toId);
      const sLS = sLF - (dayNo(s.finishDate) - dayNo(s.startDate));
      const candidate =
        l.type === 'SS'
          ? sLS - l.wait + dur - 1
          : l.type === 'FF'
            ? sLF - l.wait
            : sLS - (s.isMilestone ? 0 : 1) - l.wait;
      if (candidate < value) value = candidate;
    }
    lf.set(id, value);
    return value;
  };

  for (const [id, row] of rows) {
    row.reachesFinish = reachesFinish(id);
    if (!row.reachesFinish) continue;
    const late = lateFinish(id);
    row.lateFinish = isoOf(late);
    row.canSlip = late - dayNo((byId.get(id) as Dated).finishDate);
    row.setsProjectFinish = row.canSlip <= 0;
  }

  return { rows, links, ignored, projectFinish: last === null ? null : isoOf(last) };
}

/**
 * Whether "toId waits for fromId" would close a loop, and the way round if so:
 * [fromId, toId, …, fromId]. A row waiting for itself is [id, id].
 */
export function wouldLoop(nodes: NetNode[], fromId: string, toId: string): string[] | null {
  if (fromId === toId) return [fromId, fromId];
  const next = new Map<string, string[]>();
  for (const e of liveLinks(nodes).live) {
    const list = next.get(e.from);
    if (list) list.push(e.to);
    else next.set(e.from, [e.to]);
  }
  // A way from toId back to fromId already exists? Then fromId → toId closes it.
  const prev = new Map<string, string>();
  const seen = new Set([toId]);
  const queue = [toId];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === fromId) {
      const path = [fromId];
      let cur = fromId;
      while (cur !== toId) {
        cur = prev.get(cur)!;
        path.unshift(cur);
      }
      return [fromId, ...path];
    }
    for (const n of next.get(id) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, id);
      queue.push(n);
    }
  }
  return null;
}

/**
 * What has to move LATER, and by how much, after the rows in `fromIds` moved.
 *
 * Walks forward from them over the live links; a follower whose links now
 * give it negative slack moves by exactly the largest overrun, keeps its
 * duration, and is walked from in turn. Never earlier: room a predecessor
 * gives back stays room.
 */
export function conflictMoves(nodes: NetNode[], fromIds: string[], names: Map<string, string>): ShiftRow[] {
  const work = new Map(nodes.map((n) => [n.id, { ...n }]));
  const { live } = liveLinks(nodes);
  const liveKey = new Set(live.map((e) => `${e.from}>${e.to}`));
  const out = new Map<string, string[]>();
  for (const e of live) {
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }
  const shift = new Map<string, number>();
  const queue = [...fromIds];
  for (let guard = 0; queue.length && guard < 100_000; guard += 1) {
    const id = queue.shift()!;
    for (const to of out.get(id) ?? []) {
      const b = work.get(to)!;
      if (!scheduled(b)) continue;
      let need = 0;
      for (const l of b.links ?? []) {
        const a = work.get(l.id);
        if (!scheduled(a) || !liveKey.has(`${l.id}>${to}`)) continue;
        const { bound, side } = measure(a, b, l.type, l.wait);
        need = Math.max(need, bound - side);
      }
      if (need <= 0) continue;
      b.startDate = addDays(b.startDate, need);
      b.finishDate = addDays(b.finishDate, need);
      shift.set(to, (shift.get(to) ?? 0) + need);
      queue.push(to);
    }
  }
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const original = new Map(nodes.map((n) => [n.id, n]));
  return [...shift.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([id, moved]) => {
      const n = original.get(id) as Dated;
      return {
        id,
        name: names.get(id) ?? id,
        fromStart: n.startDate,
        toStart: addDays(n.startDate, moved),
        fromFinish: n.finishDate,
        toFinish: addDays(n.finishDate, moved),
        days: moved,
      };
    });
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const short = (iso: string) => SHORT.format(new Date(utc(iso)));
const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** One sentence: why this row's date is what it is. Plain words only. */
export function whySentence(
  id: string,
  net: Network,
  nodes: Map<string, NetNode>,
  names: Map<string, string>
): { text: string; conflict: boolean } {
  const row = net.rows.get(id);
  const n = nodes.get(id);
  if (!row || !n?.startDate || !n.finishDate) return { text: 'Not scheduled yet.', conflict: false };
  if (!row.incoming.length) return { text: 'Not linked yet. Its dates are typed.', conflict: false };
  const tight = [...row.incoming].sort((a, b) => a.slack - b.slack)[0];
  const a = nodes.get(tight.fromId) as Dated;
  const name = names.get(tight.fromId) ?? tight.fromId;
  if (tight.slack < 0) {
    if (tight.type === 'FF') return { text: `Finishes ${short(n.finishDate)}, before ${name} finishes (${short(a.finishDate)}).`, conflict: true };
    if (tight.type === 'SS') return { text: `Starts ${short(n.startDate)}, before ${name} starts (${short(a.startDate)}).`, conflict: true };
    return { text: `Starts ${short(n.startDate)}, before ${name} finishes (${short(a.finishDate)}).`, conflict: true };
  }
  if (tight.slack > 0) {
    return tight.type === 'FF'
      ? { text: `Finishes ${short(n.finishDate)}; ${name} would allow ${short(tight.bound)}.`, conflict: false }
      : { text: `Starts ${short(n.startDate)}; ${name} would allow ${short(tight.bound)}.`, conflict: false };
  }
  if (tight.type === 'SS')
    return {
      text: tight.wait ? `Starts ${short(n.startDate)}, ${dayWord(tight.wait)} after ${name} starts.` : `Starts ${short(n.startDate)}, when ${name} starts.`,
      conflict: false,
    };
  if (tight.type === 'FF')
    return {
      text: tight.wait ? `Finishes ${short(n.finishDate)}, ${dayWord(tight.wait)} after ${name} finishes.` : `Finishes ${short(n.finishDate)}, when ${name} finishes.`,
      conflict: false,
    };
  return {
    text: tight.wait
      ? `Starts ${short(n.startDate)}, ${dayWord(tight.wait)} after ${name} finishes.`
      : `Starts ${short(n.startDate)} because ${name} finishes ${short(a.finishDate)}.`,
    conflict: false,
  };
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
  /** The rows to walk forward from when the offer is taken; the moved row when absent. */
  fromIds?: string[];
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
