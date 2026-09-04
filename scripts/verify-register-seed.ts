/**
 * Membuktikan tempelan menjadi register yang benar di database — dan bahwa
 * kegagalan tidak meninggalkan setengah register.
 *
 * Berjalan di atas salinan sementara, bukan `data/report.db`.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-register-seed.ts
 */
import { rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const tmp = path.join(os.tmpdir(), `report-seed-${Date.now()}.db`);

// Disalin lewat `backup()`, BUKAN `copyFileSync`. Database ini berjalan dalam
// mode WAL (lihat `lib/sqlite.ts`), jadi menyalin berkas utamanya saja akan
// meninggalkan seluruh isi `-wal` — dan salinan itu adalah keadaan sebelum
// migrasi terakhir. Persis itu yang terjadi waktu uji ini pertama dijalankan:
// unique index yang sudah dilepas muncul kembali dan menolak nomor ganda.
const source = new Database('data/report.db', { readonly: true });
await source.backup(tmp);
source.close();

process.env.REPORT_DB_PATH = tmp;

const { db, schema, sqlite } = await import('../lib/sqlite.ts');
const { writeSeed } = await import('../lib/register-seed.ts');
const { and, eq } = await import('drizzle-orm');

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
};

// Proyek kosong, supaya yang dihitung hanya yang ditulis uji ini.
const PROJECT = 'seed-test';
db.insert(schema.projects).values({ id: PROJECT, name: 'Seed test' }).run();

const text = readFileSync('scripts/fixtures/petrogas-edl.tsv', 'utf8');
const result = writeSeed({
  projectId: PROJECT, register: 'edl', text,
  clientName: 'PETROGAS (BASIN) LTD.', contractorName: 'PT. INDOTURBINE',
});

console.log('seluruh sheet EDL masuk sekali jalan');
check('kategori ditulis', result.categories, 36);
check('dokumen ditulis', result.documents, 131);

const cats = db.select().from(schema.docCategories)
  .where(and(eq(schema.docCategories.projectId, PROJECT), eq(schema.docCategories.register, 'edl'))).all();
const docs = db.select().from(schema.documents)
  .where(and(eq(schema.documents.projectId, PROJECT), eq(schema.documents.register, 'edl'))).all();
check('kategori di database', cats.length, 36);
check('dokumen di database', docs.length, 131);

console.log('\nhirarkinya tiga tingkat, dan induknya nyata');
check('akar', cats.filter((c) => c.parentId === null).length, 2);
const general = cats.find((c) => c.name === 'GENERAL')!;
const procedure = cats.find((c) => c.name === 'PROCEDURE')!;
check('PROCEDURE anak GENERAL', procedure.parentId, general.id);
const qaqc = cats.find((c) => c.name === 'QA/QC Prosedur')!;
check('QA/QC anak PROCEDURE', qaqc.parentId, procedure.id);

console.log('\nkode kategori dibuat dari nama, bukan dari kode outline yang dobel');
check('kode unik', new Set(cats.map((c) => c.code)).size, 36);

console.log('\nnomor ganda diterima apa adanya');
check('WPP-IN-LAY-003', docs.filter((d) => d.docNo === 'WPP-IN-LAY-003').length, 2);

console.log('\nnama kedua pihak tersimpan di proyek');
const project = db.select().from(schema.projects).where(eq(schema.projects.id, PROJECT)).all()[0];
check('client', project.clientName, 'PETROGAS (BASIN) LTD.');
check('contractor', project.contractorName, 'PT. INDOTURBINE');

console.log('\nbobot tahap default terpasang, dan berjumlah 100');
const weights = db.select().from(schema.docStageWeights)
  .where(and(eq(schema.docStageWeights.projectId, PROJECT), eq(schema.docStageWeights.register, 'edl'))).all();
check('baris bobot', weights.length, 8);
check('jumlah bobot', weights.reduce((a, w) => a + w.weight, 0), 100);
check('IFR', weights.find((w) => w.stage === 'IFR')!.weight, 50);

console.log('\nmenempel daftar kedua menambah ke kategori yang sama');
const again = writeSeed({
  projectId: PROJECT, register: 'edl',
  text: 'GENERAL\nWPP-ZZ-001\tDokumen susulan',
  clientName: 'PETROGAS (BASIN) LTD.', contractorName: 'PT. INDOTURBINE',
});
check('kategori baru', again.categories, 0);
check('dokumen baru', again.documents, 1);
check('kategori tetap', db.select().from(schema.docCategories)
  .where(and(eq(schema.docCategories.projectId, PROJECT), eq(schema.docCategories.register, 'edl'))).all().length, 36);

console.log('\ngagal di tengah tidak meninggalkan setengah register');
const before = db.select().from(schema.documents)
  .where(eq(schema.documents.projectId, PROJECT)).all().length;
let threw = false;
try {
  writeSeed({
    projectId: PROJECT, register: 'edl', text: 'GENERAL\nWPP-YY-001\tSatu',
    clientName: '', contractorName: 'PT. INDOTURBINE',
  });
} catch { threw = true; }
check('menolak client kosong', threw, true);
check('tidak ada yang tertulis', db.select().from(schema.documents)
  .where(eq(schema.documents.projectId, PROJECT)).all().length, before);

console.log('\nregister Gundih yang sudah ada tidak ikut tersentuh');
check('dokumen gundih', db.select().from(schema.documents)
  .where(eq(schema.documents.projectId, 'gundih')).all().length, 454);

// Ditutup dulu: Windows mengunci berkas database selama koneksinya hidup, dan
// WAL meninggalkan dua berkas pendamping.
sqlite.close();
for (const suffix of ['', '-wal', '-shm']) rmSync(tmp + suffix, { force: true });
if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
