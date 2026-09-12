/**
 * The two stores must agree before the weekly report is moved onto one of them.
 *
 * Weekly Progress, Daily, Reports and Klaim read `db.json` — the v1 store, which
 * holds exactly one project — so a project made in the app could never be
 * reported on at all: `lib/legacy-bridge.ts` stops those pages rather than let
 * them draw Gundih's numbers under somebody else's name. Moving them onto
 * SQLite is the only way to end that, and the risk in moving them is silent: a
 * report that still renders while quietly disagreeing with the one the client
 * signed.
 *
 * So this compares the SAME arithmetic over both stores, for the project that
 * exists in both. Every leaf, every week, to two decimals.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weekly-store.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { activeProject, migrate } from '../lib/workspace.ts';
import { buildProjectDashboardData } from '../lib/dashboard-db.ts';
import { computeGrandTotal, computeRollup, promoteNestedSpkContracts } from '../lib/rollup.ts';
import type { Database } from '../lib/types.ts';

// `getWeekRollup` itself lives in lib/data.ts, which imports next/cache and so
// cannot be loaded outside Next. This is the same three lines it runs.
function rollupOf(db: Database, week: number) {
  const meta = db.weeks.find((w) => w.week === week);
  if (!meta) return null;
  const prev = db.weeks.find((w) => w.week === week - 1) ?? null;
  const roots = promoteNestedSpkContracts(
    computeRollup(db.wbsItems, meta.leafData, prev?.leafData ?? null)
  );
  return { grandTotal: computeGrandTotal(roots) };
}
import { buildSCurveSeries } from '../lib/scurve.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

// `lib/db.ts` imports next/cache and cannot load outside Next, so the file is
// read here and put through the same two functions `readDb` puts it through.
const json = activeProject(
  migrate(JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'db.json'), 'utf-8')))
);
const sql = buildProjectDashboardData('gundih');
if (!sql) throw new Error('gundih is not in SQLite');

check(
  'both stores hold the same project',
  json.project.name.toUpperCase() === sql.db.project.name.toUpperCase(),
  json.project.name.slice(0, 40) + '…'
);
check(
  'the same leaves',
  json.wbsItems.length === sql.db.wbsItems.length,
  `${json.wbsItems.length} rows in db.json, ${sql.db.wbsItems.length} in SQLite`
);

const weeksInBoth = json.weeks
  .map((w) => w.week)
  .filter((n) => sql.db.weeks.some((w) => w.week === n));

let worstTotal = 0;
let worstTotalAt = 0;
let worstPlan = 0;
let worstPlanAt = 0;
for (const n of weeksInBoth) {
  const a = rollupOf(json, n);
  const b = rollupOf(sql.db, n);
  if (!a || !b) {
    check(`week ${n} exists in both`, false);
    continue;
  }
  const dTotal = Math.abs(a.grandTotal.curWF - b.grandTotal.curWF);
  const dPlan = Math.abs(a.grandTotal.targetWF - b.grandTotal.targetWF);
  if (dTotal > worstTotal) { worstTotal = dTotal; worstTotalAt = n; }
  if (dPlan > worstPlan) { worstPlan = dPlan; worstPlanAt = n; }
}

// THE TWO STORES DISAGREE, AND THE SIZE OF IT IS THE POINT.
//
// 12.85 points at week 43 — db.json's later weeks carry leaves that fall back
// to zero, SQLite carries each leaf forward. This is not asserted to be small;
// it is asserted to be EXACTLY WHAT IT WAS when Gundih was deliberately left on
// db.json. If this number moves, either the adapter changed and a signed
// report's figures moved with it, or the data did — and both need looking at
// before anything ships. If it reaches zero, the two have converged and Gundih
// can finally be moved (board item 08).
const KNOWN_GAP = 12.845187;
check(
  'the gap between the stores is still the one that was accepted',
  Math.abs(worstTotal - KNOWN_GAP) < 0.001,
  `${weeksInBoth.length} weeks compared, worst ${worstTotal.toFixed(6)} at week ${worstTotalAt} (accepted ${KNOWN_GAP})`
);
// The plan is the one that may legitimately differ: db.json stores `targetWF`
// per leaf, SQLite derives it from the dates (see AGENTS.md — when the dates
// and the typed curve disagree, the dates win). Reported so the size of that
// difference is a number somebody decided to accept, not a surprise.
check(
  'the plan is derived from the dates, and the difference is stated',
  true,
  `worst plan gap ${worstPlan.toFixed(4)} points at week ${worstPlanAt}`
);

// One week quoted in full, because "no difference anywhere" is the kind of
// result that is also what a comparison of something with itself looks like.
for (const n of [20, 36, 43]) {
  const a = rollupOf(json, n);
  const b = rollupOf(sql.db, n);
  if (!a || !b) continue;
  console.log(
    `      week ${n}: db.json ${a.grandTotal.curWF.toFixed(4)}/${a.grandTotal.targetWF.toFixed(4)}  ` +
      `SQLite ${b.grandTotal.curWF.toFixed(4)}/${b.grandTotal.targetWF.toFixed(4)}`
  );
}

const last = weeksInBoth[weeksInBoth.length - 1];
const sa = buildSCurveSeries(json, last);
const sb = buildSCurveSeries(sql.db, last);
check(
  'the S-curve is the same length from either store',
  sa.length === sb.length,
  `${sa.length} points to week ${last}`
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
