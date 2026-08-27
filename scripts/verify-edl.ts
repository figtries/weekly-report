/**
 * Proves the document register agrees with itself, and shows how it lines up
 * with the engineering leaves in the physical WBS.
 *
 * Two questions, in order:
 *
 *   1. Did we read the register correctly? Recount how many documents have
 *      reached each stage and recompute each category's percent, then compare
 *      against "EDL Summary"'s own columns. This is the register checking our
 *      arithmetic against the client's.
 *   2. Does the register agree with the report? The WBS carries IFR/IFA/AFC
 *      leaves per discipline whose figure is supposed to BE the register's
 *      figure. Decision 17 says the register wins and the leaves stop being
 *      typed — but the two have to be compared before that switch is safe.
 *
 * Run: node scripts/verify-edl.ts
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';

import * as schema from '../lib/schema.ts';
import { readEdlWorkbook, isLeafCategory } from './edl-source.ts';

const DB_PATH = process.env.REPORT_DB_PATH || path.join(process.cwd(), 'data', 'report.db');
const sqlite = new Database(DB_PATH, { readonly: true });
const db = drizzle(sqlite, { schema });

const DEFAULT_FILE =
  'C:/Users/LENOVO/Downloads/PRGG-00-G0-LS-003~W13 _Engineering Drawing List_Update_15012026 R2.xlsx';

const PROJECT_ID = 'gundih';
/** The register on file is dated 15 Jan 2026, which is week 13. */
const REGISTER_WEEK = 13;
const EPS = 0.0005;

/**
 * Which EDL branch supplies which WBS discipline. Read off the two trees, not
 * guessed: the WBS names its Detail Engineering children General / Process /
 * Mechanical / Electrical / Instrument, and the register groups its categories
 * under exactly those headings.
 */
const DISCIPLINES = [
  { wbs: '1.2.1.2.1', name: 'General', edl: 'A' },
  { wbs: '1.2.1.2.2', name: 'Process', edl: 'B.1' },
  { wbs: '1.2.1.2.3', name: 'Mechanical', edl: 'B.2' },
  { wbs: '1.2.1.2.4', name: 'Electrical', edl: 'B.3' },
  { wbs: '1.2.1.2.5', name: 'Instrument', edl: 'B.4' },
];

const WEIGHTED_STAGES = ['IFR', 'IFA', 'AFC'] as const;
type WeightedStage = (typeof WEIGHTED_STAGES)[number];

/**
 * Named so an unexplained difference still fails. These are defects in the
 * client's own file, not in our reading of it, and each one is a row that
 * item 15 has to surface to a document controller.
 */
const KNOWN: Record<string, string> = {
  'A.2.1': 'ringkasan hanya menghitung baris 19–28; PRGG-00-G0-PR-011 di baris 29 ada di luar jangkauan COUNTIF, jadi kategori ini punya 11 dokumen tapi dihitung 10',
};

let failed = 0;
const excused: string[] = [];
const mark = (ok: boolean) => (ok ? '✓' : '✗');

/* ------------------------------------------------------------------ load */

const categories = db.select().from(schema.docCategories)
  .where(eq(schema.docCategories.projectId, PROJECT_ID)).all();
const documents = db.select().from(schema.documents)
  .where(eq(schema.documents.projectId, PROJECT_ID)).all();
const stages = db.select().from(schema.docStages).all();
const stageWeights = db.select().from(schema.docStageWeights)
  .where(eq(schema.docStageWeights.projectId, PROJECT_ID)).all();

if (documents.length === 0) throw new Error('register kosong — jalankan scripts/import-edl.ts dulu');

const weightOf = new Map(stageWeights.map((w) => [w.stage, w.weight]));
const docsByCategory = new Map<string, typeof documents>();
for (const d of documents) {
  const list = docsByCategory.get(d.categoryId) ?? [];
  list.push(d);
  docsByCategory.set(d.categoryId, list);
}
const stagesByDoc = new Map<string, typeof stages>();
for (const s of stages) {
  const list = stagesByDoc.get(s.documentId) ?? [];
  list.push(s);
  stagesByDoc.set(s.documentId, list);
}

/**
 * A document has reached a stage once a stage record exists for it. The record
 * itself is the evidence: the importer only writes one when something actually
 * happened — a submission, a transmittal, a return — never for a plan date
 * alone. Testing `submittedAt` instead would drop the submissions the register
 * marks with a bare `1` because nobody wrote the date down.
 */
function reached(documentId: string, stage: WeightedStage): boolean {
  return (stagesByDoc.get(documentId) ?? []).some((s) => s.stage === stage);
}

const codeToId = new Map(categories.map((c) => [c.code, c.id]));
const idToCode = new Map(categories.map((c) => [c.id, c.code]));

/** Every document under a category, including its sub-categories. */
function documentsUnder(code: string) {
  return documents.filter((d) => {
    const c = idToCode.get(d.categoryId);
    return c === code || (c !== undefined && c.startsWith(`${code}.`));
  });
}

/* ---------------------------------------- 1. the register against itself */

const src = await readEdlWorkbook(process.argv[2] ?? DEFAULT_FILE);
const leafCodes = src.categories.filter((c) => isLeafCategory(c.code, src.categories)).map((c) => c.code);
const totalDocs = src.categories
  .filter((c) => leafCodes.includes(c.code))
  .reduce((a, c) => a + (c.plannedCount ?? 0), 0);

console.log('1. Register dibandingkan dengan ringkasannya sendiri');
console.log('   kategori  jml   IFR      IFA      AFC      progres      ringkasan');
console.log('   ' + '-'.repeat(72));

let registerProgress = 0;
for (const code of leafCodes) {
  const summary = src.categories.find((c) => c.code === code)!;
  const id = codeToId.get(code);
  const docs = id ? (docsByCategory.get(id) ?? []) : [];
  const counted: Record<WeightedStage, number> = { IFR: 0, IFA: 0, AFC: 0 };
  for (const stage of WEIGHTED_STAGES) counted[stage] = docs.filter((d) => reached(d.id, stage)).length;

  // Weight is count over the whole register — every document counts equally.
  const weight = (summary.plannedCount ?? docs.length) / totalDocs;
  const denominator = summary.plannedCount ?? docs.length;
  const fraction = denominator === 0 ? 0 : WEIGHTED_STAGES
    .reduce((a, s) => a + (counted[s] / denominator) * ((weightOf.get(s) ?? 0) / 100), 0);
  const progress = fraction * weight;
  registerProgress += progress;

  const want = summary.submitted;
  const okCounts = want ? counted.IFR === want.IFR && counted.IFA === want.IFA && counted.AFC === want.AFC : false;
  const okProgress = summary.totalProgress !== null && Math.abs(progress - summary.totalProgress) <= EPS;
  if (!okCounts || !okProgress) {
    if (KNOWN[code]) excused.push(code);
    else failed++;
  }

  const show = (got: number, exp: number | undefined) =>
    `${String(got).padStart(2)}${exp === undefined ? '   ' : got === exp ? '   ' : `/${String(exp).padStart(2)}`}`;

  console.log(
    `   ${code.padEnd(9)} ${String(summary.plannedCount ?? '?').padStart(3)}   ` +
    `${show(counted.IFR, want?.IFR)}   ${show(counted.IFA, want?.IFA)}   ${show(counted.AFC, want?.AFC)}   ` +
    `${(progress * 100).toFixed(4).padStart(8)}%  ${((summary.totalProgress ?? 0) * 100).toFixed(4).padStart(8)}%  ` +
    `${mark(okCounts)}${mark(okProgress)}`,
  );
}
console.log('   ' + '-'.repeat(72));
console.log(`   ${totalDocs} dokumen · progres register ${(registerProgress * 100).toFixed(4)}%`);

/* ------------------------------ 2. the register against the physical WBS */

const week = db.select().from(schema.weeks)
  .where(eq(schema.weeks.id, `${PROJECT_ID}:W${REGISTER_WEEK}`)).all()[0];
const progressRows = week
  ? db.select().from(schema.leafProgress).where(eq(schema.leafProgress.weekId, week.id)).all()
  : [];
const pctByNode = new Map(progressRows.map((p) => [p.nodeId, p.cumProgressPct]));
const nodes = db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.projectId, PROJECT_ID)).all();

console.log(`\n2. Register (W${REGISTER_WEEK}) dibandingkan dengan leaf engineering di WBS`);
console.log(`   minggu ${week?.startDate} → ${week?.endDate}\n`);
console.log('   disiplin      tahap   register   WBS      selisih');
console.log('   ' + '-'.repeat(58));

let engineeringWeight = 0;
for (const d of DISCIPLINES) {
  const docs = documentsUnder(d.edl);
  const planned = src.categories
    .filter((c) => leafCodes.includes(c.code) && (c.code === d.edl || c.code.startsWith(`${d.edl}.`)))
    .reduce((a, c) => a + (c.plannedCount ?? 0), 0);

  for (const stage of WEIGHTED_STAGES) {
    const fromRegister = planned === 0 ? 0 : (docs.filter((x) => reached(x.id, stage)).length / planned) * 100;
    const node = nodes.find((n) => n.wbsCode === `${d.wbs}.${WEIGHTED_STAGES.indexOf(stage) + 1}`);
    const fromWbs = node ? (pctByNode.get(node.id) ?? 0) : null;
    if (node?.bobot) engineeringWeight += node.bobot;
    const gap = fromWbs === null ? null : fromRegister - fromWbs;
    console.log(
      `   ${(stage === 'IFR' ? d.name : '').padEnd(13)} ${stage.padEnd(6)} ` +
      `${fromRegister.toFixed(2).padStart(8)}%  ${fromWbs === null ? '     —  ' : `${fromWbs.toFixed(2).padStart(6)}%`}  ` +
      `${gap === null ? '' : `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}`}`,
    );
  }
}

console.log('   ' + '-'.repeat(58));
console.log(`\n   Leaf engineering di WBS ini bobotnya ${engineeringWeight.toFixed(4)}% dari proyek.`);
console.log('   Register menggerakkan angka sekecil itu — tapi dokumen yang tertahan');
console.log('   menahan konstruksi yang bobotnya jauh lebih besar.');

/* --------------------------------------------------------------- verdict */

console.log('');
if (excused.length) {
  console.log('Selisih yang sudah diketahui sebabnya — cacat di berkas klien, bukan di pembacaan kita:');
  for (const code of excused) console.log(`  ${code}  ${KNOWN[code]}`);
  console.log('');
}
if (failed === 0) {
  const matched = leafCodes.length - excused.length;
  console.log(`✓ ${matched} dari ${leafCodes.length} kategori cocok persis dengan "EDL Summary"`);
  console.log(`✓ ${documents.length} dokumen · ${stages.length} catatan tahap · ${totalDocs} menurut ringkasan`);
} else {
  console.log(`${failed} kategori tidak cocok tanpa sebab yang diketahui — lihat tanda ✗ di atas.`);
  process.exitCode = 1;
}

sqlite.close();
