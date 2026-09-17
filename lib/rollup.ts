import { resolveLeafProgress } from './progress';
import type { WbsItem, WeeklyLeafData } from './types';

export interface RollupNode extends WbsItem {
  children: RollupNode[];
  isLeaf: boolean;
  depth: number;
  prevProgressPct: number;
  prevWF: number;
  curProgressPct: number;
  curWF: number;
  thisWeekProgressPct: number;
  thisWeekWF: number;
  targetWF: number;
  variance: number;
}

function buildTree(items: WbsItem[]): RollupNode[] {
  const nodes = new Map<string, RollupNode>();
  items.forEach((item) => {
    nodes.set(item.id, {
      ...item,
      children: [],
      isLeaf: true,
      depth: 0,
      prevProgressPct: 0,
      prevWF: 0,
      curProgressPct: 0,
      curWF: 0,
      thisWeekProgressPct: 0,
      thisWeekWF: 0,
      targetWF: 0,
      variance: 0,
    });
  });

  const roots: RollupNode[] = [];
  nodes.forEach((node) => {
    if (node.parentId && nodes.has(node.parentId)) {
      const parent = nodes.get(node.parentId)!;
      parent.children.push(node);
      parent.isLeaf = false;
    } else {
      roots.push(node);
    }
  });

  const sortByOrder = (a: RollupNode, b: RollupNode) => a.order - b.order;
  const assignDepth = (node: RollupNode, depth: number) => {
    node.depth = depth;
    node.children.sort(sortByOrder);
    node.children.forEach((child) => assignDepth(child, depth + 1));
  };
  roots.sort(sortByOrder);
  roots.forEach((root) => assignDepth(root, 0));

  return roots;
}

/** Every leaf under this node, for the average that cannot use weight. */
function leavesUnder(node: RollupNode, out: RollupNode[] = []): RollupNode[] {
  if (node.children.length === 0) out.push(node);
  else node.children.forEach((c) => leavesUnder(c, out));
  return out;
}

/**
 * A branch's percentage.
 *
 * Normally its children's WEIGHTED average, which is all `wf / bobot` is. But a
 * heading whose whole subtree carries no weight divides zero by zero, and
 * printing 0.0% there says the work has not started when it may be finished:
 * KICKOFF AND SITE SURVEY sat at 0.0% above two rows both reading 100.0%
 * (17 Sep 2026). The bobot is what is zero there, not the progress.
 *
 * So with no weight to average by, every leaf under it counts the same — the
 * rule `deriveWeights` already falls back to on a plan with no prices at all.
 * LEAF DESCENDANTS rather than direct children, because a mean of means lets a
 * branch holding one leaf outvote a sibling holding ten.
 *
 * None of this can reach a report total. `curWF` is still `bobot × pct / 100`
 * and the bobot is zero, so the figure says what happened and adds nothing.
 */
function branchPct(node: RollupNode, wf: number, read: (n: RollupNode) => number): number {
  if (node.bobot > 0) return (wf / node.bobot) * 100;
  const leaves = leavesUnder(node);
  return leaves.length ? leaves.reduce((s, l) => s + read(l), 0) / leaves.length : 0;
}

export function computeRollup(
  items: WbsItem[],
  current: WeeklyLeafData,
  previous: WeeklyLeafData | null
): RollupNode[] {
  const roots = buildTree(items);

  const visit = (node: RollupNode) => {
    if (node.isLeaf) {
      const cur = current[node.id];
      const prev = previous?.[node.id];
      // resolveLeafProgress, not cumProgressPct: for quantity- and
      // milestone-based items the stored percent is only a cache, and reading
      // it here would let a stale cache outrank the evidence it was derived
      // from. Lumpsum items fall through to the stored value unchanged.
      node.curProgressPct = cur
        ? resolveLeafProgress(node, cur)
        : prev
          ? resolveLeafProgress(node, prev)
          : 0;
      node.prevProgressPct = prev ? resolveLeafProgress(node, prev) : 0;
      node.curWF = (node.bobot * node.curProgressPct) / 100;
      node.prevWF = (node.bobot * node.prevProgressPct) / 100;
      node.targetWF = cur?.targetWF ?? prev?.targetWF ?? 0;
    } else {
      node.children.forEach(visit);
      node.bobot = node.children.reduce((sum, c) => sum + c.bobot, 0);
      node.curWF = node.children.reduce((sum, c) => sum + c.curWF, 0);
      node.prevWF = node.children.reduce((sum, c) => sum + c.prevWF, 0);
      node.targetWF = node.children.reduce((sum, c) => sum + c.targetWF, 0);
      node.curProgressPct = branchPct(node, node.curWF, (n) => n.curProgressPct);
      node.prevProgressPct = branchPct(node, node.prevWF, (n) => n.prevProgressPct);
    }
    node.thisWeekWF = node.curWF - node.prevWF;
    node.thisWeekProgressPct = node.curProgressPct - node.prevProgressPct;
    node.variance = node.curWF - node.targetWF;
  };

  roots.forEach(visit);
  return roots;
}

/**
 * Hoist every "(SPK-###)" contract nested inside another contract's branch so
 * it sits beside its sibling contracts. In the source WBS tree SPK-007
 * (Overhaul Turbine, 1.4.4) lives under SPK-004 (1.4), but the report treats
 * them as separate contracts (see getSummaryRows) — the Data Overall and
 * Detail Progress trees should show them side by side too. Ancestors that
 * lose the branch are re-aggregated, so the grand total is unchanged.
 */
export function promoteNestedSpkContracts(roots: RollupNode[]): RollupNode[] {
  const SPK = /\(SPK-\d+\)/;
  const isSpk = (n: RollupNode) => SPK.test(n.deskripsi);

  // Collect moves first, then apply — mutating children arrays mid-walk would
  // skip nodes. `spkContainer` is the array where the nearest SPK ancestor
  // (after its own move, if any) ends up: that's where a nested SPK belongs.
  const moves: { node: RollupNode; parent: RollupNode; dest: RollupNode[] }[] = [];
  const walk = (
    node: RollupNode,
    parent: RollupNode | null,
    container: RollupNode[],
    spkContainer: RollupNode[] | null
  ) => {
    let finalContainer = container;
    if (parent && spkContainer && spkContainer !== container && isSpk(node)) {
      moves.push({ node, parent, dest: spkContainer });
      finalContainer = spkContainer;
    }
    const childSpkContainer = isSpk(node) ? finalContainer : spkContainer;
    node.children.forEach((c) => walk(c, node, node.children, childSpkContainer));
  };
  roots.forEach((r) => walk(r, null, roots, null));
  if (moves.length === 0) return roots;

  moves.forEach(({ node, parent, dest }) => {
    parent.children = parent.children.filter((c) => c !== node);
    dest.push(node);
    if (parent.children.length === 0) {
      // The branch was the parent's only content — collapse it to a
      // zero-weight milestone so the UIs hide it instead of showing stale sums.
      parent.isLeaf = true;
      parent.bobot = parent.curWF = parent.prevWF = parent.targetWF = 0;
      parent.curProgressPct = parent.prevProgressPct = 0;
      parent.thisWeekWF = parent.thisWeekProgressPct = parent.variance = 0;
    }
  });

  const refresh = (node: RollupNode, depth: number) => {
    node.depth = depth;
    node.children.sort((a, b) => a.order - b.order);
    node.children.forEach((c) => refresh(c, depth + 1));
    if (!node.isLeaf) {
      node.bobot = node.children.reduce((sum, c) => sum + c.bobot, 0);
      node.curWF = node.children.reduce((sum, c) => sum + c.curWF, 0);
      node.prevWF = node.children.reduce((sum, c) => sum + c.prevWF, 0);
      node.targetWF = node.children.reduce((sum, c) => sum + c.targetWF, 0);
      node.curProgressPct = branchPct(node, node.curWF, (n) => n.curProgressPct);
      node.prevProgressPct = branchPct(node, node.prevWF, (n) => n.prevProgressPct);
      node.thisWeekWF = node.curWF - node.prevWF;
      node.thisWeekProgressPct = node.curProgressPct - node.prevProgressPct;
      node.variance = node.curWF - node.targetWF;
    }
  };
  roots.sort((a, b) => a.order - b.order);
  roots.forEach((r) => refresh(r, 0));
  return roots;
}

export interface GrandTotal {
  bobot: number;
  prevProgressPct: number;
  prevWF: number;
  curProgressPct: number;
  curWF: number;
  thisWeekProgressPct: number;
  thisWeekWF: number;
  targetWF: number;
  variance: number;
}

export function computeGrandTotal(roots: RollupNode[]): GrandTotal {
  const bobot = roots.reduce((s, n) => s + n.bobot, 0);
  const curWF = roots.reduce((s, n) => s + n.curWF, 0);
  const prevWF = roots.reduce((s, n) => s + n.prevWF, 0);
  const targetWF = roots.reduce((s, n) => s + n.targetWF, 0);
  return {
    bobot,
    prevWF,
    curWF,
    prevProgressPct: bobot > 0 ? (prevWF / bobot) * 100 : 0,
    curProgressPct: bobot > 0 ? (curWF / bobot) * 100 : 0,
    thisWeekWF: curWF - prevWF,
    thisWeekProgressPct: bobot > 0 ? ((curWF - prevWF) / bobot) * 100 : 0,
    targetWF,
    variance: curWF - targetWF,
  };
}

export function flattenTree(roots: RollupNode[]): RollupNode[] {
  const out: RollupNode[] = [];
  const visit = (node: RollupNode) => {
    out.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

export function findNode(roots: RollupNode[], id: string): RollupNode | null {
  const flat = flattenTree(roots);
  return flat.find((n) => n.id === id) ?? null;
}

export interface SummaryRow {
  id: string;
  deskripsi: string;
  /**
   * The identifier to chip in front of the name, when the name does not already
   * carry one. Gundih's contracts are called "Pekerjaan … (SPK-002)" and the
   * screens pull that tag out of the description themselves (`splitCode`), so
   * this stays null there; a unit or a branch has no tag in its name and lends
   * its WBS code instead.
   */
  code: string | null;
  bobot: number;
  prevProgressPct: number;
  prevWF: number;
  thisWeekProgressPct: number;
  thisWeekWF: number;
  curProgressPct: number;
  curWF: number;
  targetWF: number;
  variance: number;
}

/**
 * What the summary ended up grouping by. The screens read it to title
 * themselves: "By contract" is a lie on a plan that has no contracts in it, and
 * a card that silently disappears instead reads as a broken screen.
 */
export type SummaryBasis = 'unit' | 'spk' | 'branch';

export interface SummaryUnits {
  basis: SummaryBasis;
  rows: SummaryRow[];
}

const SPK_TAG = /\(SPK-\d+\)/;

/** Where the group headers are, in the first of three ways the tree offers. */
function summaryAnchors(roots: RollupNode[]): {
  basis: SummaryBasis;
  anchorAt: (node: RollupNode) => { key: string; label: string; code: string | null } | null;
} {
  const flat = flattenTree(roots);

  // 1. What the plan MARKED. `isReportingUnit` is the first-class flag the
  //    planner's row menu writes; it beats the tag because it is a decision
  //    somebody made rather than a string an importer happened to produce.
  if (flat.some((n) => n.isReportingUnit)) {
    return {
      basis: 'unit',
      anchorAt: (n) =>
        n.isReportingUnit
          ? { key: n.id, label: n.deskripsi.trim(), code: n.wbsCode || null }
          : null,
    };
  }

  // 2. The "(SPK-###)" tag — Gundih, and every project that came out of the
  //    importer. Kept ahead of the structural fallback and unchanged, because
  //    its grouping is not the tree's: SPK-007 (Overhaul Turbine, WBS 1.4.4)
  //    sits inside SPK-004's 1.4 yet the signed report lists them separately.
  if (flat.some((n) => SPK_TAG.test(n.deskripsi))) {
    return {
      basis: 'spk',
      anchorAt: (n) => {
        const m = n.deskripsi.match(SPK_TAG);
        return m ? { key: m[0], label: n.deskripsi.trim(), code: null } : null;
      },
    };
  }

  // 3. Nothing marked and nothing tagged: fall back to the plan's own top
  //    level, so the breakdown still says where the percentage comes from.
  //    A SINGLE ROOT IS UNWRAPPED — the same rule the overall map follows,
  //    because Gundih-shaped plans hang everything under one top row and a
  //    breakdown of one row is not a breakdown.
  let level = roots;
  while (level.length === 1 && level[0].children.length > 0) level = level[0].children;
  const top = new Set(level.map((n) => n.id));
  return {
    basis: 'branch',
    anchorAt: (n) =>
      top.has(n.id) ? { key: n.id, label: n.deskripsi.trim(), code: n.wbsCode || null } : null,
  };
}

/**
 * The rows shown in "Overall Progress Summary" — one per contract on a project
 * that has contracts, matching the Excel Summary Overall sheet.
 *
 * Grouping is by ANCHOR, never by tree depth: `summaryAnchors` picks which
 * nodes are headers, and every leaf is credited to its nearest such ancestor.
 * An anchor nested inside another therefore subtracts itself out of the outer
 * one, which is what lets SPK-004 and SPK-007 both be reported in full without
 * the total reaching 114%.
 */
export function summariseUnits(roots: RollupNode[]): SummaryUnits {
  const { basis, anchorAt } = summaryAnchors(roots);
  interface Group {
    label: string;
    code: string | null;
    order: number;
    bobot: number;
    prevWF: number;
    curWF: number;
    thisWeekWF: number;
    targetWF: number;
  }
  const groups = new Map<string, Group>();
  let order = 0;

  const walk = (node: RollupNode, ctx: { key: string; label: string; code: string | null } | null) => {
    const cur = anchorAt(node) ?? ctx;
    if (node.children.length === 0) {
      if (cur && node.bobot > 0) {
        let g = groups.get(cur.key);
        if (!g) {
          g = { label: cur.label, code: cur.code, order: order++, bobot: 0, prevWF: 0, curWF: 0, thisWeekWF: 0, targetWF: 0 };
          groups.set(cur.key, g);
        }
        g.bobot += node.bobot;
        g.prevWF += node.prevWF;
        g.curWF += node.curWF;
        g.thisWeekWF += node.thisWeekWF;
        g.targetWF += node.targetWF;
      }
    } else {
      node.children.forEach((c) => walk(c, cur));
    }
  };
  roots.forEach((r) => walk(r, null));

  const rows = [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g, i) => ({
      id: `${basis === 'spk' ? 'spk' : basis}-${i}`,
      deskripsi: g.label,
      code: g.code,
      bobot: g.bobot,
      prevWF: g.prevWF,
      curWF: g.curWF,
      thisWeekWF: g.thisWeekWF,
      targetWF: g.targetWF,
      prevProgressPct: g.bobot > 0 ? (g.prevWF / g.bobot) * 100 : 0,
      thisWeekProgressPct: g.bobot > 0 ? (g.thisWeekWF / g.bobot) * 100 : 0,
      curProgressPct: g.bobot > 0 ? (g.curWF / g.bobot) * 100 : 0,
      variance: g.curWF - g.targetWF,
    }));

  return { basis, rows };
}

/** What every caller wanted before the basis mattered to anyone. */
export function getSummaryRows(roots: RollupNode[]): SummaryRow[] {
  return summariseUnits(roots).rows;
}

/** "By contract" is only true of a plan that has contracts in it. */
export function summaryTitle(basis: SummaryBasis): string {
  return basis === 'branch' ? 'By section' : 'By contract';
}
