/**
 * Proves the imported model reproduces a report the client has already signed.
 *
 * This is the half of item 06 that matters. The importer only moves numbers;
 * this script asks whether our arithmetic — weights derived from prices, a plan
 * curve derived from dates, reporting units that nest — arrives at the same
 * table as `PRGG-00-G0-RPT-002 W43`, page 8.
 *
 * It reads ONLY the database. Nothing here touches the workbook, so a pass
 * means the stored model stands on its own.
 *
 * Run: node scripts/verify-import.ts
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '../lib/schema.ts';
import { leafPlanFraction } from '../lib/plan-curve.ts';

const DB_PATH = process.env.REPORT_DB_PATH || path.join(process.cwd(), 'data', 'report.db');
const sqlite = new Database(DB_PATH, { readonly: true });
const db = drizzle(sqlite, { schema });

const PROJECT_ID = 'gundih';
const WEEK = 43;

/**
 * Read straight off page 8 of the signed PDF. `target` is the one figure we do
 * NOT expect to match: it comes from the workbook's hand-maintained PLAN
 * columns, which contradict the dates beside them on 126 of 176 leaves. Ours is
 * derived from the dates, by decision.
 */
const PDF = {
  units: [
    { label: 'SPK-002', bobot: 7.07, progress: 100.00, wf: 7.07, target: 7.07, variance: 0.00 },
    { label: 'SPK-003', bobot: 47.65, progress: 97.56, wf: 46.49, target: 47.65, variance: -1.16 },
    { label: 'SPK-004', bobot: 31.04, progress: 67.42, wf: 20.93, target: 14.83, variance: 6.10 },
    { label: 'SPK-007', bobot: 14.24, progress: 39.00, wf: 5.55, target: 5.59, variance: -0.04 },
  ],
  total: { bobot: 100.00, wf: 80.04, target: 75.15, variance: 4.89 },
};

/** Two decimals is what the report prints, so two decimals is what we compare. */
const EPS = 0.005;

interface Leaf {
  wbsCode: string;
  bobot: number;
  pct: number;
  start: string | null;
  finish: string | null;
}

function load() {
  const nodes = db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.projectId, PROJECT_ID)).all();
  const week = db.select().from(schema.weeks)
    .where(eq(schema.weeks.id, `${PROJECT_ID}:W${WEEK}`)).all()[0];
  const progress = db.select().from(schema.leafProgress)
    .where(eq(schema.leafProgress.weekId, `${PROJECT_ID}:W${WEEK}`)).all();

  const pctByNode = new Map(progress.map((p) => [p.nodeId, p.cumProgressPct]));

  const scheduleFor = (kind: 'contractual' | 'active') => {
    const rows = db.select().from(schema.nodeSchedules)
      .where(eq(schema.nodeSchedules.baselineId, `${PROJECT_ID}:${kind}`)).all();
    return new Map(rows.map((s) => [s.nodeId, s]));
  };

  return { nodes, week, pctByNode, contractual: scheduleFor('contractual'), active: scheduleFor('active') };
}

/**
 * A reporting unit owns its subtree MINUS any reporting unit nested inside it.
 * SPK-007 sits at 1.4.4, inside SPK-004's 1.4, and both are reported. Without
 * the subtraction SPK-007 is counted twice and the project total reaches 114%.
 */
function leavesOfUnit(
  nodes: ReturnType<typeof load>['nodes'],
  unitCode: string,
  allUnitCodes: string[],
  pct: Map<string, number>,
  sched: Map<string, { startDate: string; finishDate: string }>,
): Leaf[] {
  const nested = allUnitCodes.filter((c) => c !== unitCode && c.startsWith(`${unitCode}.`));
  return nodes
    .filter((n) => n.bobot !== null && n.bobot > 0)
    .filter((n) => n.wbsCode === unitCode || n.wbsCode.startsWith(`${unitCode}.`))
    .filter((n) => !nested.some((c) => n.wbsCode === c || n.wbsCode.startsWith(`${c}.`)))
    .map((n) => {
      const s = sched.get(n.id);
      return {
        wbsCode: n.wbsCode,
        bobot: n.bobot!,
        pct: pct.get(n.id) ?? 0,
        start: s?.startDate ?? null,
        finish: s?.finishDate ?? null,
      };
    });
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function plannedWF(leaves: Leaf[], asOf: string) {
  return sum(leaves.map((l) => (l.start && l.finish ? l.bobot * leafPlanFraction(l.start, l.finish, asOf) : 0)));
}

let failed = 0;
function check(label: string, got: number, want: number, eps = EPS) {
  const ok = Math.abs(got - want) <= eps;
  if (!ok) failed++;
  return `${ok ? '✓' : '✗'} ${label} ${got.toFixed(2)} (pdf ${want.toFixed(2)})`;
}

/* ------------------------------------------------------------------ run */

const { nodes, week, pctByNode, contractual, active } = load();
if (!week) throw new Error(`minggu W${WEEK} tidak ada di database — jalankan import-gundih.ts dulu`);

const unitNodes = nodes.filter((n) => n.isReportingUnit).sort((a, b) => a.order - b.order);
const unitCodes = unitNodes.map((n) => n.wbsCode);

console.log(`Ringkasan W${WEEK}  ${week.startDate} → ${week.endDate}`);
console.log('dihitung dari database, dibandingkan dengan PDF PRGG-00-G0-RPT-002 W43 hal. 8\n');
console.log('  unit      bobot            progress         WF kumulatif');
console.log('  ' + '-'.repeat(76));

let totalWF = 0;
let totalBobot = 0;
const perUnitTarget: Array<{ label: string; contractual: number; active: number; pdf: number }> = [];

for (const [i, unit] of unitNodes.entries()) {
  const expected = PDF.units[i];
  const leaves = leavesOfUnit(nodes, unit.wbsCode, unitCodes, pctByNode, contractual);
  const leavesActive = leavesOfUnit(nodes, unit.wbsCode, unitCodes, pctByNode, active);

  const bobot = sum(leaves.map((l) => l.bobot));
  const wf = sum(leaves.map((l) => (l.bobot * l.pct) / 100));
  const progress = bobot === 0 ? 0 : (wf / bobot) * 100;

  totalBobot += bobot;
  totalWF += wf;
  perUnitTarget.push({
    label: expected.label,
    contractual: plannedWF(leaves, week.endDate),
    active: plannedWF(leavesActive, week.endDate),
    pdf: expected.target,
  });

  console.log(
    `  ${expected.label.padEnd(9)} ${check('', bobot, expected.bobot).padEnd(24)}` +
    `${check('', progress, expected.progress).padEnd(24)}${check('', wf, expected.wf)}`,
  );
}

console.log('  ' + '-'.repeat(76));
console.log(`  TOTAL     ${check('', totalBobot, PDF.total.bobot).padEnd(24)}${' '.repeat(24)}${check('', totalWF, PDF.total.wf)}`);

/* --------------------------------------------------- the derived target */

const allLeaves = nodes
  .filter((n) => n.bobot !== null && n.bobot > 0)
  .map((n) => {
    const c = contractual.get(n.id);
    const a = active.get(n.id);
    return { node: n, c, a };
  });

const targetContractual = sum(allLeaves.map(({ node, c }) => (c ? node.bobot! * leafPlanFraction(c.startDate, c.finishDate, week.endDate) : 0)));
const targetActive = sum(allLeaves.map(({ node, a }) => (a ? node.bobot! * leafPlanFraction(a.startDate, a.finishDate, week.endDate) : 0)));

console.log('\nTarget — diturunkan dari tanggal, bukan disalin dari kolom PLAN:');
console.log('  unit       kontraktual   aktif      pdf');
for (const t of perUnitTarget) {
  console.log(`  ${t.label.padEnd(10)} ${t.contractual.toFixed(2).padStart(10)}  ${t.active.toFixed(2).padStart(9)}  ${t.pdf.toFixed(2).padStart(7)}`);
}
console.log(`  ${'TOTAL'.padEnd(10)} ${targetContractual.toFixed(2).padStart(10)}  ${targetActive.toFixed(2).padStart(9)}  ${PDF.total.target.toFixed(2).padStart(7)}`);
console.log(`\n  deviasi (aktual − target kontraktual)  ${(totalWF - targetContractual >= 0 ? '+' : '')}${(totalWF - targetContractual).toFixed(2)}%   pdf ${PDF.total.variance >= 0 ? '+' : ''}${PDF.total.variance.toFixed(2)}%`);

/* ------------------------------------------------------------ verdict */

console.log('');
if (failed === 0) {
  console.log('✓ bobot, progress dan WF kumulatif cocok dengan laporan yang sudah ditandatangani');
  console.log(`✓ bobot menutup di ${totalBobot.toFixed(6)}% — unit bersarang tidak terhitung dua kali`);
  console.log(`\nTarget kita ${targetContractual.toFixed(2)}% vs PDF ${PDF.total.target.toFixed(2)}% — selisih ${(targetContractual - PDF.total.target).toFixed(2)} poin,`);
  console.log('karena kolom PLAN workbook bertentangan dengan tanggalnya sendiri. Tanggal yang dipakai.');
} else {
  console.log(`${failed} pemeriksaan gagal.`);
  process.exitCode = 1;
}

sqlite.close();
