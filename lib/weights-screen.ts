/**
 * The shape the Weights screen needs, built out of the derivation that already
 * exists.
 *
 * `lib/weights.ts` answers "what is every leaf worth". This answers the two
 * questions the SCREEN asks on top of that, and neither of them is a new
 * formula — both are re-readings of the same result.
 *
 * **Which SPK does this row belong to, and what is it worth INSIDE it.** The
 * source workbook carries `WF per SPK` and `WF Overall` as two separate
 * columns because they are two separate questions, and anyone holding a
 * per-SPK report next to an overall one has to be able to reconcile the two.
 * Showing only the overall figure is what makes people think the reports
 * disagree.
 *
 * **Where did this row's weight come from.** Not a boolean, because there are
 * three answers and calling them two would put a false label on screen.
 * `WeightResult.fromGap` cannot be used for this: it is a COUNT, and it counts
 * only the leaves reached by splitting the CONTRACT's leftover — not the far
 * more common case of a leaf under a priced SPK that simply has no price of
 * its own. And a leaf carrying a `workstepFactor` (Gundih's 0.5 / 0.3 / 0.2 on
 * IFR / IFA / AFC) takes a STATED fraction of its parent, not an even share;
 * labelling that "even share" would tell someone their figure was a guess when
 * it was the one thing on the row that was decided deliberately.
 *
 * Pure over plain rows, like `lib/weights.ts`, so `scripts/verify-weights-
 * screen.ts` can exercise every one of those states without a database.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { deriveWeights, summariseWeights, type WeightNode, type WeightSummary } from './weights';
import { loadWeightNodes } from './weights-read';

/** Where a row's weight came from. Drives the label, so it must not overstate. */
export type WeightShare =
  /** Priced. The figure is this row's own money. */
  | 'price'
  /** No price, but a stated fraction of its parent. Deliberate, not a guess. */
  | 'factor'
  /** No price and no fraction: an even share of what was left. */
  | 'even';

export interface WeightsRow {
  id: string;
  code: string;
  name: string;
  /** Depth relative to the card it sits under, so indentation starts at zero. */
  depth: number;
  isLeaf: boolean;
  price: number | null;
  /** Percent of the whole project. */
  bobotOverall: number;
  /** Percent within this row's own reporting unit. */
  bobotInUnit: number;
  share: WeightShare;
}

export interface WeightsUnit {
  id: string;
  code: string;
  name: string;
  /** The unit's own contract figure, falling back to its price. */
  unitValue: number | null;
  bobotOverall: number;
  pricedRows: number;
  totalRows: number;
  rows: WeightsRow[];
}

export interface WeightsScreen {
  summary: WeightSummary;
  units: WeightsUnit[];
  /**
   * False where nobody has marked an SPK yet. The WBS roots stand in as the
   * cards instead — a plan with no units still has weights, and hiding the
   * whole screen behind a step most people have never heard of would make the
   * one screen that can fix an unweighted project unreachable from it.
   */
  hasUnits: boolean;
}

export function buildWeightsScreen(
  nodes: WeightNode[],
  meta: Map<string, { code: string; name: string }>,
  currency: string,
  signedValue: number | null
): WeightsScreen {
  const summary = summariseWeights(nodes, currency, signedValue);
  const result = deriveWeights(nodes, signedValue ?? undefined);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const ancestors = (n: WeightNode): WeightNode[] => {
    const out: WeightNode[] = [];
    let cur = n.parentId ? byId.get(n.parentId) : undefined;
    // Guarded against a cycle a bad import could leave behind: a parent chain
    // that loops would hang the render rather than fail it.
    while (cur && out.length < nodes.length) {
      out.push(cur);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  };

  const depthOf = (n: WeightNode) => ancestors(n).length;

  /** The nearest ancestor-or-self that is a reporting unit. */
  const unitOf = (n: WeightNode): WeightNode | null =>
    n.isReportingUnit ? n : (ancestors(n).find((a) => a.isReportingUnit) ?? null);

  const rootOf = (n: WeightNode): WeightNode => ancestors(n).at(-1) ?? n;

  const shareOf = (n: WeightNode): WeightShare => {
    if ((n.price ?? 0) > 0) return 'price';
    if (n.workstepFactor != null) return 'factor';
    return 'even';
  };

  const unitNodes = nodes.filter((n) => n.isReportingUnit);
  const hasUnits = unitNodes.length > 0;
  const anchors = hasUnits ? unitNodes : nodes.filter((n) => n.parentId == null);

  // A leaf's weight is read straight off the derivation. A branch carries no
  // weight of its own — its figure is its leaves added up — so subtree sums are
  // accumulated in one pass rather than by walking the tree once per branch,
  // which on Gundih's 285 rows would be a walk per row.
  const subtree = new Map<string, number>();
  for (const leaf of nodes) {
    if (!leaf.isLeaf) continue;
    const b = result.bobotOf.get(leaf.id) ?? 0;
    subtree.set(leaf.id, b);
    for (const a of ancestors(leaf)) subtree.set(a.id, (subtree.get(a.id) ?? 0) + b);
  }

  const units: WeightsUnit[] = anchors.map((anchor) => {
    const members = nodes.filter((n) => {
      if (n.id === anchor.id) return false;
      const owner = hasUnits ? unitOf(n) : rootOf(n);
      return owner?.id === anchor.id;
    });

    // The unit's own figure EXCLUDES any unit nested inside it. SPK-007 sits at
    // 1.4.4 inside SPK-004's 1.4 and is still its own contract; counting it in
    // both is how a project total reaches 114%.
    const leafTotal = members
      .filter((n) => n.isLeaf)
      .reduce((s, n) => s + (result.bobotOf.get(n.id) ?? 0), 0);

    const anchorDepth = depthOf(anchor);
    const rows: WeightsRow[] = [...members]
      .sort((a, b) => a.order - b.order)
      .map((n) => {
        const overall = n.isLeaf ? (result.bobotOf.get(n.id) ?? 0) : (subtree.get(n.id) ?? 0);
        return {
          id: n.id,
          code: meta.get(n.id)?.code ?? '',
          name: meta.get(n.id)?.name ?? '',
          depth: Math.max(0, depthOf(n) - anchorDepth - 1),
          isLeaf: n.isLeaf,
          price: n.price,
          bobotOverall: overall,
          // Guarded: a unit whose leaves all weigh zero must show 0, not NaN.
          bobotInUnit: leafTotal > 0 ? (overall / leafTotal) * 100 : 0,
          share: shareOf(n),
        };
      });

    return {
      id: anchor.id,
      code: meta.get(anchor.id)?.code ?? '',
      name: meta.get(anchor.id)?.name ?? '',
      unitValue: anchor.unitContractValue ?? anchor.price,
      bobotOverall: leafTotal,
      pricedRows: members.filter((n) => (n.price ?? 0) > 0).length,
      totalRows: members.length,
      rows,
    };
  });

  return { summary, units, hasUnits };
}

export function loadWeightsScreen(projectId: string): WeightsScreen | null {
  const project = db
    .select({ currency: schema.projects.currency, contractValue: schema.projects.contractValue })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project) return null;

  const nodes = loadWeightNodes(projectId);
  const meta = new Map(
    db
      .select({
        id: schema.wbsNodes.id,
        code: schema.wbsNodes.wbsCode,
        name: schema.wbsNodes.deskripsi,
      })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, projectId))
      .all()
      .map((r) => [r.id, { code: r.code, name: r.name }] as const)
  );

  return buildWeightsScreen(nodes, meta, project.currency, project.contractValue);
}
