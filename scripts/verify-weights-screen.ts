/**
 * Proves the claims the Weights screen makes to the person using it.
 *
 * Since 24 Sep 2026 a BUDGET is the only thing that gives a row weight. A row
 * nobody budgeted weighs 0 and the screen says so; there is no even share of a
 * remainder any more, because on screen it could not be told from a figure
 * somebody had typed. A fraction stored before that rule (Gundih's 0.5 / 0.3 /
 * 0.2 on IFR / IFA / AFC) is still read, as money carved out of its parent.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weights-screen.ts
 */
import { poolOf, deriveWeights, type WeightNode } from '../lib/weights.ts';
import { buildWeightsScreen } from '../lib/weights-screen.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

function node(p: Partial<WeightNode> & { id: string; order: number }): WeightNode {
  return {
    parentId: null,
    price: null,
    workstepFactor: null,
    isReportingUnit: false,
    unitContractValue: null,
    bobot: null,
    isLeaf: false,
    ...p,
  };
}

/**
 * Two SPK of two leaves each, against a contract of 1000.
 *
 * A is budgeted all the way down. B carries its own budget but nobody has given
 * a single row inside it one, which is the state every project made in this
 * app starts in, and the state the screen exists to get someone out of.
 */
const nodes: WeightNode[] = [
  node({ id: 'A', order: 1, isReportingUnit: true, unitContractValue: 600, price: 600 }),
  node({ id: 'A1', order: 2, parentId: 'A', isLeaf: true, price: 400 }),
  node({ id: 'A2', order: 3, parentId: 'A', isLeaf: true, price: 200 }),
  node({ id: 'B', order: 4, isReportingUnit: true, unitContractValue: 400, price: 400 }),
  node({ id: 'B1', order: 5, parentId: 'B', isLeaf: true }),
  node({ id: 'B2', order: 6, parentId: 'B', isLeaf: true }),
];

const meta = new Map(nodes.map((n) => [n.id, { code: n.id, name: `Row ${n.id}` }]));
const screen = buildWeightsScreen(nodes, meta, 'IDR', 1000);

const all = screen.units.flatMap((u) => u.rows).filter((r) => r.isLeaf);
const by = (id: string) => all.find((r) => r.id === id);
const total = all.reduce((s, r) => s + r.bobotOverall, 0);
const unitB = screen.units.find((u) => u.id === 'B');

check('both SPK are found', screen.units.length === 2 && screen.hasUnits, `${screen.units.length} units`);

check(
  'a leaf is weighted by its own budget',
  Math.abs((by('A1')?.bobotOverall ?? 0) - 40) < 0.01,
  `A1 ${by('A1')?.bobotOverall.toFixed(2)}`
);

check(
  'a leaf nobody budgeted weighs 0, not an even share',
  ['B1', 'B2'].every((id) => by(id)?.bobotOverall === 0),
  `B1 ${by('B1')?.bobotOverall.toFixed(2)}, B2 ${by('B2')?.bobotOverall.toFixed(2)}`
);

check(
  'so the total is what the budgets reach, 60, until the rest are given one',
  Math.abs(total - 60) < 0.01,
  `total ${total.toFixed(4)}`
);

check(
  'the screen can name where each row got its weight',
  by('A1')?.share === 'price' && by('B1')?.share === 'none' && by('B2')?.share === 'none',
  `A1=${by('A1')?.share} B1=${by('B1')?.share} B2=${by('B2')?.share}`
);

check(
  'weight within an SPK is measured against that SPK, not the project',
  Math.abs((by('A1')?.bobotInUnit ?? 0) - 66.6667) < 0.01,
  `A1 in-unit ${by('A1')?.bobotInUnit.toFixed(4)}, overall ${by('A1')?.bobotOverall.toFixed(4)}`
);

check(
  'a card counts the activities a budget reaches',
  screen.units.find((u) => u.id === 'A')?.budgetedLeaves === 2 &&
    unitB?.budgetedLeaves === 0 &&
    unitB?.leafCount === 2,
  `A ${screen.units.find((u) => u.id === 'A')?.budgetedLeaves}/2, B ${unitB?.budgetedLeaves}/${unitB?.leafCount}`
);

check(
  "and says what its budget still has to give out",
  (() => {
    const a = unitB?.allocation;
    return a != null && Math.abs(a.left - 400) < 0.01 && a.emptyLeaves === 2;
  })(),
  `B left ${unitB?.allocation?.left}, ${unitB?.allocation?.emptyLeaves} activities with no budget`
);

/**
 * A stored fraction is still read, as money out of its parent. Gundih carries
 * 0.5 / 0.3 / 0.2 on IFR / IFA / AFC, so this is the real shape of an
 * engineering leaf, and none of its figures may move.
 */
const withFactor: WeightNode[] = [
  node({ id: 'C', order: 1, isReportingUnit: true, unitContractValue: 1000, price: 1000 }),
  node({ id: 'C1', order: 2, parentId: 'C', isLeaf: true, workstepFactor: 0.5 }),
  node({ id: 'C2', order: 3, parentId: 'C', isLeaf: true, workstepFactor: 0.3 }),
  node({ id: 'C3', order: 4, parentId: 'C', isLeaf: true, workstepFactor: 0.2 }),
];
const factored = buildWeightsScreen(
  withFactor,
  new Map(withFactor.map((n) => [n.id, { code: n.id, name: n.id }])),
  'IDR',
  1000
);
const frows = factored.units[0]?.rows.filter((r) => r.isLeaf) ?? [];

check(
  'a row carrying a stored fraction is labelled as one',
  frows.length === 3 && frows.every((r) => r.share === 'factor'),
  frows.map((r) => `${r.id}=${r.share}`).join(' ')
);

check(
  'and it holds that fraction of its parent as money',
  Math.abs((frows.find((r) => r.id === 'C1')?.bobotOverall ?? 0) - 50) < 0.01 &&
    Math.abs((frows.find((r) => r.id === 'C1')?.budget ?? 0) - 500) < 0.01,
  `C1 ${frows.find((r) => r.id === 'C1')?.bobotOverall.toFixed(2)}%, budget ${frows.find((r) => r.id === 'C1')?.budget}`
);

/**
 * A stored fraction under a heading with no budget is a fraction of nothing.
 *
 * PHSS Samberah showed the old version of this: a heading with no budget, two
 * rows holding a stored 0, "2 of 2 rows set", and both figures an even share
 * nobody chose (24 Sep 2026).
 */
const noBudget: WeightNode[] = [
  node({ id: 'P', order: 1, isReportingUnit: true }),
  node({ id: 'P1', order: 2, parentId: 'P', isLeaf: true, price: 600 }),
  node({ id: 'Q', order: 3, isReportingUnit: true }),
  node({ id: 'Q1', order: 4, parentId: 'Q', isLeaf: true, workstepFactor: 0.5 }),
  node({ id: 'Q2', order: 5, parentId: 'Q', isLeaf: true }),
];
const nb = buildWeightsScreen(
  noBudget,
  new Map(noBudget.map((n) => [n.id, { code: n.id, name: n.id }])),
  'IDR',
  1000
);
const qCard = nb.units.find((u) => u.id === 'Q');
const qRows = qCard?.rows.filter((r) => r.isLeaf) ?? [];

check(
  'a fraction with no budget above it gives no budget',
  qRows.length === 2 && qRows.every((r) => r.share === 'none' && r.value === 0),
  qRows.map((r) => `${r.id}=${r.share}/${r.value}`).join(' ')
);

check('and the card does not count it', qCard?.budgetedLeaves === 0, `budgetedLeaves=${qCard?.budgetedLeaves}`);

check(
  'a row under a heading with no budget draws on the contract',
  poolOf('Q2', deriveWeights(noBudget, 1000)) === null
);

/** No budgets at all: every leaf weighs nothing, and the plan says so. */
const bare: WeightNode[] = [
  node({ id: 'D', order: 1 }),
  node({ id: 'D1', order: 2, parentId: 'D', isLeaf: true }),
  node({ id: 'D2', order: 3, parentId: 'D', isLeaf: true }),
];
const evenScreen = buildWeightsScreen(
  bare,
  new Map(bare.map((n) => [n.id, { code: n.id, name: n.id }])),
  'IDR',
  null
);
const erows = evenScreen.units.flatMap((u) => u.rows).filter((r) => r.isLeaf);

check(
  'a plan with no budgets at all weighs nothing, and says so',
  !evenScreen.hasUnits &&
    erows.length === 2 &&
    erows.every((r) => r.bobotOverall === 0 && r.share === 'none') &&
    evenScreen.summary.basis === 'even',
  erows.map((r) => `${r.id}=${r.bobotOverall.toFixed(2)}/${r.share}`).join(' ') + ` basis=${evenScreen.summary.basis}`
);

/**
 * A FLAT plan: every top-level row is a leaf, nothing nested under anything.
 *
 * This is what a project made in the app looks like before anyone indents a
 * row, and the first version of this screen showed thirteen cards all reading
 * 0.00% on exactly such a project, because a card built from a leaf has no
 * rows. A card is a BRANCH. A top-level leaf belongs in `looseRows`.
 */
const flat: WeightNode[] = [
  node({ id: 'F1', order: 1, isLeaf: true }),
  node({ id: 'F2', order: 2, isLeaf: true }),
  node({ id: 'F3', order: 3, isLeaf: true, price: 500 }),
];
const flatScreen = buildWeightsScreen(
  flat,
  new Map(flat.map((n) => [n.id, { code: n.id, name: n.id }])),
  'IDR',
  1000
);

check('a flat plan makes no empty cards', flatScreen.units.length === 0, `${flatScreen.units.length} cards`);

check(
  'its rows are reachable on the first screen, the unbudgeted ones at 0',
  flatScreen.looseRows.length === 3 &&
    flatScreen.looseRows.find((r) => r.id === 'F3')?.bobotOverall === 100 &&
    flatScreen.looseRows.filter((r) => r.bobotOverall === 0).length === 2,
  flatScreen.looseRows.map((r) => `${r.id}=${r.bobotOverall.toFixed(2)}`).join(' ')
);

check(
  'every leaf reaches exactly one place on the screen, never zero and never twice',
  (() => {
    const seen = [...screen.units.flatMap((u) => u.rows), ...screen.looseRows]
      .filter((r) => r.isLeaf)
      .map((r) => r.id);
    const leaves = nodes.filter((n) => n.isLeaf).map((n) => n.id);
    return seen.length === leaves.length && leaves.every((id) => seen.filter((s) => s === id).length === 1);
  })()
);

/**
 * A heading with a budget, and rows carved out of it.
 *
 * The card's money must be its ROWS added up rather than the heading row's own
 * price, and rows claiming more than the heading holds must be REPORTED rather
 * than quietly scaled to fit.
 */
const budgeted: WeightNode[] = [
  node({ id: 'P', order: 1, price: 800 }),
  node({ id: 'P1', order: 2, parentId: 'P', isLeaf: true, workstepFactor: 0.25 }),
  node({ id: 'P2', order: 3, parentId: 'P', isLeaf: true, workstepFactor: 0.25 }),
  node({ id: 'P3', order: 4, parentId: 'P', isLeaf: true }),
  // A heading nobody budgeted, whose rows carry every budget between them.
  node({ id: 'Q', order: 5 }),
  node({ id: 'Q1', order: 6, parentId: 'Q', isLeaf: true, price: 120 }),
  node({ id: 'Q2', order: 7, parentId: 'Q', isLeaf: true, price: 80 }),
];
const bScreen = buildWeightsScreen(
  budgeted,
  new Map(budgeted.map((n) => [n.id, { code: n.id, name: 'Row ' + n.id }])),
  'IDR',
  1000
);
const card = (id: string) => bScreen.units.find((u) => u.id === id);
const rowIn = (unit: string, id: string) => card(unit)?.rows.find((r) => r.id === id);

check(
  'a heading nobody budgeted is worth what its rows are worth',
  Math.abs((card('Q')?.derivedValue ?? 0) - 200) < 0.01,
  'Q = ' + (card('Q')?.derivedValue ?? 0).toFixed(2) + ', while its own price is null'
);

check(
  'the screen can say what a heading has left to give out',
  (() => {
    const a = card('P')?.allocation;
    // 800 budget, two rows holding 25% each = 400 taken, 400 left, P3 empty.
    return a != null && Math.abs(a.budget - 800) < 0.01 && Math.abs(a.left - 400) < 0.01 && a.emptyLeaves === 1;
  })(),
  'budget ' + card('P')?.allocation?.budget + ' claimed ' + card('P')?.allocation?.claimed
);

check(
  "a row's own budget reaches the screen, and a row with none sends null",
  rowIn('P', 'P1')?.budget === 200 && rowIn('P', 'P3')?.budget === null
);

/** The same heading, over-subscribed by inherited data. The figures stand and the gap shows. */
const over = budgeted.map((n) => (n.id === 'P1' || n.id === 'P2' ? { ...n, workstepFactor: 0.7 } : n));
const oScreen = buildWeightsScreen(
  over,
  new Map(over.map((n) => [n.id, { code: n.id, name: 'Row ' + n.id }])),
  'IDR',
  1000
);
const oAlloc = oScreen.units.find((u) => u.id === 'P')?.allocation;

check(
  'rows claiming more than their heading holds are reported, not scaled back',
  (() => {
    const p1 = oScreen.units.find((u) => u.id === 'P')?.rows.find((r) => r.id === 'P1');
    // 70% of 800 stands at 560, untouched, and the heading is over by 320.
    return oAlloc != null && Math.abs(oAlloc.left + 320) < 0.01 && Math.abs((p1?.value ?? 0) - 560) < 0.01;
  })(),
  'left ' + oAlloc?.left.toFixed(2)
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
