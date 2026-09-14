/**
 * Proves the two claims the Weights screen makes to the person using it.
 *
 * One: type a price on SOME rows and the total still closes at 100. Two: a row
 * you never priced is not blank — it takes a share, and the screen can say
 * WHICH KIND of share so the label is not a lie.
 *
 * That third state is why `WeightResult.fromGap` could not be used directly.
 * It is a COUNT, and it counts only the leaves reached by splitting the
 * CONTRACT's leftover — not the far more common case of a leaf sitting under a
 * priced SPK that simply has no price of its own. And a leaf with a
 * `workstepFactor` (Gundih's 0.5 / 0.3 / 0.2 for IFR / IFA / AFC) takes a
 * STATED fraction, not an even share; calling that "even" on screen would be
 * telling someone their number was a guess when it was not.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weights-screen.ts
 */
import type { WeightNode } from '../lib/weights.ts';
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
 * A is priced all the way down. B carries its own value but nobody has priced
 * a single row inside it — which is the state every project made in this app
 * starts in, and the state the screen exists to get someone out of.
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

check('both SPK are found', screen.units.length === 2 && screen.hasUnits, `${screen.units.length} units`);

check(
  'the total closes at 100 with only half the rows priced',
  Math.abs(total - 100) < 0.01,
  `total ${total.toFixed(4)}`
);

check(
  'a priced leaf is weighted by its own price',
  Math.abs((by('A1')?.bobotOverall ?? 0) - 40) < 0.01,
  `A1 ${by('A1')?.bobotOverall.toFixed(2)}`
);

check(
  'an unpriced leaf is never blank',
  ['B1', 'B2'].every((id) => (by(id)?.bobotOverall ?? 0) > 0),
  `B1 ${by('B1')?.bobotOverall.toFixed(2)}, B2 ${by('B2')?.bobotOverall.toFixed(2)}`
);

check(
  'the screen can name which kind of share each row took',
  by('A1')?.share === 'price' && by('B1')?.share === 'even' && by('B2')?.share === 'even',
  `A1=${by('A1')?.share} B1=${by('B1')?.share} B2=${by('B2')?.share}`
);

check(
  'weight within an SPK is measured against that SPK, not the project',
  Math.abs((by('A1')?.bobotInUnit ?? 0) - 66.6667) < 0.01,
  `A1 in-unit ${by('A1')?.bobotInUnit.toFixed(4)}, overall ${by('A1')?.bobotOverall.toFixed(4)}`
);

check(
  "each SPK's own rows add up to 100 within it",
  screen.units.every(
    (u) => Math.abs(u.rows.filter((r) => r.isLeaf).reduce((s, r) => s + r.bobotInUnit, 0) - 100) < 0.01
  )
);

/**
 * A stated fraction is not an even share, and the label must not say it is.
 * Gundih carries 0.5 / 0.3 / 0.2 on IFR / IFA / AFC, so this is the real shape
 * of an engineering leaf, not a hypothetical.
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
  'a row with a workstep factor is not called an even share',
  frows.length === 3 && frows.every((r) => r.share === 'factor'),
  frows.map((r) => `${r.id}=${r.share}`).join(' ')
);

check(
  'and it takes the fraction it states',
  Math.abs((frows.find((r) => r.id === 'C1')?.bobotOverall ?? 0) - 50) < 0.01,
  `C1 ${frows.find((r) => r.id === 'C1')?.bobotOverall.toFixed(2)}`
);

/** No prices at all: every leaf counts the same, and the total still closes. */
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
  'a plan with no prices at all still shows a weight on every row',
  !evenScreen.hasUnits &&
    erows.length === 2 &&
    erows.every((r) => Math.abs(r.bobotOverall - 50) < 0.01 && r.share === 'even'),
  erows.map((r) => `${r.id}=${r.bobotOverall.toFixed(2)}/${r.share}`).join(' ')
);

/**
 * A FLAT plan: every top-level row is a leaf, nothing nested under anything.
 *
 * This is what a project made in the app looks like before anyone indents a
 * row, and the first version of this screen showed thirteen cards all reading
 * 0.00% and "0 of 0 rows priced" on exactly such a project. The cards were
 * built from the top-level rows and then filled with their DESCENDANTS, and a
 * leaf has none — so every card excluded the only row it was about.
 *
 * Same trap as `assignColorGroups`, which took the top rows as packages
 * without checking they were branches. A card is a BRANCH. A top-level leaf is
 * a row, and it belongs in `looseRows` where it can be given a price.
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

check(
  'a flat plan makes no empty cards',
  flatScreen.units.length === 0,
  `${flatScreen.units.length} cards`
);

check(
  'its rows are reachable, and priceable, on the first screen',
  flatScreen.looseRows.length === 3 && flatScreen.looseRows.every((r) => r.bobotOverall > 0),
  flatScreen.looseRows.map((r) => `${r.id}=${r.bobotOverall.toFixed(2)}`).join(' ')
);

check(
  'and a flat plan still closes at 100',
  Math.abs(flatScreen.looseRows.reduce((s, r) => s + r.bobotOverall, 0) - 100) < 0.01,
  `total ${flatScreen.looseRows.reduce((s, r) => s + r.bobotOverall, 0).toFixed(4)}`
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
 * A heading with a budget, and rows that take shares of it.
 *
 * The state the screen was rebuilt for on 14 Sep 2026, and the three things it
 * has to get right: the card's money must be its ROWS added up rather than the
 * heading row's own price, a stated percent must be a percent of the heading's
 * whole budget, and rows claiming more than the heading holds must be REPORTED
 * rather than quietly scaled to fit.
 */
const budgeted: WeightNode[] = [
  node({ id: 'P', order: 1, price: 800 }),
  node({ id: 'P1', order: 2, parentId: 'P', isLeaf: true, workstepFactor: 0.25 }),
  node({ id: 'P2', order: 3, parentId: 'P', isLeaf: true, workstepFactor: 0.25 }),
  node({ id: 'P3', order: 4, parentId: 'P', isLeaf: true }),
  // A heading nobody priced, whose rows carry every price between them. This
  // is the card that used to read 'No value yet' beside a real percentage.
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
  'a heading nobody priced is worth what its rows are worth',
  Math.abs((card('Q')?.derivedValue ?? 0) - 200) < 0.01,
  'Q = ' + (card('Q')?.derivedValue ?? 0).toFixed(2) + ', while its own price is null'
);

check(
  'a stated percent takes that share of the whole budget',
  Math.abs((rowIn('P', 'P1')?.value ?? 0) - 200) < 0.01,
  'P1 = 25% of 800 = ' + (rowIn('P', 'P1')?.value ?? 0).toFixed(2)
);

check(
  'the screen can say what a heading has left to give out',
  (() => {
    const a = card('P')?.allocation;
    // 800 budget, two rows stating 25% each = 400 claimed, 400 left for P3.
    return (
      a != null &&
      Math.abs(a.budget - 800) < 0.01 &&
      Math.abs(a.left - 400) < 0.01 &&
      a.openChildren === 1
    );
  })(),
  'budget ' + card('P')?.allocation?.budget + ' claimed ' + card('P')?.allocation?.claimed
);

check(
  'a row states its percent back, and a row that states none says so',
  rowIn('P', 'P1')?.percentOfParent === 25 && rowIn('P', 'P3')?.percentOfParent === null
);

/** The same heading, over-subscribed. The figures must stand and the gap show. */
const over = budgeted.map((n) =>
  n.id === 'P1' || n.id === 'P2' ? { ...n, workstepFactor: 0.7 } : n
);
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
    return (
      oAlloc != null &&
      Math.abs(oAlloc.left + 320) < 0.01 &&
      Math.abs((p1?.value ?? 0) - 560) < 0.01 &&
      Math.abs(oAlloc.statedFraction - 1.4) < 1e-9
    );
  })(),
  'left ' + oAlloc?.left.toFixed(2) + ', rows state ' + ((oAlloc?.statedFraction ?? 0) * 100).toFixed(0) + '%'
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
