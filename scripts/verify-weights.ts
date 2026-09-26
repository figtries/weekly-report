/**
 * Guards the money formula.
 *
 * The contract a plan adds up to must survive the two shapes that broke it on
 * the real data: reporting units that NEST (a contract inside another
 * contract's heading, still its own contract — SPK-007 inside SPK-004's 1.4),
 * and a row that restates the whole contract on one line (Gundih's "1.5
 * Finish"). Gundih itself was removed on 26 Sep 2026, so both shapes are built
 * here by hand; the rules they prove are the formula's, not that project's.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weights.ts
 */
import {
  checkBudgetEdit,
  computeContractValue,
  deriveWeights,
  summariseWeights,
  type WeightNode,
} from '../lib/weights.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
  if (!ok) failed += 1;
};

const node = (n: Partial<WeightNode> & Pick<WeightNode, 'id' | 'parentId' | 'order' | 'isLeaf'>): WeightNode => ({
  price: null,
  workstepFactor: null,
  isReportingUnit: false,
  unitContractValue: null,
  bobot: null,
  ...n,
});

// Two contracts, one nested inside the other's heading, and a closing row that
// restates the whole 750 on one line. As on Gundih, the rows beside it (600)
// come close enough to its figure (within 35%) to read as what it restates.
//   U1  (contract, 600 of its own)
//     a   600
//     U2  (contract, 150, nested inside U1 but NOT inside U1's 600)
//       b   150
//   fin 750  ← restates the contract
const nested: WeightNode[] = [
  node({ id: 'U1', parentId: null, order: 0, isLeaf: false, price: 600, isReportingUnit: true, unitContractValue: 600 }),
  node({ id: 'a', parentId: 'U1', order: 1, isLeaf: true, price: 600 }),
  node({ id: 'U2', parentId: 'U1', order: 2, isLeaf: false, price: 150, isReportingUnit: true, unitContractValue: 150 }),
  node({ id: 'b', parentId: 'U2', order: 3, isLeaf: true, price: 150 }),
  node({ id: 'fin', parentId: null, order: 4, isLeaf: true, price: 750 }),
];

const derived = computeContractValue(nested);
check('contract value from reporting units, nested ones included', Math.abs(derived - 750) < 0.01, `${derived} (600 + 150)`);

const nestedWeights = deriveWeights(nested, 750);
check(
  'a nested contract draws on the project, not on the heading it sits in',
  nestedWeights.projectBudget === 750 && Math.abs(nestedWeights.total - 100) < 1e-9,
  `project budget ${nestedWeights.projectBudget}, weights total ${nestedWeights.total.toFixed(6)}`
);
check(
  'a row restating the whole contract is not counted as work',
  !nestedWeights.bobotOf.has('fin') || (nestedWeights.bobotOf.get('fin') ?? 0) === 0,
  `fin weighs ${(nestedWeights.bobotOf.get('fin') ?? 0).toFixed(4)}`
);

const nestedSummary = summariseWeights(nested, 'USD', 750);
check(
  'allocation reconciles with the signed contract',
  Math.abs(nestedSummary.gap) < 0.01,
  `signed ${nestedSummary.contractValue} − allocated ${nestedSummary.allocated} = ${nestedSummary.gap}`
);
check(
  'a NESTED reporting unit counts as its own contract',
  Math.abs(nestedSummary.unitTotal - nestedSummary.contractValue) < 0.01,
  `units add up to ${nestedSummary.unitTotal} of ${nestedSummary.contractValue}`
);

// A plan priced end to end must close at exactly 100 by construction.
const synthetic: WeightNode[] = [
  { id: 'r', parentId: null, order: 0, price: null, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: false },
  { id: 'a', parentId: 'r', order: 1, price: 300000, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
  { id: 'b', parentId: 'r', order: 2, price: 700000, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: false },
  { id: 'b1', parentId: 'b', order: 3, price: null, workstepFactor: 0.5, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
  { id: 'b2', parentId: 'b', order: 4, price: null, workstepFactor: 0.3, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
  { id: 'b3', parentId: 'b', order: 5, price: null, workstepFactor: 0.2, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
];
const s = deriveWeights(synthetic);
check(
  'a fully priced plan closes at 100 by construction',
  Math.abs(s.total - 100) < 1e-9 && s.basis === 'boq',
  `total ${s.total.toFixed(9)}, basis ${s.basis}, project budget ${s.projectBudget}`
);
check(
  'workstep splits its parent, not the contract',
  Math.abs((s.bobotOf.get('b1') ?? 0) - 35) < 1e-9,
  `b1 = ${(s.bobotOf.get('b1') ?? 0).toFixed(6)} (700000 × 0.5 ÷ 1000000 × 100 = 35)`
);

// No budgets at all: nothing weighs anything, and the plan says so.
const unpriced = synthetic.map((n) => ({ ...n, price: null, workstepFactor: null }));
const e = deriveWeights(unpriced);
check(
  'a plan with no budgets weighs nothing and says so',
  e.basis === 'even' && e.total === 0,
  `basis ${e.basis}, total ${e.total.toFixed(6)} across ${e.leaves} leaves`
);

// Work with no price on it must SHOW as a gap, never be absorbed silently.
const partlyPriced: WeightNode[] = [
  { id: 'r', parentId: null, order: 0, price: null, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: false },
  { id: 'a', parentId: 'r', order: 1, price: 400000, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
  { id: 'b', parentId: 'r', order: 2, price: null, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
];
const partial = summariseWeights(partlyPriced, 'IDR', 1000000);
check(
  'unpriced work shows as a gap rather than being absorbed',
  Math.abs(partial.gap - 600000) < 0.01,
  `signed 1,000,000 with only 400,000 allocated → gap ${partial.gap.toFixed(0)}`
);

// A leaf no budget reaches weighs 0. Nothing is invented for it (24 Sep 2026).
const noShare = deriveWeights(partlyPriced, 1000000);
check(
  'a leaf no budget reaches weighs 0, measured against the PROJECT budget, not the contract',
  noShare.basis === 'partial' &&
    Math.abs(noShare.total - 100) < 1e-9 &&
    noShare.bobotOf.get('b') === 0 &&
    Math.abs((noShare.bobotOf.get('a') ?? 0) - 100) < 1e-9 &&
    noShare.projectBudget === 400000,
  `budgeted leaf ${(noShare.bobotOf.get('a') ?? 0).toFixed(2)}, the other ${(noShare.bobotOf.get('b') ?? 0).toFixed(2)}, total ${noShare.total.toFixed(2)}, basis ${noShare.basis}`
);

/* --------------------------------------------------------------- the cap */

// Contract 1000. H holds 500 with H1 at 200 and H2 empty; K has no budget of
// its own and K1 draws straight on the contract.
const capped: WeightNode[] = [
  { id: 'H', parentId: null, order: 0, price: 500, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: false },
  { id: 'H1', parentId: 'H', order: 1, price: 200, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
  { id: 'H2', parentId: 'H', order: 2, price: null, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
  { id: 'K', parentId: null, order: 3, price: null, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: false },
  { id: 'K1', parentId: 'K', order: 4, price: 100, workstepFactor: null, isReportingUnit: false, unitContractValue: null, bobot: null, isLeaf: true },
];
const nameOf = (id: string | null) => (id == null ? 'the contract' : id);
const say = (n: number) => String(Math.round(n));
const tryBudget = (rows: WeightNode[], id: string, next: number | null) =>
  checkBudgetEdit(rows, 1000, id, next, nameOf, say);

check('a budget that fits its heading is allowed', tryBudget(capped, 'H2', 300) === null, String(tryBudget(capped, 'H2', 300)));
check(
  'one unit more than the heading has room for is refused, with the figure',
  tryBudget(capped, 'H2', 301) === 'This row can take at most 300 of H.',
  String(tryBudget(capped, 'H2', 301))
);
check(
  'a heading cannot be lowered below what its rows take',
  (tryBudget(capped, 'H', 150) ?? '').startsWith('The rows inside H already take 200.'),
  String(tryBudget(capped, 'H', 150))
);
check(
  'the project is not capped: a row with no heading above grows the project budget',
  tryBudget(capped, 'K1', 600) === null,
  String(tryBudget(capped, 'K1', 600))
);
check('clearing a budget is always allowed', tryBudget(capped, 'H', null) === null, String(tryBudget(capped, 'H', null)));

// Inherited overrun: H already hands out 700 of its 500. An edit that makes it
// no worse goes through; one that makes it worse does not.
const inherited = capped.map((n) => (n.id === 'H1' ? { ...n, price: 400 } : n.id === 'H2' ? { ...n, price: 300 } : n));
check(
  'inside a heading that was already over, an edit that eases it is allowed',
  tryBudget(inherited, 'H2', 250) === null,
  String(tryBudget(inherited, 'H2', 250))
);
check(
  'and one that makes it worse is refused',
  tryBudget(inherited, 'H2', 350) != null,
  String(tryBudget(inherited, 'H2', 350))
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
