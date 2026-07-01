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
      node.curProgressPct = cur?.cumProgressPct ?? prev?.cumProgressPct ?? 0;
      node.prevProgressPct = prev?.cumProgressPct ?? 0;
      node.curWF = (node.bobot * node.curProgressPct) / 100;
      node.prevWF = (node.bobot * node.prevProgressPct) / 100;
      node.targetWF = cur?.targetWF ?? prev?.targetWF ?? 0;
    } else {
      node.children.forEach(visit);
      node.bobot = node.children.reduce((sum, c) => sum + c.bobot, 0);
      node.curWF = node.children.reduce((sum, c) => sum + c.curWF, 0);
      node.prevWF = node.children.reduce((sum, c) => sum + c.prevWF, 0);
      node.targetWF = node.children.reduce((sum, c) => sum + c.targetWF, 0);
      node.curProgressPct = node.bobot > 0 ? (node.curWF / node.bobot) * 100 : 0;
      node.prevProgressPct = node.bobot > 0 ? (node.prevWF / node.bobot) * 100 : 0;
    }
    node.thisWeekWF = node.curWF - node.prevWF;
    node.thisWeekProgressPct = node.curProgressPct - node.prevProgressPct;
    node.variance = node.curWF - node.targetWF;
  };

  roots.forEach(visit);
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
 * The rows shown in "Overall Progress Summary" — one per SPK contract, matching
 * the Excel Summary Overall sheet.
 *
 * Grouping is by contract, NOT by tree depth: each group header carries its
 * "(SPK-###)" tag in its description, and every leaf belongs to its nearest such
 * ancestor. This matters because SPK-007 (Overhaul Turbine, WBS 1.4.4) is nested
 * under SPK-004 (WBS 1.4) in the tree, yet the report lists them as two separate
 * contracts — SPK-004 = the 1.4 branch excluding 1.4.4, SPK-007 = 1.4.4.
 */
export function getSummaryRows(roots: RollupNode[]): SummaryRow[] {
  const SPK = /\(SPK-\d+\)/;
  interface Group {
    label: string;
    order: number;
    bobot: number;
    prevWF: number;
    curWF: number;
    thisWeekWF: number;
    targetWF: number;
  }
  const groups = new Map<string, Group>();
  let order = 0;

  const walk = (node: RollupNode, ctx: { key: string; label: string } | null) => {
    const m = node.deskripsi.match(SPK);
    const cur = m ? { key: m[0], label: node.deskripsi.trim() } : ctx;
    if (node.children.length === 0) {
      if (cur && node.bobot > 0) {
        let g = groups.get(cur.key);
        if (!g) {
          g = { label: cur.label, order: order++, bobot: 0, prevWF: 0, curWF: 0, thisWeekWF: 0, targetWF: 0 };
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

  return [...groups.values()]
    .sort((a, b) => a.order - b.order)
    .map((g, i) => ({
      id: `spk-${i}`,
      deskripsi: g.label,
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
}
