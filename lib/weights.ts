/**
 * Money, and the weights that come out of it.
 *
 * `bobot = line value ÷ contract value × 100`. That is the rule the whole app
 * rests on: earned value, the S-curve, every reported percentage. It is written
 * here once, as pure functions over plain rows, so it can be tested without a
 * database and can never be half-implemented at a call site.
 *
 * Four things were learned by reading the Gundih data rather than assuming, and
 * each one is a trap this file exists to avoid.
 *
 * **A price is the value of a whole SUBTREE, not of one line.** 27 of Gundih's
 * 37 priced nodes are branches. Summing every price gives 16,917,276 against a
 * contract of 5,920,000 — it counts the same money three times over.
 *
 * **Value flows DOWN, and a priced child sits INSIDE its parent's figure.** A
 * node without a price takes a share of what is left of its parent after the
 * parent's priced children have taken theirs. With a `workstepFactor` the share
 * is that fraction (Gundih's 0.5 / 0.3 / 0.2 for IFR / IFA / AFC); without one
 * the unpriced siblings split the remainder evenly.
 *
 * **A total row restates the whole contract.** Gundih's `1.5 Finish` carries
 * 5,920,000 — the entire project — as its price. Counted as a line it doubles
 * every figure in the plan.
 *
 * **The contract value is the sum of the REPORTING UNITS, and units nest.**
 * SPK-007 sits at `1.4.4` inside SPK-004's `1.4` and is still its own contract:
 * 418,400 + 2,821,067.28 + 1,837,809 + 842,723.72 = 5,920,000.006405, which
 * matches the stored figure exactly.
 *
 * And one thing this file refuses to do. **Imported weights are authoritative
 * and are never silently recomputed.** Only 95 of Gundih's 176 stored leaf
 * weights can be re-derived from its prices; the other 81 are construction rows
 * whose weights came from a column of the workbook that the price tree does not
 * contain. Recomputing over them would replace 81 correct figures with wrong
 * ones and break a total that closes at exactly 100.000000. Recompute is
 * therefore an explicit act with a preview, never a side effect of typing a
 * price — see `previewWeights`.
 */

export interface WeightNode {
  id: string;
  parentId: string | null;
  /** Depth-first order, so children follow their parent. */
  order: number;
  price: number | null;
  workstepFactor: number | null;
  isReportingUnit: boolean;
  unitContractValue: number | null;
  bobot: number | null;
  isLeaf: boolean;
}

export interface WeightResult {
  contractValue: number;
  /** Derived money per node — the share of the contract this row represents. */
  valueOf: Map<string, number>;
  /** Derived percentage per LEAF, 0..100. */
  bobotOf: Map<string, number>;
  /** What the derived leaf weights add up to. 100 means the prices cover the plan. */
  total: number;
  /** Leaves the prices reach at all. */
  covered: number;
  leaves: number;
  /**
   * `boq` — every leaf is reached by a price and the total closes at 100.
   * `partial` — prices exist but do not cover the plan; a figure from these is
   *   real for what it covers and silent about the rest, and the report must
   *   say so rather than implying a whole.
   * `even` — no prices at all; every leaf counts the same. A rough number shown
   *   honestly beats a project that never gets set up.
   */
  basis: 'boq' | 'partial' | 'even';
}

const EPSILON = 0.01;

/**
 * The contract, in the project's own currency.
 *
 * Reporting units first, because that is what a contract actually is here — one
 * SPK per unit, and they nest. Without units, the top-most priced nodes; a node
 * whose ancestor is priced is already inside that ancestor's money.
 */
export function computeContractValue(nodes: WeightNode[]): number {
  const units = nodes.filter((n) => n.isReportingUnit && n.unitContractValue != null);
  if (units.length > 0) {
    return units.reduce((s, n) => s + (n.unitContractValue ?? 0), 0);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const priced = nodes.filter((n) => (n.price ?? 0) > 0);
  const totalRowGuess = priced.length ? Math.max(...priced.map((n) => n.price ?? 0)) : 0;

  let sum = 0;
  for (const n of priced) {
    // Inside a priced ancestor? Then this money is already counted above.
    let p = n.parentId;
    let nested = false;
    while (p) {
      const a = byId.get(p);
      if (!a) break;
      if ((a.price ?? 0) > 0) {
        nested = true;
        break;
      }
      p = a.parentId;
    }
    if (nested) continue;
    // A row carrying the largest figure alone, with siblings that add up to it,
    // is a total row rather than a line — see `1.5 Finish`.
    if (isTotalRow(n, priced, totalRowGuess)) continue;
    sum += n.price ?? 0;
  }
  return sum;
}

function isTotalRow(n: WeightNode, priced: WeightNode[], largest: number): boolean {
  if ((n.price ?? 0) < largest - EPSILON) return false;
  const others = priced
    .filter((o) => o.id !== n.id && o.parentId === n.parentId)
    .reduce((s, o) => s + (o.price ?? 0), 0);
  // Its siblings already account for most of it — it is restating them.
  return others > 0 && Math.abs(others - (n.price ?? 0)) < Math.max(EPSILON, (n.price ?? 0) * 0.35);
}

/**
 * Value down the tree, then weight out of it.
 *
 * Nothing here writes; the caller decides whether the result is worth applying.
 */
export function deriveWeights(nodes: WeightNode[], contractValue?: number): WeightResult {
  const contract = contractValue ?? computeContractValue(nodes);
  const valueOf = new Map<string, number>();
  const bobotOf = new Map<string, number>();

  const kids = new Map<string | null, WeightNode[]>();
  for (const n of [...nodes].sort((a, b) => a.order - b.order)) {
    const key = n.parentId ?? null;
    kids.set(key, [...(kids.get(key) ?? []), n]);
  }

  const priced = nodes.filter((n) => (n.price ?? 0) > 0);
  const largest = priced.length ? Math.max(...priced.map((n) => n.price ?? 0)) : 0;

  const walk = (node: WeightNode, parentValue: number | null) => {
    let value: number | null = null;

    if ((node.price ?? 0) > 0 && !isTotalRow(node, priced, largest)) {
      value = node.price ?? 0;
    } else if (parentValue != null) {
      const siblings = kids.get(node.parentId ?? null) ?? [];
      // A reporting-unit sibling is NOT taking money out of this parent — it
      // carries its own contract. Subtracting it here under-allocated the
      // parent by exactly that unit's value.
      const takenByPricedSiblings = siblings
        .filter((s) => (s.price ?? 0) > 0 && !s.isReportingUnit && !isTotalRow(s, priced, largest))
        .reduce((s, o) => s + (o.price ?? 0), 0);
      const remainder = Math.max(0, parentValue - takenByPricedSiblings);
      if (node.workstepFactor != null) {
        value = remainder * node.workstepFactor;
      } else {
        const unpriced = siblings.filter((s) => !((s.price ?? 0) > 0));
        value = unpriced.length ? remainder / unpriced.length : null;
      }
    }

    if (value != null) valueOf.set(node.id, value);
    for (const c of kids.get(node.id) ?? []) walk(c, value);
  };

  // Roots start from the contract when nothing above them is priced, so a plan
  // with no prices at all still spreads evenly instead of coming back empty.
  const roots = kids.get(null) ?? [];
  const anyPrice = priced.length > 0;
  for (const r of roots) walk(r, anyPrice ? null : contract);

  const leaves = nodes.filter((n) => n.isLeaf);
  let covered = 0;
  let total = 0;
  for (const leaf of leaves) {
    const v = valueOf.get(leaf.id);
    if (v == null || contract <= 0) continue;
    const b = (v / contract) * 100;
    bobotOf.set(leaf.id, b);
    total += b;
    covered += 1;
  }

  // No prices anywhere: every leaf counts the same, and the caller must label
  // the project as not value-based.
  let basis: WeightResult['basis'] = 'boq';
  if (!anyPrice) {
    basis = 'even';
    bobotOf.clear();
    total = 0;
    covered = 0;
    if (leaves.length > 0) {
      const each = 100 / leaves.length;
      for (const leaf of leaves) bobotOf.set(leaf.id, each);
      total = 100;
      covered = leaves.length;
    }
  } else if (covered < leaves.length || Math.abs(total - 100) > 0.5) {
    basis = 'partial';
  }

  return { contractValue: contract, valueOf, bobotOf, total, covered, leaves: leaves.length, basis };
}

export interface WeightChange {
  id: string;
  before: number | null;
  after: number | null;
}

/**
 * What recomputing WOULD do, without doing it.
 *
 * This is the whole safety mechanism. Gundih's 81 construction weights came from
 * the workbook rather than from its prices; applying a recompute there replaces
 * correct figures with wrong ones and breaks a total that closes at exactly 100.
 * The preview makes that visible before anyone can trigger it — the same rule
 * the schedule already follows: nothing moves until its effect has been shown.
 */
export function previewWeights(
  nodes: WeightNode[],
  signedValue?: number | null
): { result: WeightResult; changes: WeightChange[]; storedTotal: number } {
  // Weight is measured against the SIGNED contract when there is one. Against
  // the sum of whatever has been typed so far, it would close at 100 by
  // definition and could never reveal work that has no price on it yet.
  const result = deriveWeights(nodes, signedValue ?? undefined);
  const changes: WeightChange[] = [];
  let storedTotal = 0;

  for (const n of nodes) {
    if (!n.isLeaf) continue;
    storedTotal += n.bobot ?? 0;
    const after = result.bobotOf.get(n.id) ?? null;
    const before = n.bobot;
    const same =
      (before == null && after == null) ||
      (before != null && after != null && Math.abs(before - after) < 1e-6);
    if (!same) changes.push({ id: n.id, before, after });
  }

  return { result, changes, storedTotal };
}

/* ------------------------------------------------------- reading a project */

export interface WeightSummary {
  /**
   * The SIGNED figure, typed when the project was created. Authoritative.
   *
   * It used to be derived from the sum of the prices, and that was backwards:
   * a contract exists before a single WBS row does. Deriving it also deleted
   * the most useful check this app can make — the gap between what was signed
   * and what has been allocated — because the two were forced to be equal by
   * construction.
   */
  contractValue: number;
  /** What the prices entered so far actually add up to. */
  allocated: number;
  /** Signed minus allocated. Positive means work still has no price on it. */
  gap: number;
  /** Sum of the reporting units' own values, and whether it reconciles. */
  unitTotal: number;
  unitCount: number;
  currency: string;
  /** Where the contract figure came from, in words, because a number nobody can trace is a number nobody trusts. */
  source: string;
  basis: WeightResult['basis'];
  /** What the STORED weights add up to — the figure every report is built on. */
  storedTotal: number;
  storedLeaves: number;
  leaves: number;
  /** What deriving from prices would produce, and how many rows it would move. */
  derivedTotal: number;
  derivedCovers: number;
  wouldChange: number;
  pricedRows: number;
}

export function summariseWeights(
  nodes: WeightNode[],
  currency: string,
  /** The signed contract value. Null means nobody has typed one yet. */
  signedValue: number | null
): WeightSummary {
  const { result, changes, storedTotal } = previewWeights(nodes, signedValue);
  const units = nodes.filter((n) => n.isReportingUnit);
  const unitTotal = units.reduce((s, n) => s + (n.unitContractValue ?? 0), 0);
  const priced = nodes.filter((n) => (n.price ?? 0) > 0);

  // What the prices actually add up to: the top-most priced rows, since a
  // priced child sits inside its parent's figure rather than beside it.
  const allocated = topLevelPricedTotal(nodes);
  const contract = signedValue ?? allocated;

  return {
    contractValue: contract,
    allocated,
    gap: contract - allocated,
    unitTotal,
    unitCount: units.length,
    currency,
    source:
      signedValue != null
        ? 'the signed contract'
        : priced.length > 0
          ? 'the priced rows — nothing signed has been entered'
          : 'nothing entered yet',
    basis: result.basis,
    storedTotal,
    storedLeaves: nodes.filter((n) => n.isLeaf && n.bobot != null).length,
    leaves: result.leaves,
    derivedTotal: result.total,
    derivedCovers: result.covered,
    wouldChange: changes.length,
    pricedRows: priced.length,
  };
}

/**
 * What the prices add up to, without counting the same money twice.
 *
 * Only the TOP-MOST priced rows count: a priced child sits inside its parent's
 * figure. Summing every price on Gundih gives 16,917,276 against a contract of
 * 5,920,000 — the same money three times over. Total rows, which restate the
 * whole contract on one line, are excluded for the same reason.
 */
export function topLevelPricedTotal(nodes: WeightNode[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const priced = nodes.filter((n) => (n.price ?? 0) > 0);
  const largest = priced.length ? Math.max(...priced.map((n) => n.price ?? 0)) : 0;

  let sum = 0;
  for (const n of priced) {
    if (isTotalRow(n, priced, largest)) continue;
    // A REPORTING UNIT IS ITS OWN CONTRACT, even when it sits inside another
    // one. SPK-007 lives at 1.4.4 inside SPK-004's 1.4, and 1.4's own price
    // does NOT include it: 418,400 + 2,821,067.28 + 1,837,809 = 5,077,276, and
    // only adding SPK-007's 842,723.72 reaches the signed 5,920,000.006405.
    // Treating it as nested lost exactly that figure.
    if (n.isReportingUnit) {
      sum += n.price ?? 0;
      continue;
    }
    let p = n.parentId;
    let inside = false;
    while (p) {
      const a = byId.get(p);
      if (!a) break;
      if ((a.price ?? 0) > 0) {
        inside = true;
        break;
      }
      p = a.parentId;
    }
    if (!inside) sum += n.price ?? 0;
  }
  return sum;
}
