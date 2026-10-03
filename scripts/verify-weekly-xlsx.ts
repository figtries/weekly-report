/**
 * Proves the weekly Excel export (3 Oct 2026, spec
 * docs/superpowers/specs/2026-10-03-weekly-excel-export-design.md).
 *
 * The look is the sample's and the content is the app's, so this checks the
 * content against the app's own readers, on Merbau (four flagged packages) and
 * PHSS Samberah (none flagged, packages are the plan's top branches):
 *
 *   1. the gathered input: Summary rows are the Summary cards' groups, each WF
 *      column adds to its printed total, Detail Overall's total is the grand
 *      total, every package's Detail closes at 100% and lands on its card's
 *      progress, the S-curve is the screen's series, sheet names fit Excel
 *   2. the workbook (from Task 4 on): read back by ExcelJS as an independent
 *      parser, every cell equals the input and no cell holds a formula
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weekly-xlsx.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';
import type { Database } from '../lib/types.ts';

const work = path.join(os.tmpdir(), `verify-weekly-xlsx-${process.pid}.db`);
copyDbFixture('data/report.db', work);
process.env.REPORT_DB_PATH = work;

const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const { r2 } = await import('../lib/figures.ts');
const { computeRollup, computeGrandTotal, summariseUnits, promoteNestedSpkContracts } = await import('../lib/rollup.ts');
const { buildSCurveSeries } = await import('../lib/scurve.ts');
const { weightGate } = await import('../lib/weight-gate.ts');
const W = await import('../lib/xlsx/weekly-input.ts');

let failed = 0;
let passed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) passed += 1;
  else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? '  ' + detail : ''}`);
  }
};
const sum = (xs: number[]) => r2(xs.reduce((s, v) => s + v, 0));

// lib/data.ts's own getWeekRollup, without the Next.js cache imports around it.
const rootsOf = (d: Database, week: number) => {
  const meta = d.weeks.find((x) => x.week === week);
  if (!meta) return null;
  const prev = d.weeks.find((x) => x.week === week - 1);
  return promoteNestedSpkContracts(computeRollup(d.wbsItems, meta.leafData, prev?.leafData ?? null));
};

export const PROJECTS: Array<{ id: string; name: string; unflag?: boolean }> = [
  { id: 'pdemo-merbau', name: 'Merbau' },
  { id: 'pmtygg3od7c19', name: 'PHSS Samberah' },
  // Merbau with no unit flagged: packages fall back to the plan's top branches.
  { id: 'pdemo-merbau', name: 'Merbau unflagged', unflag: true },
];

export interface Case {
  name: string;
  db: Database;
  week: number;
  input: ReturnType<typeof W.gatherWeeklyExport>;
}
export const cases: Case[] = [];

for (const proj of PROJECTS) {
  const data = buildProjectDashboardData(proj.id);
  if (!data) {
    console.log(`SKIP  ${proj.name}: not in data/report.db`);
    continue;
  }
  const db: Database = proj.unflag
    ? { ...data.db, wbsItems: data.db.wbsItems.map((i) => ({ ...i, isReportingUnit: false })) }
    : data.db;
  if (!weightGate(db.wbsItems).ok) {
    console.log(`SKIP  ${proj.name}: weights do not close`);
    continue;
  }
  const week = db.project.currentWeek;
  const roots = rootsOf(db, week);
  if (!roots) throw new Error(`${proj.name} has no week ${week}`);
  const input = W.gatherWeeklyExport({ db, roots, week, photoSlots: ['a.jpg', null, 'b.jpg'] });
  cases.push({ name: proj.name, db, week, input });
  const tag = `${proj.name} W${week}`;

  // Summary = the Summary cards
  const groups = summariseUnits(roots).rows;
  check(`${tag}: one Summary row per card`, input.summary.rows.length === groups.length);
  input.summary.rows.forEach((row, i) => {
    check(`${tag}: row ${i + 1} name`, row.text === groups[i].deskripsi.trim().toUpperCase());
    check(`${tag}: row ${i + 1} progress`, row.curProgress === r2(groups[i].curProgressPct));
    check(`${tag}: row ${i + 1} this week = cum - last`, row.thisWF === r2(row.curWF - row.prevWF));
    check(`${tag}: row ${i + 1} variance = cum - target`, row.variance === r2(row.curWF - row.target));
  });
  const t = input.summary.total;
  for (const col of ['bobot', 'prevWF', 'thisWF', 'curWF', 'target', 'variance'] as const) {
    check(`${tag}: Summary ${col} adds to its total`, sum(input.summary.rows.map((r) => r[col])) === t[col], `${sum(input.summary.rows.map((r) => r[col]))} vs ${t[col]}`);
  }
  const gt = computeGrandTotal(roots);
  check(`${tag}: total actual = the grand total`, t.curProgress === r2(gt.curProgressPct), `${t.curProgress} vs ${r2(gt.curProgressPct)}`);
  check(`${tag}: total plan WF = the grand total`, t.target === r2(gt.targetWF));

  // Detail Overall
  const d = input.detail.overall;
  check(`${tag}: Detail Overall has every WBS row`, d.lines.length === db.wbsItems.length, `${d.lines.length} vs ${db.wbsItems.length}`);
  check(`${tag}: Detail Overall total = Summary total`, JSON.stringify(d.total) === JSON.stringify(t));
  check(`${tag}: no heading carries progress`, d.lines.every((l) => l.kind === 'activity' || l.figures === null));
  check(`${tag}: indentation is 3 spaces per depth`, d.lines.every((l) => /^( {3})*\S/.test(l.text)));

  // Detail per package
  for (const pkg of input.packages) {
    const sheet = input.detail.byPackage.get(pkg.key)!;
    const card = groups.find((g) => g.key === pkg.key)!;
    check(`${tag}: ${pkg.sheetSuffix} closes at 100`, sheet.total.bobot === 100);
    check(`${tag}: ${pkg.sheetSuffix} total = its card`, sheet.total.curProgress === r2(card.curProgressPct), `${sheet.total.curProgress} vs ${r2(card.curProgressPct)}`);
    const activities = sheet.lines.filter((l) => l.figures);
    check(`${tag}: ${pkg.sheetSuffix} activity weights add to ~100`, Math.abs(sum(activities.map((l) => l.figures!.bobot)) - 100) < 0.01 * activities.length + 0.001);
    check(`${tag}: ${pkg.sheetSuffix} has rows`, activities.length > 0);
  }

  // Names
  check(`${tag}: sheet names fit Excel`, input.packages.every((p) => ('S-Curve ' + p.sheetSuffix).length <= 31 && !/[[\]:*?/\\]/.test(p.sheetSuffix)));
  check(`${tag}: sheet names unique`, new Set(input.packages.map((p) => p.sheetSuffix.toLowerCase())).size === input.packages.length);

  // S-curve = the screen's series
  check(`${tag}: S-curve overall = the screen`, JSON.stringify(input.scurve.overall) === JSON.stringify(buildSCurveSeries(db, week)));
  check(`${tag}: one week end per week, plus the start`, input.scurve.weekEnds.length === week + 1);
  for (const pkg of input.packages) {
    const s = input.scurve.byPackage.get(pkg.key);
    check(`${tag}: ${pkg.sheetSuffix} curve has every week`, !!s && s.length === input.scurve.overall.length);
    const last = s?.[s.length - 1];
    const card = groups.find((g) => g.key === pkg.key)!;
    if (last && last.actualPct !== null) check(`${tag}: ${pkg.sheetSuffix} curve ends on its card`, r2(last.actualPct) === r2(card.curProgressPct));
  }
  check(`${tag}: photos keep slot order without blanks`, JSON.stringify(input.photos) === '["a.jpg","b.jpg"]');
  console.log(`${tag}: ${input.packages.map((p) => p.sheetSuffix).join(' | ')}`);
}

// Selection and names round-trip
const sel = { documentation: true, summary: false, detail: ['overall', '(SPK-002)'], scurve: ['x&y'] };
check('selection round-trips', JSON.stringify(W.parseSelection(new URLSearchParams(W.selectionQuery(sel)))) === JSON.stringify(sel));
const taken = new Set<string>();
const a = W.sheetSuffix('A very long work package name that never ends here', taken);
const b = W.sheetSuffix('A very long work package name that never ends here', taken);
check('long suffix is cut', a.length <= 23, a);
check('duplicate suffix is numbered', b !== a && b.endsWith('(2)'), b);
check('file name', W.weeklyFileName('PRGG-00-G0-RPT-002', 45, '2026-09-03') === 'PRGG-00-G0-RPT-002_WEEKLY PROGRESS REPORT W45 (Overall)_030926.xlsx');

if (process.argv[1]?.endsWith('verify-weekly-xlsx.ts')) {
  const { verifyWorkbooks } = await import('./verify-weekly-xlsx-book.ts').catch(() => ({ verifyWorkbooks: null }));
  if (verifyWorkbooks) {
    const r = await verifyWorkbooks(cases, check);
    void r;
  } else console.log('(workbook checks not written yet)');
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
