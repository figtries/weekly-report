/**
 * Proves the dashboard's figures agree with each other, week by week, the way
 * a person checking the screen with a calculator would find them (26 Sep 2026).
 *
 * Builds a throwaway copy of data/report.db, gives PHSS Samberah (weights close
 * at 100%) fourteen weeks of progress through the app's own write path — one
 * item slipping back in week 12 — and then asserts, for every week:
 *
 *   1. deviation  = actual − plan, as printed
 *   2. the items explaining the deviation add up to it exactly
 *   3. By section shares add to 100 and its figures to the deviation
 *   4. What moved adds up to "added this week"
 *   5. added − plan added = lead change
 *   6. the S-curve's plan point is the hero's plan
 *
 * and that the weight gate refuses a plan with an unbudgeted activity but lets
 * a weightless MILESTONE through.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-dashboard-figures.ts
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';
import type { Database } from '../lib/types.ts';

const work = path.join(os.tmpdir(), `verify-dashboard-figures-${process.pid}.db`);
copyDbFixture('data/report.db', work);
process.env.REPORT_DB_PATH = work;

const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const { saveWeekUpdatesSqlite } = await import('../lib/progress-sqlite.ts');
const { computeHealth, contributions, weekMovers } = await import('../lib/analysis.ts');
const { apportion, r2, shownDiff } = await import('../lib/figures.ts');
const { computeRollup, summariseUnits, promoteNestedSpkContracts, flattenTree } = await import('../lib/rollup.ts');
// lib/data.ts's own getWeekRollup, without the Next.js cache imports around it.
const getWeekRollup = (d: Database, week: number) => {
  const meta = d.weeks.find((x) => x.week === week);
  if (!meta) return null;
  const prevMeta = d.weeks.find((x) => x.week === week - 1);
  return { roots: promoteNestedSpkContracts(computeRollup(d.wbsItems, meta.leafData, prevMeta?.leafData ?? null)) };
};
const { buildSCurveSeries } = await import('../lib/scurve.ts');
const { weightGate } = await import('../lib/weight-gate.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (!ok) {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`);
  }
};
const sum = (xs: number[]) => r2(xs.reduce((s, v) => s + v, 0));

const PID = 'pmtygg3od7c19';
const first = buildProjectDashboardData(PID);
if (!first) throw new Error('PHSS Samberah is not in data/report.db');
const leaves = first.db.wbsItems.filter((i) => !first.db.wbsItems.some((c) => c.parentId === i.id));
check('Samberah passes the weight gate', weightGate(first.db.wbsItems).ok);

const factor = [1.35, 0.7, 1.1, 0.5, 1.25, 0.9, 1.6, 0.8, 1.0, 0.6, 1.4, 1.15, 0.75];
const prev = new Map<string, number>();
for (let w = 1; w <= 14; w++) {
  const meta = first.db.weeks.find((x) => x.week === w)!;
  const updates: Record<string, { cumProgressPct: number }> = {};
  leaves.forEach((l, i) => {
    const plan = l.bobot > 0 ? ((meta.leafData[l.id]?.targetWF ?? 0) / l.bobot) * 100 : 0;
    let pct = Math.min(100, Math.round((plan * factor[i % factor.length]) / 5) * 5);
    const was = prev.get(l.id) ?? 0;
    pct = w === 12 && i === 2 && was >= 10 ? was - 10 : Math.max(pct, was);
    if (pct !== was) updates[l.id] = { cumProgressPct: pct };
    prev.set(l.id, pct);
  });
  if (Object.keys(updates).length) saveWeekUpdatesSqlite(PID, w, updates);
}

const db = buildProjectDashboardData(PID)!.db;
let weeksChecked = 0;
for (let w = 1; w <= 14; w++) {
  const h = computeHealth(db, w)!;
  const rollup = getWeekRollup(db, w)!;
  const tag = `week ${w}`;

  check(`${tag}: deviation = actual − plan`, h.deviationPct === shownDiff(h.actualPct, h.planPct));

  const parts = contributions(rollup.roots, h.deviationPct);
  check(`${tag}: contributions add up to the deviation`, sum(parts.map((c) => c.share)) === h.deviationPct,
    `${sum(parts.map((c) => c.share))} vs ${h.deviationPct}`);

  const weighted = flattenTree(rollup.roots).filter((n) => n.isLeaf && n.bobot > 0);
  const total = weighted.reduce((s, n) => s + n.bobot, 0);
  const { rows } = summariseUnits(promoteNestedSpkContracts(rollup.roots));
  const covered = Math.abs(rows.reduce((s, r) => s + r.bobot, 0) - total) < 1e-6;
  if (covered && rows.length > 1) {
    const shares = apportion(rows.map((r) => (r.bobot / total) * 100), 100);
    const devs = apportion(rows.map((r) => (r.variance / total) * 100), h.deviationPct);
    check(`${tag}: section shares add to 100`, sum(shares) === 100, String(sum(shares)));
    check(`${tag}: section figures add to the deviation`, sum(devs) === h.deviationPct);
  }

  const movers = weekMovers(rollup.roots, h.addedPct, db.weeks.find((x) => x.week === w)!.leafData);
  if (movers.length) {
    check(`${tag}: what moved adds up to added this week`, sum(movers.map((m) => m.share)) === h.addedPct,
      `${sum(movers.map((m) => m.share))} vs ${h.addedPct}`);
  }
  check(`${tag}: added − plan added = lead change`, shownDiff(h.addedPct, h.planAddedPct) === h.deviationChange);
  check(`${tag}: last week's figures are last week's`, h.prevActualPct === (w > 1 ? computeHealth(db, w - 1)!.actualPct : 0));

  const curve = buildSCurveSeries(db, w);
  check(`${tag}: S-curve plan point is the hero's plan`, r2(curve[curve.length - 1].planPct ?? -1) === h.planPct);
  weeksChecked += 1;
}

const back = weekMovers(getWeekRollup(db, 12)!.roots, computeHealth(db, 12)!.addedPct, db.weeks.find((x) => x.week === 12)!.leafData);
check('week 12: the slipped item is listed as going backwards', back.some((m) => m.curPct < m.prevPct && m.share < 0));

// The gate: an unbudgeted activity fails it, a weightless milestone does not.
const items = db.wbsItems.map((i) => ({ ...i }));
const leafIds = new Set(items.filter((i) => !items.some((c) => c.parentId === i.id)).map((i) => i.id));
const extra = { ...items.find((i) => leafIds.has(i.id))!, id: 'extra-leaf', bobot: 0, order: 99999 };
check('gate refuses an activity with no budget', !weightGate([...items, { ...extra, isMilestone: false }]).ok);
check('gate lets a weightless milestone through', weightGate([...items, { ...extra, isMilestone: true }]).ok);
check('gate refuses a total short of 100', !weightGate(items.map((i) => (i.id === [...leafIds][0] ? { ...i, bobot: i.bobot / 2 } : i))).ok);

// The app's connection still holds the file open; on Windows that refuses the
// delete, and the OS temp folder will have it.
for (const suffix of ['', '-wal', '-shm']) {
  try {
    fs.rmSync(work + suffix, { force: true });
  } catch {}
}

console.log(`${weeksChecked} weeks checked, ${failed} failures`);
process.exit(failed ? 1 : 0);
