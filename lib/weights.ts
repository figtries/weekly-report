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
  /**
   * How many leaves were weighted by splitting the unpriced remainder of the
   * contract rather than by a price of their own. Above zero, the figure is
   * real for what it covers and an even guess for the rest — and the screen
   * has to say so.
   */
  fromGap: number;
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
        // A STATED PERCENT IS A PERCENT OF THE PARENT'S BUDGET, not of what is
        // left of it. "30% of Engineering" has to mean the same thing whoever
        // else has been priced, or the box someone typed into changes meaning
        // behind their back when a sibling gets a price: measured against the
        // remainder, three rows reading 50 / 30 / 20 stop adding up to their
        // heading the moment a fourth row is given one.
        //
        // NOT A CHANGE OF FIGURES ON GUNDIH, and that is checked rather than
        // assumed. No factor row there has a genuinely priced sibling: 1.4's
        // priced child is the nested reporting unit 1.4.4, already excluded
        // above because it carries its own contract, and 1.4.2.2 and 1.4.3.1
        // hold a price AND a factor, where the price wins before this branch
        // is reached. `remainder` equalled `parentValue` everywhere it was
        // actually used, so both readings give the same number.
        value = parentValue * node.workstepFactor;
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
  //
  // A ROOT THAT STATES A PERCENT ALSO STARTS FROM THE CONTRACT, whatever else
  // is priced, because there is nothing above a root but the project and a
  // percent has to be a percent OF something. Without this, typing "Engineering
  // is 21.47%" on a top-level heading did nothing at all as soon as one price
  // existed anywhere in the plan — the row fell through to the unpriced branch
  // with no parent value to take a fraction of, and the box read as broken.
  // Roots with no stated percent are untouched: they still start from null once
  // prices exist, so their leaves reach the contract's leftover the way they
  // always have. No project in this database has a root carrying a factor, so
  // nothing that exists today moves.
  const roots = kids.get(null) ?? [];
  const anyPrice = priced.length > 0;
  for (const r of roots) {
    walk(r, anyPrice ? (r.workstepFactor != null ? contract : null) : contract);
  }

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

  // Leaves no price reaches take an even share of what is LEFT of the contract.
  //
  // Without this a half-priced plan leaves rows weighing nothing at all, and a
  // row with no weight is invisible: it never reaches the S-curve, it can never
  // be reported against, and the project total closes at whatever the prices
  // happened to cover. On screen that reads as work that does not exist rather
  // than as work nobody has priced yet. Splitting the remainder is the same
  // rule this function already applies at every other level of the tree —
  // unpriced siblings share what their parent has left — reached one level
  // higher, at the contract itself.
  //
  // ONLY EVER A POSITIVE REMAINDER. Gundih's prices nest, and derived over its
  // own tree they already reach 154.58 with two leaves uncovered; there is
  // nothing left to hand out, and inventing some would make a bad figure worse.
  const uncovered = leaves.filter((l) => !bobotOf.has(l.id));
  let fromGap = 0;
  if (anyPrice && uncovered.length > 0 && contract > 0) {
    const remaining = 100 - total;
    if (remaining > EPSILON) {
      const each = remaining / uncovered.length;
      for (const leaf of uncovered) {
        bobotOf.set(leaf.id, each);
        valueOf.set(leaf.id, (each / 100) * contract);
      }
      total += remaining;
      covered += uncovered.length;
      fromGap = uncovered.length;
    }
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
  } else if (fromGap > 0 || covered < leaves.length || Math.abs(total - 100) > 0.5) {
    // `fromGap` is what keeps a plan honest about itself. Sharing the remainder
    // makes the total close at 100 with every leaf carrying a figure, which is
    // exactly what `boq` claims — so without this clause a plan with a single
    // price on it would be labelled value-based off the back of a division.
    basis = 'partial';
  }

  return {
    contractValue: contract,
    valueOf,
    bobotOf,
    total,
    covered,
    leaves: leaves.length,
    basis,
    fromGap,
  };
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
  /**
   * How far past 100 the derived weights run, and how many headings did it.
   *
   * Read from the DERIVED result rather than from the stored weights, because
   * this is the figure the Activities screen shows live while someone types,
   * and two screens quoting different numbers for the same fact is how a card
   * ends up disagreeing with the bar underneath it. See `overrunOf`.
   */
  overrun: Overrun;
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
    overrun: overrunOf(nodes, result),
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

/**
 * What a heading has to give out, and what its rows have already claimed.
 *
 * The screen's question, not the derivation's. `deriveWeights` hands every row
 * a figure whatever the arithmetic looks like, because a report that refuses to
 * render is worse than one that is wrong by a stated amount. This is how the
 * screen finds out the arithmetic looked wrong, so it can say so on the card
 * instead of leaving someone to add six numbers by hand.
 *
 * **It computes nothing the derivation does not already know**, and that is
 * deliberate in the same way `buildOverallMap` computes nothing: a second
 * opinion about money living in a second file is how a card ends up disagreeing
 * with the bar underneath it.
 *
 * **Over-allocation is REPORTED, never corrected.** Gundih has headings whose
 * rows state 0.3 + 0.4 + 0.3 and still carry two more rows with nothing on
 * them, so the heading is handed out at 140%. Scaling the percentages back to
 * fit would move figures nobody asked to move; zeroing the two empty rows would
 * drop two real pieces of work to no weight at all, and a leaf with no weight
 * is invisible to every report. So the number stands and the card says it is
 * over.
 */
export interface Allocation {
  /** The money this heading has to give out. */
  budget: number;
  /** What its rows have claimed: their own prices, and their stated percents. */
  claimed: number;
  /** Budget minus claimed. NEGATIVE means the rows claimed more than there is. */
  left: number;
  /** Rows that claimed nothing, and will split whatever is left between them. */
  openChildren: number;
  /** The stated percents added up, as a fraction. 1 means fully spoken for. */
  statedFraction: number;
}

/**
 * One entry per row that has rows beneath it and a budget to give out.
 *
 * A heading no price reaches has no budget to divide and gets no entry: on
 * screen that is the card whose figure is simply its rows added up, which is a
 * different sentence from "it is over by 40%".
 */
export function allocationOf(nodes: WeightNode[], result: WeightResult): Map<string, Allocation> {
  const kids = new Map<string, WeightNode[]>();
  for (const n of nodes) {
    if (n.parentId == null) continue;
    kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  }

  const priced = nodes.filter((n) => (n.price ?? 0) > 0);
  const largest = priced.length ? Math.max(...priced.map((n) => n.price ?? 0)) : 0;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, Allocation>();
  for (const [parentId, children] of kids) {
    // A reporting unit's own contract figure first, because that is the number
    // its SPK was signed for and the derivation only ever sees it as a price.
    // Then whatever the derivation handed the row from above.
    const parent = byId.get(parentId);
    const budget = parent?.unitContractValue ?? result.valueOf.get(parentId);
    if (budget == null || budget <= 0) continue;

    let claimed = 0;
    let openChildren = 0;
    let statedFraction = 0;
    for (const c of children) {
      // A nested reporting unit is not spending its parent's money — it
      // carries its own contract, exactly as the derivation treats it.
      if (c.isReportingUnit && (c.unitContractValue ?? c.price ?? 0) > 0) continue;
      if ((c.price ?? 0) > 0) {
        if (!isTotalRow(c, priced, largest)) claimed += c.price ?? 0;
        continue;
      }
      if (c.workstepFactor != null) {
        statedFraction += c.workstepFactor;
        claimed += budget * c.workstepFactor;
        continue;
      }
      openChildren += 1;
    }

    out.set(parentId, { budget, claimed, left: budget - claimed, openChildren, statedFraction });
  }
  return out;
}

/**
 * What the weights are over by, and how many headings caused it.
 *
 * `deriveWeights` hands money DOWN, but every level decides its own claim
 * independently and nothing ever checks that what a heading gives out equals
 * what it holds. On Gundih that reaches 154.58%: the leaves add up to 9,150,942
 * against a contract of 5,920,000, with the money closing exactly at the top
 * level. Two causes, both real in that data and both deliberate on their own
 * terms, which is why this REPORTS and never corrects:
 *
 * - **Stated percents plus rows with nothing.** `1.3.1.1.1` holds 167,600 and
 *   its five rows read — / 30% / — / 40% / 30%. The three percents take the
 *   whole budget, and the two blank rows still count as 2 of 5 in the even
 *   split, so the heading hands out 140%. A percent is deliberately read
 *   against the WHOLE budget, and the blank rows are deliberately not zeroed —
 *   a leaf with no weight is invisible to every report.
 * - **Real prices deeper than the share handed down.** `1.3.1.2.1 Electrical`
 *   was given 124,851 by even split because nothing above it carries a price,
 *   while its five rows carry the SPK's own figures totalling 849,542. The
 *   724,691 difference is subtracted nowhere.
 *
 * **`amount` is read off the total, not off the branches.** The branch scan
 * double-counts wherever an over-giving heading sits inside another one, so its
 * sum does not reconcile with the percentage on screen — and a screen printing
 * "154.58%" beside a figure that is not (154.58 − 100)% of the contract is one
 * card making two statements. The count answers "where", the money answers
 * "how much", and each comes from the measure that can answer it.
 *
 * **A nested reporting unit is not its parent spending twice.** SPK-007 carries
 * its own contract inside SPK-004's `1.4`, exactly as `deriveWeights` and
 * `allocationOf` already treat it, so it is left out of its parent's sum.
 */
/** One heading that hands out more than it was given. */
export interface OverGiving {
  id: string;
  /** What the derivation handed this heading. */
  budget: number;
  /** What its rows took between them. */
  claimed: number;
  /** claimed - budget. Always positive; that is what puts it in the list. */
  over: number;
}

export interface Overrun {
  /**
   * EVERY heading that hands out more than it holds, biggest first.
   *
   * A count was not enough and saying so cost a round trip: the strip read
   * "26 headings hand out more than they hold" and then "open the cards below
   * that say they are over", while every card on that screen said it had money
   * LEFT. The six worst sit four and five levels down inside three different
   * SPK, and nothing on the screen could reach them. A number nobody can act
   * on is the same as no number.
   */
  headings: OverGiving[];
  /** `headings.length`, kept because two call sites only want the count. */
  branches: number;
  /** Money the derived leaves exceed the contract by. Zero when they do not. */
  amount: number;
  /** Percentage points over 100. Zero when the weights close. */
  points: number;
}

export function overrunOf(nodes: WeightNode[], result: WeightResult): Overrun {
  const kids = new Map<string, WeightNode[]>();
  for (const n of nodes) {
    if (n.parentId == null) continue;
    kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  }

  const headings: OverGiving[] = [];
  for (const [parentId, children] of kids) {
    const own = result.valueOf.get(parentId);
    if (own == null || own <= 0) continue;
    let claimed = 0;
    for (const c of children) {
      if (c.isReportingUnit && (c.unitContractValue ?? c.price ?? 0) > 0) continue;
      claimed += result.valueOf.get(c.id) ?? 0;
    }
    if (claimed - own > EPSILON) {
      headings.push({ id: parentId, budget: own, claimed, over: claimed - own });
    }
  }
  headings.sort((a, b) => b.over - a.over);

  const points = Math.max(0, result.total - 100);
  return {
    headings,
    branches: headings.length,
    amount: points > EPSILON ? (points / 100) * result.contractValue : 0,
    points,
  };
}
