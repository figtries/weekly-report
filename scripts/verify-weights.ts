/**
 * Guards the money formula.
 *
 * Two things are asserted, and the second is the one that matters most.
 *
 * 1. The contract value derived from the reporting units matches the stored
 *    figure exactly. Units NEST — SPK-007 sits inside SPK-004 and is still its
 *    own contract — so this is the check that catches anyone "simplifying" the
 *    sum later.
 *
 * 2. Recomputing weights over Gundih would CHANGE them. That sounds like a
 *    failure and is the opposite: only 95 of its 176 stored leaf weights can be
 *    re-derived from its prices, because the construction rows carry weights
 *    that came from the workbook. If this assertion ever stops holding, either
 *    the data changed or someone made the recompute run silently — and a silent
 *    recompute here replaces correct figures with wrong ones and breaks a total
 *    that closes at exactly 100.000000.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weights.ts
 */
import Database from 'better-sqlite3';

import {
  computeContractValue,
  deriveWeights,
  previewWeights,
  summariseWeights,
  type WeightNode,
} from '../lib/weights.ts';

const db = new Database('data/report.db', { readonly: true });

function load(projectId: string): WeightNode[] {
  return db
    .prepare(
      `select id, parent_id, sort_order, price, workstep_factor, is_reporting_unit,
              unit_contract_value, bobot, is_leaf
       from wbs_nodes where project_id = ? order by sort_order`
    )
    .all(projectId)
    .map((row) => row as Record<string, unknown>)
    .map((r) => ({
      id: r.id as string,
      parentId: (r.parent_id as string) ?? null,
      order: r.sort_order as number,
      price: (r.price as number) ?? null,
      workstepFactor: (r.workstep_factor as number) ?? null,
      isReportingUnit: !!r.is_reporting_unit,
      unitContractValue: (r.unit_contract_value as number) ?? null,
      bobot: (r.bobot as number) ?? null,
      isLeaf: !!r.is_leaf,
    }));
}

let failed = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
  if (!ok) failed += 1;
};

const nodes = load('gundih');
const stored = db.prepare("select contract_value v, currency c from projects where id='gundih'").get() as {
  v: number;
  c: string;
};

const derived = computeContractValue(nodes);
check(
  'contract value from reporting units',
  Math.abs(derived - stored.v) < 0.01,
  `${derived.toFixed(4)} ${stored.c} vs stored ${stored.v.toFixed(4)}`
);

const storedTotal = nodes.filter((n) => n.isLeaf).reduce((s, n) => s + (n.bobot ?? 0), 0);
check(
  'stored leaf weights still close at 100',
  Math.abs(storedTotal - 100) < 1e-6,
  storedTotal.toFixed(6)
);

const { changes, result } = previewWeights(nodes);
check(
  'recompute over an imported project is NOT a no-op',
  changes.length > 0,
  `${changes.length} of ${result.leaves} leaves would move — which is why it must never run silently`
);
check(
  'derived total is reported as partial, not passed off as 100',
  result.basis === 'partial',
  `basis=${result.basis}, derived total ${result.total.toFixed(4)}, covers ${result.covered}/${result.leaves}`
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
  `total ${s.total.toFixed(9)}, basis ${s.basis}, contract ${s.contractValue}`
);
check(
  'workstep splits its parent, not the contract',
  Math.abs((s.bobotOf.get('b1') ?? 0) - 35) < 1e-9,
  `b1 = ${(s.bobotOf.get('b1') ?? 0).toFixed(6)} (700000 × 0.5 ÷ 1000000 × 100 = 35)`
);

// No prices at all: even weights, labelled as such rather than pretending.
const unpriced = synthetic.map((n) => ({ ...n, price: null, workstepFactor: null }));
const e = deriveWeights(unpriced);
check(
  'a plan with no prices spreads evenly and says so',
  e.basis === 'even' && Math.abs(e.total - 100) < 1e-9,
  `basis ${e.basis}, total ${e.total.toFixed(6)} across ${e.leaves} leaves`
);

/* -------------------------------------------------- signed vs allocated (②) */

const summary = summariseWeights(nodes, stored.c, stored.v);
check(
  'allocation reconciles with the signed contract',
  Math.abs(summary.gap) < 0.01,
  `signed ${summary.contractValue.toFixed(4)} − allocated ${summary.allocated.toFixed(4)} = ${summary.gap.toFixed(4)}`
);
check(
  'a NESTED reporting unit counts as its own contract',
  Math.abs(summary.unitTotal - summary.contractValue) < 0.01,
  `SPK-007 sits inside SPK-004; treating its ${842723.72448.toFixed(2)} as nested lost exactly that from the total`
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

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
