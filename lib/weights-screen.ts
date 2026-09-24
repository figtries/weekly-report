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
 * **Where did this row's weight come from.** Its own price, a fraction stored
 * against its parent (Gundih's 0.5 / 0.3 / 0.2 on IFR / IFA / AFC, read as
 * money and never written any more), or nothing at all, in which case it
 * weighs 0 and the screen lists it. There is no fourth answer since the even
 * share went (24 Sep 2026).
 *
 * Pure over plain rows, like `lib/weights.ts`, so `scripts/verify-weights-
 * screen.ts` can exercise every one of those states without a database.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import type { ProgressMethod } from './schema';
import {
  allocationOf,
  deriveWeights,
  summariseWeights,
  type Allocation,
  type WeightNode,
  type WeightSummary,
} from './weights';
import { getActiveBaselineId } from './sheet';
import { loadWeightNodes } from './weights-read';

/** Where a row's weight came from. Drives the label, so it must not overstate. */
export type WeightShare =
  /** Priced. The figure is this row's own money. */
  | 'price'
  /** No price, but a fraction of its parent stored before budgets were money only. */
  | 'factor'
  /** Nothing gives it a budget, so it weighs 0. */
  | 'none';

export interface WeightsRow {
  id: string;
  code: string;
  name: string;
  /** Depth relative to the card it sits under, so indentation starts at zero. */
  depth: number;
  /** The row this one sits inside, for asking what a percent here is a percent of. */
  parentId: string | null;
  isLeaf: boolean;
  price: number | null;
  /**
   * The budget this row holds OF ITS OWN: its price, or a stored fraction of
   * its parent read as money. Null where it holds none; a heading without one
   * is still worth what its rows add up to, which is `value`.
   */
  budget: number | null;
  /** What this row is worth once the derivation has run, in project currency. */
  value: number;
  /** Percent of the whole project. */
  bobotOverall: number;
  /** Percent within this row's own reporting unit. */
  bobotInUnit: number;
  share: WeightShare;

  /**
   * The schedule, read only, shown because the Excel sheet this replaces keeps
   * Duration / Start / Finish in the columns right beside Price — and for a
   * reason. Price decides how much a row COUNTS; the dates decide WHEN, and the
   * weekly plan curve is `DATA PLAN = plan% × WF`. A screen that shows the
   * price half alone looks like it is doing a third of the job, which is
   * exactly how the first cut of this screen read.
   */
  start: string | null;
  finish: string | null;
  durationDays: number | null;

  /** How this row's percentage gets decided every week. */
  method: ProgressMethod;
  /** For `qty`: the total to count against, and what it is counted in. */
  qtyTotal: number | null;
  qtyUnit: string | null;
  /** For `milestone`: how many steps it has. */
  steps: number;
  /**
   * True where the percentage is TYPED rather than measured. Not a warning for
   * its own sake: the workbook this replaces has 176 rows of hand-typed
   * cumulative percent seeded from the plan, and reproducing that quietly is
   * the one failure this screen exists to prevent.
   */
  estimated: boolean;
}

export interface WeightsUnit {
  id: string;
  code: string;
  name: string;
  /** The unit's own contract figure, falling back to its price. */
  unitValue: number | null;
  /**
   * What this heading has to give out, and what the rows directly under it
   * have already claimed. Absent where nothing above the heading says what it
   * is worth, which is a different sentence from "it is over by 40%" and has
   * to stay tellable apart on the card.
   */
  allocation: Allocation | null;
  /**
   * What every row in this card is worth, added up.
   *
   * The card used to print `unitContractValue ?? price`, which is the heading
   * ROW's own money and nothing else. Six rows could carry a full set of
   * prices under a heading nobody had priced, and the card would say "no value
   * yet" while the percent beside it read 69.72 — a card disagreeing with its
   * own number in the same breath. This is the figure that was missing: the
   * derivation's own money for the rows the card holds.
   */
  derivedValue: number;
  bobotOverall: number;
  /**
   * Activities in this card that a budget reaches, out of all of them.
   *
   * Counted over LEAVES, not rows: a heading is set when its activities are,
   * and "2 of 2 rows set" on a card whose two headings held nothing beneath
   * them said the job was done when none of it was.
   */
  budgetedLeaves: number;
  leafCount: number;
  rows: WeightsRow[];
}

export interface WeightsScreen {
  summary: WeightSummary;
  /**
   * The cards. A card is always a BRANCH, or a reporting unit.
   *
   * Never a leaf. Building cards out of the top-level rows and then filling
   * each with its descendants gave a flat plan thirteen cards reading 0.00% and
   * "0 of 0 rows priced", because a leaf has no descendants and so every card
   * excluded the only row it was about. It is the same trap `assignColorGroups`
   * fell into when it took the top rows as packages without checking they were
   * branches.
   */
  units: WeightsUnit[];
  /**
   * Rows that no card contains: top-level leaves, and anything outside every
   * reporting unit. They are shown and priced on the first screen. Without
   * them a flat plan has nowhere at all to type a price.
   */
  looseRows: WeightsRow[];
  /**
   * The rows the derivation ran over, carried through so the screen can run it
   * AGAIN on the client while someone is typing a price.
   *
   * `lib/weights.ts` imports nothing at all, so the browser calls the very same
   * `deriveWeights` the server did. That is the point of shipping these: a
   * second, approximate formula written for the live preview would eventually
   * disagree with the one the report is built on, and the person typing would
   * be the last to find out.
   */
  nodes: WeightNode[];
  /**
   * False where nobody has marked an SPK yet. The WBS roots stand in as the
   * cards instead — a plan with no units still has weights, and hiding the
   * whole screen behind a step most people have never heard of would make the
   * one screen that can fix an unweighted project unreachable from it.
   */
  hasUnits: boolean;
  /**
   * `projects.weight_basis === 'boq'` — the REAL lock, read from the project.
   *
   * The screen used to ask `summary.basis`, which is the DERIVED basis and a
   * different question: whether deriving from the prices would produce a
   * clean value-based result. Gundih is locked in the database and derives
   * to 'partial', so the one project in here whose weights are authoritative
   * was the one being offered a button to overwrite them.
   */
  locked: boolean;
}

/**
 * Everything about a row that is NOT money.
 *
 * Kept as a lookup passed in rather than read inside, so `buildWeightsScreen`
 * stays pure over plain rows and `scripts/verify-weights-screen.ts` can drive
 * it without a database. An absent entry is a row with no schedule and no
 * method set, which is what a freshly pasted plan looks like.
 */
export interface RowFacts {
  code: string;
  name: string;
  start?: string | null;
  finish?: string | null;
  durationDays?: number | null;
  method?: ProgressMethod | null;
  qtyTotal?: number | null;
  qtyUnit?: string | null;
  steps?: number;
}

export function buildWeightsScreen(
  nodes: WeightNode[],
  meta: Map<string, RowFacts>,
  currency: string,
  signedValue: number | null,
  /** `projects.weight_basis === 'boq'`. Defaults to unlocked, which is what a plan built in the app is. */
  locked = false
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
    if (!result.budgetOf.has(n.id)) return 'none';
    return (n.price ?? 0) > 0 ? 'price' : 'factor';
  };

  const unitNodes = nodes.filter((n) => n.isReportingUnit);
  const hasUnits = unitNodes.length > 0;
  // A CARD IS A BRANCH. Where SPK are marked they are the cards, because a
  // unit earns its own section in the report whatever its shape. Where none
  // are, the top-level BRANCHES stand in and top-level leaves fall through to
  // `looseRows` instead of becoming cards about nothing.
  const anchors = hasUnits ? unitNodes : nodes.filter((n) => n.parentId == null && !n.isLeaf);
  const anchorIds = new Set(anchors.map((a) => a.id));

  /** Which card holds this row, or null when no card does. */
  const cardOf = (n: WeightNode): string | null => {
    const owner = hasUnits ? unitOf(n) : rootOf(n);
    return owner && owner.id !== n.id && anchorIds.has(owner.id) ? owner.id : null;
  };

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

  /**
   * Turn a set of rows into screen rows, measured against `against`.
   *
   * `against` is the denominator for the in-unit column: a card's own leaf
   * total, so its rows close at 100 within it. For rows no card holds it is the
   * project, where in-unit and overall are the same question.
   */
  const toRows = (members: WeightNode[], baseDepth: number, against: number): WeightsRow[] =>
    [...members]
      .sort((a, b) => a.order - b.order)
      .map((n) => {
        const overall = n.isLeaf ? (result.bobotOf.get(n.id) ?? 0) : (subtree.get(n.id) ?? 0);
        const f = meta.get(n.id);
        // `methodOf`'s rule, not a second one: an unset method IS lumpsum.
        const method: ProgressMethod = f?.method ?? 'lumpsum';
        return {
          id: n.id,
          code: f?.code ?? '',
          name: f?.name ?? '',
          depth: Math.max(0, depthOf(n) - baseDepth),
          parentId: n.parentId ?? null,
          isLeaf: n.isLeaf,
          price: n.price,
          budget: result.budgetOf.get(n.id) ?? null,
          value: result.valueOf.get(n.id) ?? 0,
          bobotOverall: overall,
          // Guarded: a card whose leaves all weigh zero must show 0, not NaN.
          bobotInUnit: against > 0 ? (overall / against) * 100 : 0,
          share: shareOf(n),
          start: f?.start ?? null,
          finish: f?.finish ?? null,
          durationDays: f?.durationDays ?? null,
          method,
          qtyTotal: f?.qtyTotal ?? null,
          qtyUnit: f?.qtyUnit ?? null,
          steps: f?.steps ?? 0,
          // Only a LEAF can be estimated: a branch has no percentage of its
          // own, its figure is its children added up.
          estimated: n.isLeaf && method === 'lumpsum',
        };
      });

  const alloc = allocationOf(result);

  const units: WeightsUnit[] = anchors.map((anchor) => {
    const members = nodes.filter((n) => cardOf(n) === anchor.id);

    // The unit's own figure EXCLUDES any unit nested inside it. SPK-007 sits at
    // 1.4.4 inside SPK-004's 1.4 and is still its own contract; counting it in
    // both is how a project total reaches 114%.
    const leafTotal = members
      .filter((n) => n.isLeaf)
      .reduce((s, n) => s + (result.bobotOf.get(n.id) ?? 0), 0);

    // What the card's rows are worth, from the derivation rather than from
    // the heading row's own price. Same subtraction as `leafTotal`: a nested
    // unit's leaves belong to that unit's card, not to this one.
    const derivedValue = members
      .filter((n) => n.isLeaf)
      .reduce((s, n) => s + (result.valueOf.get(n.id) ?? 0), 0);

    return {
      id: anchor.id,
      code: meta.get(anchor.id)?.code ?? '',
      name: meta.get(anchor.id)?.name ?? '',
      unitValue: anchor.unitContractValue ?? anchor.price,
      allocation: alloc.get(anchor.id) ?? null,
      derivedValue,
      bobotOverall: leafTotal,
      budgetedLeaves: members.filter((n) => n.isLeaf && (result.valueOf.get(n.id) ?? 0) > 0).length,
      leafCount: members.filter((n) => n.isLeaf && result.bobotOf.has(n.id)).length,
      rows: toRows(members, depthOf(anchor) + 1, leafTotal),
    };
  });

  // Everything no card holds. On a flat plan this is the whole project, and it
  // is the only place a price can be typed; on Gundih it is empty.
  const loose = nodes.filter((n) => !anchorIds.has(n.id) && cardOf(n) === null);
  const looseTotal = loose
    .filter((n) => n.isLeaf)
    .reduce((s, n) => s + (result.bobotOf.get(n.id) ?? 0), 0);

  return {
    summary,
    units,
    looseRows: toRows(loose, 0, looseTotal),
    hasUnits,
    nodes,
    locked,
  };
}

export function loadWeightsScreen(projectId: string): WeightsScreen | null {
  const project = db
    .select({
      currency: schema.projects.currency,
      contractValue: schema.projects.contractValue,
      weightBasis: schema.projects.weightBasis,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project) return null;

  const nodes = loadWeightNodes(projectId);

  const rows = db
    .select({
      id: schema.wbsNodes.id,
      code: schema.wbsNodes.wbsCode,
      name: schema.wbsNodes.deskripsi,
      method: schema.wbsNodes.progressMethod,
      qtyTotal: schema.wbsNodes.vol,
      qtyUnit: schema.wbsNodes.satuan,
    })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .all();

  // The dates come from the ACTIVE baseline, the same one the planner and the
  // plan curve read. A project with no baseline yet simply has no dates to
  // show, which is a true thing to say about it.
  const baselineId = getActiveBaselineId(projectId);
  const sched = new Map(
    (baselineId
      ? db
          .select()
          .from(schema.nodeSchedules)
          .where(eq(schema.nodeSchedules.baselineId, baselineId))
          .all()
      : []
    ).map((s) => [s.nodeId, s] as const)
  );

  const stepCount = new Map<string, number>();
  for (const m of db.select({ nodeId: schema.milestones.nodeId }).from(schema.milestones).all()) {
    stepCount.set(m.nodeId, (stepCount.get(m.nodeId) ?? 0) + 1);
  }

  const meta = new Map<string, RowFacts>(
    rows.map((r) => {
      const s = sched.get(r.id);
      return [
        r.id,
        {
          code: r.code,
          name: r.name,
          start: s?.startDate ?? null,
          finish: s?.finishDate ?? null,
          durationDays: s?.durationDays ?? null,
          method: r.method,
          qtyTotal: r.qtyTotal,
          qtyUnit: r.qtyUnit,
          steps: stepCount.get(r.id) ?? 0,
        },
      ] as const;
    })
  );

  return buildWeightsScreen(
    nodes,
    meta,
    project.currency,
    project.contractValue,
    project.weightBasis === 'boq'
  );
}
