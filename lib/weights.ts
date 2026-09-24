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
 * **A budget is the only thing that gives a row weight** (24 Sep 2026). A row
 * with a price holds that money; a heading without one is its rows added up; a
 * leaf with neither weighs NOTHING. There used to be an even share of whatever
 * was left for rows nobody had priced, and people read it as a figure somebody
 * had typed. A stored `workstepFactor` (Gundih's 0.5 / 0.3 / 0.2 for IFR / IFA
 * / AFC) is still read, as that fraction of its parent's own budget, so no
 * imported figure moves; nothing writes one any more.
 *
 * **Every budget is carved out of a POOL**: the nearest heading above it with a
 * budget of its own, or the contract. What draws on a pool may not exceed it —
 * see `checkBudgetEdit`, which the write path and the screen both call.
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
  /**
   * Money per node. A row with a budget of its own is that budget, a heading
   * without one is its rows added up, and a leaf with neither is 0.
   */
  valueOf: Map<string, number>;
  /** Budgets a row holds OF ITS OWN: its price, or a stored fraction of its parent's. */
  budgetOf: Map<string, number>;
  /**
   * Percentage per LEAF, 0..100. Every leaf has one, 0 where no budget reaches
   * it, except a total row whose price restates the contract and is thrown away.
   */
  bobotOf: Map<string, number>;
  /** What the leaf weights add up to. 100 means the budgets reach every part of the contract. */
  total: number;
  /** Leaves a budget reaches. */
  covered: number;
  leaves: number;
  /**
   * `boq` — every leaf has a budget and the total closes at 100.
   * `partial` — budgets exist but do not reach the whole contract yet.
   * `even` — nothing is budgeted at all, so every leaf weighs 0. The literal is
   *   older than the rule (it once meant "spread evenly") and stays because it
   *   is stored in `projects.weight_basis`.
   */
  basis: 'boq' | 'partial' | 'even';
  /** Each row's parent, for walking up to the pool a budget is carved out of. */
  parentOf: Map<string, string | null>;
  /**
   * Reporting units holding a budget of their own. Each is its own contract and
   * draws on the contract, not on the heading it sits inside: SPK-007 lives at
   * 1.4.4 inside SPK-004's 1.4, and 1.4's price does not include it.
   */
  ownContract: Set<string>;
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
 * Budgets down the tree, money back up it, then weight out of the leaves.
 *
 * Nothing here writes; the caller decides whether the result is worth applying.
 *
 * **Down** decides what each row holds OF ITS OWN: its price, or, for a row
 * still carrying a stored fraction, that fraction of its parent's own budget
 * (a root's parent is the contract). **Up** decides what each row is worth: its
 * own budget where it has one, otherwise its rows added up, and a leaf with
 * neither is worth nothing. A leaf's weight is its money over the contract.
 *
 * NO EVEN SHARE, ANYWHERE (24 Sep 2026). A row nobody budgeted used to take an
 * even share of what its heading had left, and one project read "= IDR 11 253"
 * under five boxes nobody had touched; the person looking at it asked who had
 * filled them in. A rough figure only helps if it can be told from a real one,
 * and on that screen it could not. So a row without a budget weighs 0 until
 * somebody gives it one, and the screen says so and lists it.
 */
export function deriveWeights(nodes: WeightNode[], contractValue?: number): WeightResult {
  const contract = contractValue ?? computeContractValue(nodes);

  const kids = new Map<string | null, WeightNode[]>();
  for (const n of [...nodes].sort((a, b) => a.order - b.order)) {
    const key = n.parentId ?? null;
    kids.set(key, [...(kids.get(key) ?? []), n]);
  }
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId ?? null]));

  const priced = nodes.filter((n) => (n.price ?? 0) > 0);
  const largest = priced.length ? Math.max(...priced.map((n) => n.price ?? 0)) : 0;
  const discarded = new Set(priced.filter((n) => isTotalRow(n, priced, largest)).map((n) => n.id));

  const budgetOf = new Map<string, number>();
  const ownContract = new Set<string>();
  const down = (node: WeightNode, parentBudget: number | null) => {
    let own: number | null = null;
    if ((node.price ?? 0) > 0 && !discarded.has(node.id)) {
      own = node.price ?? 0;
    } else if ((node.workstepFactor ?? 0) > 0 && parentBudget != null && parentBudget > 0) {
      // A STORED PERCENT IS A PERCENT OF THE PARENT'S WHOLE BUDGET, the reading
      // it has always had. Nothing writes one any more; this keeps the ones
      // already stored (Gundih's IFR / IFA / AFC) meaning what they meant.
      own = parentBudget * (node.workstepFactor ?? 0);
    }
    if (own != null) {
      budgetOf.set(node.id, own);
      if (node.isReportingUnit) ownContract.add(node.id);
    }
    for (const c of kids.get(node.id) ?? []) down(c, own);
  };
  for (const r of kids.get(null) ?? []) down(r, contract > 0 ? contract : null);

  const valueOf = new Map<string, number>();
  const up = (node: WeightNode): number => {
    let rows = 0;
    for (const c of kids.get(node.id) ?? []) rows += up(c);
    const v = budgetOf.get(node.id) ?? rows;
    valueOf.set(node.id, v);
    return v;
  };
  for (const r of kids.get(null) ?? []) up(r);

  const bobotOf = new Map<string, number>();
  const leaves = nodes.filter((n) => n.isLeaf);
  let total = 0;
  let covered = 0;
  for (const leaf of leaves) {
    // A total row restates the whole contract on one line. Counted, it would
    // double every figure; given a 0 it would be listed as work with no budget.
    if (discarded.has(leaf.id)) continue;
    const v = valueOf.get(leaf.id) ?? 0;
    const b = contract > 0 ? (v / contract) * 100 : 0;
    bobotOf.set(leaf.id, b);
    total += b;
    if (v > 0) covered += 1;
  }

  const basis: WeightResult['basis'] =
    budgetOf.size === 0
      ? 'even'
      : covered === bobotOf.size && Math.abs(total - 100) <= 0.5
        ? 'boq'
        : 'partial';

  return {
    contractValue: contract,
    valueOf,
    budgetOf,
    bobotOf,
    total,
    covered,
    leaves: leaves.length,
    basis,
    parentOf,
    ownContract,
  };
}

/** The contract's key wherever pools are keyed by row id. */
export const CONTRACT_POOL = '#contract';

/**
 * The budget a row's money is carved out of: the nearest heading above it that
 * holds a budget of its own, or the contract (`null`). A reporting unit with a
 * budget is its own contract and always draws on the contract.
 *
 * This is also what the percent beside a row is a percent OF, so "50%" on
 * 5.2.1 means half of 5.2 when 5.2 has a budget, and half of 5 when it does not.
 */
export function poolOf(nodeId: string, result: WeightResult): string | null {
  if (result.ownContract.has(nodeId)) return null;
  let p = result.parentOf.get(nodeId) ?? null;
  // Guarded against a parent chain that loops, which a bad import could leave.
  for (let guard = 0; p != null && guard <= result.parentOf.size; guard += 1) {
    if (result.budgetOf.has(p)) return p;
    p = result.parentOf.get(p) ?? null;
  }
  return null;
}

/** What a pool holds: that heading's own budget, or the contract. */
export function poolAmount(pool: string | null, result: WeightResult): number {
  return pool == null ? result.contractValue : (result.budgetOf.get(pool) ?? 0);
}

/**
 * The weight each row should store, for every row whose stored figure differs.
 *
 * A BRANCH CARRIES NO WEIGHT OF ITS OWN: its figure is its children, added up
 * when the report is built. The flag that says which is which is set while a
 * row is still a leaf and goes stale the moment something is indented under
 * it, and the weight it was holding stays behind, so a branch is written null.
 */
export function bobotWrites(
  nodes: WeightNode[],
  result: WeightResult
): Array<{ id: string; bobot: number | null }> {
  const out: Array<{ id: string; bobot: number | null }> = [];
  for (const n of nodes) {
    const next = n.isLeaf ? (result.bobotOf.get(n.id) ?? null) : null;
    const same =
      (n.bobot == null && next == null) ||
      (n.bobot != null && next != null && Math.abs(n.bobot - next) < 1e-9);
    if (!same) out.push({ id: n.id, bobot: next });
  }
  return out;
}

/**
 * Whether giving `nodeId` a budget of `next` (null clears it) keeps every pool
 * within what it holds. Null when it does; otherwise the refusal, in words.
 *
 * Both directions in one test, because they are one rule: a row may not take
 * more than its pool has left, and a heading may not be lowered below what its
 * rows already take. Run over the plan before and after the edit, every pool is
 * compared, and the edit is refused only where it makes one WORSE. That last
 * clause is what keeps Gundih editable: it inherited headings handed out at
 * 140%, and refusing every keystroke inside them until somebody fixed a
 * workbook from 2025 would make the screen useless there instead of honest.
 *
 * The screen calls this while someone types, and `updateRowTextAction` calls it
 * again before writing, so the rule cannot be walked around from the planner or
 * from Data Overall's panel.
 */
export function checkBudgetEdit(
  nodes: WeightNode[],
  signedContract: number | null | undefined,
  nodeId: string,
  next: number | null,
  nameOf: (id: string | null) => string,
  say: (amount: number) => string
): string | null {
  const contract = signedContract != null && signedContract > 0 ? signedContract : undefined;
  const clean = next != null && next > 0 ? next : null;
  // Setting or clearing the budget clears a stored fraction either way, exactly
  // as `updateRowTextAction` writes it.
  const afterNodes = nodes.map((n) =>
    n.id === nodeId ? { ...n, price: clean, workstepFactor: null } : n
  );
  const beforeAlloc = allocationOf(deriveWeights(nodes, contract));
  const after = deriveWeights(afterNodes, contract);
  const afterAlloc = allocationOf(after);

  for (const [key, a] of afterAlloc) {
    if (a.left >= -HALF_UNIT) continue;
    const was = beforeAlloc.get(key);
    if (was && a.left >= was.left - HALF_UNIT) continue;
    if (key === nodeId) {
      return `The rows inside ${nameOf(nodeId)} already take ${say(a.claimed)}. Lower them first, or keep it at ${say(a.claimed)} or more.`;
    }
    const where = key === CONTRACT_POOL ? 'the contract' : nameOf(key);
    if (clean == null) return `That would put ${where} over by ${say(-a.left)}.`;
    const available = Math.max(0, a.budget - (a.claimed - (after.valueOf.get(nodeId) ?? 0)));
    return `This row can take at most ${say(available)} of ${where}.`;
  }
  return null;
}

/** Money compares to half a unit: nothing on screen shows less than a whole one. */
const HALF_UNIT = 0.5;

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
    overrun: overrunOf(result),
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
 * What each pool holds, and what the budgets carved out of it take.
 *
 * A POOL is a heading with a budget of its own, or the contract
 * (`CONTRACT_POOL`). Every budget draws on exactly one pool, the one `poolOf`
 * names, so a row priced inside a heading nobody budgeted counts against the
 * heading above that, and the contract at the top. That is what makes the cap
 * one rule instead of one per level.
 *
 * **It computes nothing the derivation does not already know**, and that is
 * deliberate in the same way `buildOverallMap` computes nothing: a second
 * opinion about money living in a second file is how a card ends up disagreeing
 * with the bar underneath it.
 *
 * **What a pool is over by is REPORTED here, and refused at the door.**
 * `checkBudgetEdit` refuses any edit that makes a pool worse, so a new overrun
 * cannot be typed. What can still be over is inherited (Gundih's headings
 * handed out at 140%) or arrived in bulk (a paste, an indent), and the card
 * says so instead of scaling anybody's figures back.
 */
export interface Allocation {
  /** The money this pool has to give out. */
  budget: number;
  /** What the budgets drawing on it add up to. */
  claimed: number;
  /** Budget minus claimed. NEGATIVE means more was taken than there is. */
  left: number;
  /** Activities inside this pool that no budget reaches yet. */
  emptyLeaves: number;
}

/**
 * One entry per pool: every row holding a budget of its own, and the contract
 * when there is one. A heading with no budget of its own is not a pool; its
 * figure is simply its rows added up, which is a different sentence on screen
 * from "it is over by 40%".
 */
export function allocationOf(result: WeightResult): Map<string, Allocation> {
  const out = new Map<string, Allocation>();
  const at = (key: string, budget: number) => {
    let a = out.get(key);
    if (!a) {
      a = { budget, claimed: 0, left: budget, emptyLeaves: 0 };
      out.set(key, a);
    }
    return a;
  };

  if (result.contractValue > 0) at(CONTRACT_POOL, result.contractValue);
  for (const [id, own] of result.budgetOf) at(id, own);

  for (const [id, own] of result.budgetOf) {
    const pool = poolOf(id, result) ?? CONTRACT_POOL;
    const a = out.get(pool);
    if (a) a.claimed += own;
  }
  for (const [leafId] of result.bobotOf) {
    if ((result.valueOf.get(leafId) ?? 0) > 0) continue;
    const a = out.get(poolOf(leafId, result) ?? CONTRACT_POOL);
    if (a) a.emptyLeaves += 1;
  }
  for (const a of out.values()) a.left = a.budget - a.claimed;
  return out;
}

/** One heading that hands out more than it holds. */
export interface OverGiving {
  id: string;
  /** What this heading holds. */
  budget: number;
  /** What the budgets drawing on it took between them. */
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
  /** Money the leaves exceed the contract by. Zero when they do not. */
  amount: number;
  /** Percentage points over 100. Zero when the weights close. */
  points: number;
}

/**
 * What the weights are over by, and which headings did it.
 *
 * **`amount` is read off the total, not off the headings.** An over-giving
 * heading inside another one would be counted twice, and a screen printing
 * "154.58%" beside a figure that is not (154.58 - 100)% of the contract is one
 * card making two statements. The list answers "where", the money answers "how
 * much", and each comes from the measure that can answer it.
 */
export function overrunOf(result: WeightResult): Overrun {
  const headings: OverGiving[] = [];
  for (const [id, a] of allocationOf(result)) {
    if (id === CONTRACT_POOL || -a.left <= EPSILON) continue;
    headings.push({ id, budget: a.budget, claimed: a.claimed, over: -a.left });
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
