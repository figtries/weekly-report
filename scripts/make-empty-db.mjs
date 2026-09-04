/**
 * Sebuah database kembar dengan registernya dikosongkan, untuk melihat layar
 * yang hanya muncul kalau register belum ada.
 *
 * `data/report.db` TIDAK PERNAH disentuh — yang ditulis hanya `data/empty.db`.
 * Jalankan dev server terhadapnya dengan `REPORT_DB_PATH=data/empty.db`.
 *
 * Disalin lewat `backup()`, bukan `copyFileSync`: databasenya berjalan dalam
 * mode WAL (lihat `lib/sqlite.ts`), jadi menyalin berkas utamanya saja
 * meninggalkan seluruh isi `-wal` dan menghasilkan salinan yang tertinggal satu
 * atau dua migrasi di belakang.
 *
 * Run: node scripts/make-empty-db.mjs [--all]
 *   (tanpa argumen: hanya register EDL yang dikosongkan)
 *   (--all: EDL, VDRL, dan bobot tahapnya sekalian)
 */
import { rmSync } from 'node:fs';
import Database from 'better-sqlite3';

const all = process.argv.includes('--all');
const OUT = 'data/empty.db';

try {
  for (const suffix of ['', '-wal', '-shm']) rmSync(OUT + suffix, { force: true });
} catch (err) {
  // Windows menolak menghapus berkas yang masih dibuka. Yang membukanya
  // hampir selalu dev server yang menunjuk ke sini.
  if (err.code !== 'EPERM' && err.code !== 'EBUSY') throw err;
  console.error(`${OUT} sedang dipakai — hentikan dev server yang memakai REPORT_DB_PATH=${OUT} lebih dulu.`);
  process.exit(1);
}

const source = new Database('data/report.db', { readonly: true });
await source.backup(OUT);
source.close();

const target = new Database(OUT);
const count = (t) => target.prepare(`select count(*) c from ${t}`).get().c;

const before = { documents: count('documents'), categories: count('doc_categories') };

if (all) {
  target.exec('delete from documents; delete from doc_categories; delete from doc_stage_weights;');
} else {
  target.exec(
    "delete from documents where register = 'edl';"
    + " delete from doc_categories where register = 'edl';"
    + " delete from doc_stage_weights where register = 'edl';",
  );
}

console.log(`${OUT} siap`);
console.log(`  dokumen   ${before.documents} → ${count('documents')}`);
console.log(`  kategori  ${before.categories} → ${count('doc_categories')}`);
target.close();
