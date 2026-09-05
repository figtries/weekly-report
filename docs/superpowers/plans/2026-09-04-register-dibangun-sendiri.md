# Register yang dibangun sendiri — rencana implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sebuah register dokumen bisa dibuat, diisi dan dirawat dari dalam aplikasi, tanpa importer dan tanpa terminal.

**Architecture:** Satu parser murni mengubah teks tempelan menjadi rencana (kategori + dokumen); satu penulis menuliskan rencana itu dalam satu transaksi; layar kosong Document Control diganti menjadi tempat menempel, dan workbench yang sudah ada mendapat tombol untuk merawat isinya. Tidak ada persentase yang pernah ditulis — semua figur tetap dihitung ulang oleh `lib/register.ts`.

**Tech Stack:** Next 16 (App Router, `cacheComponents`), React 19, better-sqlite3 + drizzle (sinkron), shadcn/Radix (`components/ui/`), Tailwind 4, framer-motion untuk gerak yang dipicu state.

**Spec:** `docs/superpowers/specs/2026-09-04-register-dibangun-sendiri-design.md`

## Global Constraints

- **Bahasa layar Inggris.** Semua label, tombol dan pesan galat dalam bahasa Inggris; angka `en-GB`. Yang berbahasa Indonesia hanya data milik orang (nama kategori, judul dokumen).
- **Tidak ada persentase yang ditulis ke database.** `lib/progress.ts` dan `lib/register.ts` satu-satunya yang menghitung.
- **`lib/doc-actions.ts` satu-satunya pintu tulis** untuk register, seperti sekarang.
- **Radix per layar, bukan per baris.** Di dalam `.map()` yang bisa melebihi ~20 baris pakai elemen native. Satu DropdownMenu untuk grup yang sedang dibuka, bukan satu per kartu.
- **Target sentuh ≥44px** (`h-11`), kontras tinggi, tidak ada informasi yang hanya muncul saat hover.
- **Animasi masuk halaman = keyframe CSS** (`.animate-enter`, `.stagger-1`…), bukan framer-motion. framer-motion hanya untuk gerak yang dipicu state setelah halaman hidup.
- **`/print/*` tidak disentuh sama sekali** oleh pekerjaan ini.
- **Verifikasi build:** `npx next build > build.log 2>&1; echo $?` — jangan pernah lewat pipe ke grep.
- **Verifikasi layar:** `node scripts/shoot.mjs <url> <out.png> [w] [h]` pada 390px dan desktop, lalu **gambarnya dilihat**.
- Nomor dokumen ganda **diterima** dan ditandai, tidak pernah ditolak (keputusan 8 di spec).

---

### Task 1: Parser tempelan

Fungsi murni yang mengubah teks menjadi rencana register. Tidak menyentuh database, tidak menyentuh React — inilah yang membuatnya bisa diuji dengan sebuah string dan dipakai ulang oleh importer Excel nanti.

**Files:**
- Create: `lib/register-paste.ts`
- Create: `scripts/verify-register-paste.ts`
- Sudah ada di repo: `scripts/fixtures/petrogas-edl.tsv` (208 baris, salinan sheet EDL Petrogas apa adanya, termasuk baris judulnya)

**Interfaces:**
- Consumes: tidak ada.
- Produces:
  ```ts
  export interface PasteDocument { docNo: string | null; title: string; kind: string | null }
  export interface PasteCategory { name: string; depth: number; documents: PasteDocument[] }
  export interface ColumnMapping { outline: number | null; docNo: number | null; title: number | null; kind: number | null }
  export interface ColumnSample { index: number; values: string[] }
  export interface PasteProblem { line: number; message: string }
  export interface PastePlan {
    columns: ColumnSample[];
    mapping: ColumnMapping;
    categories: PasteCategory[];
    counts: { categories: number; documents: number; duplicateNumbers: number };
    problems: PasteProblem[];
  }
  export function parseRegisterPaste(text: string, override?: Partial<ColumnMapping>): PastePlan
  ```

- [x] **Step 1: Tulis uji yang gagal**

Buat `scripts/verify-register-paste.ts`:

```ts
/**
 * Membuktikan parser tempelan membaca EDL yang nyata, bukan yang kita bayangkan.
 *
 * Fixture-nya salinan mentah sheet EDL Petrogas — termasuk empat baris judul,
 * kolom A yang kosong, kode outline tiga tingkat, satu baris hantu tanpa nomor
 * dan tanpa judul, dan satu nomor dokumen yang dipakai dua kali. Kalau parser
 * bisa membaca berkas itu, dia bisa membaca daftar orang lain.
 *
 * Run: node scripts/verify-register-paste.ts
 */
import { readFileSync } from 'node:fs';
import { parseRegisterPaste } from '../lib/register-paste.ts';

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
};

console.log('sheet EDL Petrogas, ditempel apa adanya');
const sheet = parseRegisterPaste(readFileSync('scripts/fixtures/petrogas-edl.tsv', 'utf8'));
check('kolom outline', sheet.mapping.outline, 1);
check('kolom nomor', sheet.mapping.docNo, 2);
check('kolom judul', sheet.mapping.title, 7);
check('kolom jenis', sheet.mapping.kind, 10);
check('kategori', sheet.counts.categories, 36);
check('dokumen', sheet.counts.documents, 131);
check('nomor dipakai dua kali', sheet.counts.duplicateNumbers, 1);
check('baris yang dilewati', sheet.problems.length, 1);

console.log('\ntiga tingkat, dan induknya benar');
check('tingkat 1', sheet.categories.filter((c) => c.depth === 1).length, 2);
check('tingkat 2', sheet.categories.filter((c) => c.depth === 2).length, 8);
check('tingkat 3', sheet.categories.filter((c) => c.depth === 3).length, 26);
check('kategori pertama', sheet.categories[0].name, 'GENERAL');
check('EXECUTION PLAN isinya', sheet.categories[1].documents.length, 3);
check('dokumen pertama', sheet.categories[1].documents[0].docNo, 'WPP-GN-DRE-001');
check('judulnya', sheet.categories[1].documents[0].title, 'Jadwal Pelaksanaan Pekerjaan (Master Schedule)');
check('jenisnya', sheet.categories[1].documents[0].kind, 'Doc');

console.log('\nkode outline boleh dobel — nama yang membedakan');
const piping = sheet.categories.filter((c) => c.name.startsWith('Piping'));
check('kategori Piping', piping.length, 5);

console.log('\ndaftar ketikan tangan, dua kolom');
const flat = parseRegisterPaste(
  'GENERAL\nWPP-A-001\tPeta lokasi\nWPP-A-002\tDenah\nPROCEDURE\nWPP-B-001\tProsedur angkat'
);
check('mode datar', flat.mapping.outline, null);
check('kategori', flat.counts.categories, 2);
check('dokumen', flat.counts.documents, 3);
check('kategori kedua', flat.categories[1].name, 'PROCEDURE');

console.log('\npemisah lain, dan dokumen tanpa nomor');
const pipes = parseRegisterPaste('DRAWINGS\n| Layout tanpa nomor\nWPP-C-001 | Denah pondasi');
check('dokumen', pipes.counts.documents, 2);
check('yang tanpa nomor', pipes.categories[0].documents[0].docNo, null);
check('judulnya tetap ada', pipes.categories[0].documents[0].title, 'Layout tanpa nomor');

console.log('\ndua spasi juga memisah');
const spaces = parseRegisterPaste('GENERAL\nWPP-A-001   Peta lokasi');
check('dokumen', spaces.counts.documents, 1);
check('judul tidak terpotong', spaces.categories[0].documents[0].title, 'Peta lokasi');

console.log('\ndokumen sebelum kategori mana pun tetap diterima');
const orphan = parseRegisterPaste('WPP-A-001\tPeta lokasi');
check('kategori dibuatkan', orphan.categories[0].name, 'GENERAL');
check('dokumen', orphan.counts.documents, 1);

console.log('\ntebakan kolom bisa dibetulkan orang');
const forced = parseRegisterPaste(
  readFileSync('scripts/fixtures/petrogas-edl.tsv', 'utf8'),
  { title: 6 }
);
check('judul ikut pilihan', forced.categories[1].documents[0].title, 'PRIORITAS-1');
check('kategori tetap', forced.counts.categories, 36);

console.log('\ntempelan kosong bukan galat, cuma kosong');
const empty = parseRegisterPaste('   \n\n');
check('kategori', empty.counts.categories, 0);
check('dokumen', empty.counts.documents, 0);
check('problem', empty.problems.length, 0);

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
```

- [x] **Step 2: Jalankan supaya gagal**

```bash
node scripts/verify-register-paste.ts
```

Expected: FAIL — `Cannot find module '../lib/register-paste.ts'`.

- [x] **Step 3: Tulis parsernya**

Buat `lib/register-paste.ts`:

```ts
/**
 * Daftar yang ditempel orang, dibaca menjadi register.
 *
 * Ada dua bentuk tempelan dan keduanya harus jalan: yang diketik tangan (dua
 * kolom) dan yang disalin dari sheet EDL (75 kolom, berkode outline, dengan
 * empat baris judul di atasnya). Karena itu parser bekerja dua langkah —
 * pecah menjadi kisi, lalu putuskan arti tiap kolom — dan tebakan itu boleh
 * dibetulkan orang lewat `override`.
 *
 * Berkas ini tidak menyentuh database dan tidak menyentuh React. Itu disengaja:
 * ia diuji dengan sebuah string (`scripts/verify-register-paste.ts`), dipakai
 * di browser untuk pratinjau, dipakai di server untuk menulis, dan nanti akan
 * dipakai importer Excel — sheet hanya menjadi sumber kisi yang lain.
 */

export interface PasteDocument { docNo: string | null; title: string; kind: string | null }
export interface PasteCategory { name: string; depth: number; documents: PasteDocument[] }
export interface ColumnMapping { outline: number | null; docNo: number | null; title: number | null; kind: number | null }
export interface ColumnSample { index: number; values: string[] }
export interface PasteProblem { line: number; message: string }

export interface PastePlan {
  columns: ColumnSample[];
  mapping: ColumnMapping;
  categories: PasteCategory[];
  counts: { categories: number; documents: number; duplicateNumbers: number };
  problems: PasteProblem[];
}

/** `A`, `A.2`, `B.5.7` — penomoran outline, bukan nomor dokumen. */
const OUTLINE = /^[A-Z](\.\d+)*$/;
/** Nomor urut baris dokumen di kolom yang sama. */
const SEQ = /^\d{1,3}$/;
/** `WPP-GN-DRE-001` — cukup untuk membedakan kolom nomor dari kolom lain. */
const CODEISH = /^[A-Za-z]{2,}[-/][A-Za-z0-9\-/.]+$/;
/** Tab, pipa, atau dua spasi ke atas: Excel, tabel Markdown, dan salinan PDF. */
const SPLIT = /\t|\s*\|\s*|\s{2,}/;

interface RawRow { line: number; indent: number; cells: string[] }

function toRows(text: string): RawRow[] {
  const out: RawRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const cells = raw.split(SPLIT).map((c) => c.trim());
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.every((c) => c === '')) return;
    out.push({ line: i + 1, indent: raw.length - raw.trimStart().length, cells });
  });
  return out;
}

const at = (row: RawRow, col: number) => row.cells[col] ?? '';

function guessColumns(rows: RawRow[], width: number): ColumnMapping {
  const none: ColumnMapping = { outline: null, docNo: null, title: null, kind: null };

  // Kolom outline dinilai dari kode outline DAN nomor urut sekaligus.
  //
  // Menilai dari kode outline saja terlihat cukup sampai sebuah sheet nyata
  // dibaca: kolom REV berisi huruf tunggal `A` dan `B`, yang cocok dengan pola
  // kode outline — pada EDL Petrogas 69 kali, terhadap 36 kode outline yang
  // sebenarnya. Yang membedakan keduanya adalah baris dokumennya: kolom outline
  // yang asli juga memuat seluruh nomor urut (skor 168), kolom REV nyaris tidak
  // memuat satu pun (skor 87).
  //
  // Syarat dua kode outline menjaga daftar ketikan tangan tetap jatuh ke mode
  // datar: daftar begitu tidak punya kode outline sama sekali.
  let outline: number | null = null;
  let best = 0;
  for (let c = 0; c < width; c += 1) {
    const outlineHits = rows.filter((r) => OUTLINE.test(at(r, c))).length;
    if (outlineHits < 2) continue;
    const score = outlineHits + rows.filter((r) => SEQ.test(at(r, c))).length;
    if (score > best) { best = score; outline = c; }
  }
  if (outline === null) return none;

  const docRows = rows.filter((r) => SEQ.test(at(r, outline!)));
  if (docRows.length === 0) return none;

  let docNo: number | null = null;
  best = 0;
  for (let c = 0; c < width; c += 1) {
    if (c === outline) continue;
    const hits = docRows.filter((r) => CODEISH.test(at(r, c))).length;
    if (hits > best) { best = hits; docNo = c; }
  }

  // Judul = teks terpanjang rata-rata. Dihitung terhadap SELURUH baris dokumen,
  // bukan hanya yang terisi, supaya kolom yang jarang diisi tapi panjang
  // (REMARKS) tidak mengalahkan kolom judul.
  let title: number | null = null;
  best = 0;
  for (let c = 0; c < width; c += 1) {
    if (c === outline || c === docNo) continue;
    const total = docRows.reduce((sum, r) => sum + at(r, c).length, 0);
    const avg = total / docRows.length;
    if (avg > best) { best = avg; title = c; }
  }

  let kind: number | null = null;
  best = 0;
  for (let c = 0; c < width; c += 1) {
    if (c === outline || c === docNo || c === title) continue;
    const hits = docRows.filter((r) => /^(doc|dwg)$/i.test(at(r, c))).length;
    if (hits > best) { best = hits; kind = c; }
  }

  return { outline, docNo, title, kind };
}

function sample(rows: RawRow[], width: number): ColumnSample[] {
  const out: ColumnSample[] = [];
  for (let c = 0; c < width; c += 1) {
    const values = rows.map((r) => at(r, c)).filter(Boolean).slice(0, 3);
    out.push({ index: c, values });
  }
  return out;
}

interface Build { categories: PasteCategory[]; problems: PasteProblem[] }

function fromGrid(rows: RawRow[], m: ColumnMapping): Build {
  const categories: PasteCategory[] = [];
  const problems: PasteProblem[] = [];
  const stack: PasteCategory[] = [];

  const current = (): PasteCategory => {
    const open = stack[stack.length - 1];
    if (open) return open;
    // Dokumen sebelum kategori mana pun tetap punya rumah.
    const general: PasteCategory = { name: 'GENERAL', depth: 1, documents: [] };
    categories.push(general);
    stack.push(general);
    return general;
  };

  for (const row of rows) {
    const key = at(row, m.outline!);

    if (OUTLINE.test(key)) {
      // Nama kategori duduk di sel terisi pertama di kanan kolom outline —
      // pada sheet EDL itu kolom yang sama dengan nomor dokumen.
      const name = row.cells.slice(m.outline! + 1).find((c) => c !== '') ?? '';
      if (!name) { problems.push({ line: row.line, message: 'Category has no name' }); continue; }
      const depth = key.split('.').length;
      const category: PasteCategory = { name, depth, documents: [] };
      stack.length = Math.min(stack.length, depth - 1);
      stack[depth - 1] = category;
      categories.push(category);
      continue;
    }

    // Baris judul sheet, baris catatan, baris kosong: bukan keduanya, lewati
    // diam-diam. Menyebutnya sebagai masalah akan membuat setiap tempelan
    // sheet utuh mengeluh empat kali sebelum baris pertamanya terbaca.
    if (!SEQ.test(key)) continue;

    const docNo = m.docNo === null ? '' : at(row, m.docNo);
    const title = m.title === null ? '' : at(row, m.title);
    if (!docNo && !title) {
      problems.push({ line: row.line, message: 'Row has neither a number nor a title' });
      continue;
    }
    current().documents.push({
      docNo: docNo || null,
      title: title || docNo,
      kind: m.kind === null ? null : at(row, m.kind) || null,
    });
  }

  return { categories, problems };
}

function fromFlat(rows: RawRow[]): Build {
  const categories: PasteCategory[] = [];
  const problems: PasteProblem[] = [];
  const stack: PasteCategory[] = [];

  const current = (): PasteCategory => {
    const open = stack[stack.length - 1];
    if (open) return open;
    const general: PasteCategory = { name: 'GENERAL', depth: 1, documents: [] };
    categories.push(general);
    stack.push(general);
    return general;
  };

  for (const row of rows) {
    const filled = row.cells.filter((c) => c !== '');
    const headless = row.cells[0] === '';

    if (!headless && filled.length === 1) {
      const depth = row.indent === 0 ? 1 : 2;
      const category: PasteCategory = { name: filled[0], depth, documents: [] };
      stack.length = Math.min(stack.length, depth - 1);
      stack[depth - 1] = category;
      categories.push(category);
      continue;
    }

    const docNo = headless ? '' : row.cells[0];
    const title = row.cells.slice(1).filter(Boolean).join(' ');
    if (!docNo && !title) {
      problems.push({ line: row.line, message: 'Row has neither a number nor a title' });
      continue;
    }
    current().documents.push({ docNo: docNo || null, title: title || docNo, kind: null });
  }

  return { categories, problems };
}

export function parseRegisterPaste(text: string, override?: Partial<ColumnMapping>): PastePlan {
  const rows = toRows(text);
  const width = rows.reduce((w, r) => Math.max(w, r.cells.length), 0);
  const mapping: ColumnMapping = { ...guessColumns(rows, width), ...override };

  const { categories, problems } = mapping.outline === null
    ? fromFlat(rows)
    : fromGrid(rows, mapping);

  const seen = new Map<string, number>();
  let documents = 0;
  for (const c of categories) {
    documents += c.documents.length;
    for (const d of c.documents) {
      if (d.docNo) seen.set(d.docNo, (seen.get(d.docNo) ?? 0) + 1);
    }
  }

  return {
    columns: sample(rows, width),
    mapping,
    categories,
    counts: {
      categories: categories.length,
      documents,
      duplicateNumbers: [...seen.values()].filter((n) => n > 1).length,
    },
    problems,
  };
}
```

- [x] **Step 4: Jalankan sampai lulus**

```bash
node scripts/verify-register-paste.ts
```

Expected: PASS, semua baris `ok`, ditutup `all checks passed`.

Kalau `kolom judul` meleset ke kolom lain, cetak dulu `plan.columns` dan lihat contoh isinya sebelum mengubah aturan tebakan — jangan mengubah angka di uji supaya cocok dengan hasil.

- [x] **Step 5: Commit**

```bash
git add lib/register-paste.ts scripts/verify-register-paste.ts scripts/fixtures/petrogas-edl.tsv
git commit -m "A pasted list, read the way a real EDL is actually shaped"
```

---

### Task 2: Lepas unique index nomor dokumen

EDL Petrogas memakai `WPP-IN-LAY-003` dua kali. Index yang menolaknya akan menolak register apa adanya (keputusan 8 di spec).

**Files:**
- Modify: `lib/schema.ts:327` (hapus `uniqueIndex('documents_project_no_idx')`)
- Create: `data/migrations/0005_*.sql` (dihasilkan drizzle-kit)

**Interfaces:**
- Consumes: tidak ada.
- Produces: `documents` boleh memuat `docNo` yang sama dua kali pada register mana pun.

- [x] **Step 1: Salin database dan hitung baris anak**

Aturan AGENTS.md: migrasi yang membangun ulang tabel membawa baris anaknya. `DROP INDEX` tidak membangun ulang tabel, tapi hitungannya tetap dicatat supaya klaim itu terbukti, bukan diyakini.

Database ini berjalan dalam mode **WAL** — dibuktikan 4 September 2026, `data/report.db` bertanggal 28 Agustus sementara seluruh tulisan sejak itu masih duduk di `data/report.db-wal`. Menyalin berkas `.db` sendirian, seperti bunyi aturan itu selama ini, menghasilkan cadangan basi yang justru gagal saat dibutuhkan. Checkpoint dulu, baru salin.

```bash
node -e "require('better-sqlite3')('data/report.db').pragma('wal_checkpoint(TRUNCATE)')"
cp data/report.db data/report.db.before-0005
node -e "const d=require('better-sqlite3')('data/report.db');for(const t of ['documents','doc_stages','doc_categories'])console.log(t,d.prepare('select count(*) c from '+t).get().c)"
```

Catat ketiga angkanya.

- [x] **Step 2: Hapus index dari skema**

Di `lib/schema.ts`, pada blok `documents`, buang baris `uniqueIndex('documents_project_no_idx')` beserta komentar yang menjelaskannya, dan ganti komentar itu dengan yang menjelaskan keadaan sekarang:

```ts
}, (t) => [
  index('documents_category_idx').on(t.categoryId),
  index('documents_project_register_idx').on(t.projectId, t.register),
  // Document numbers are NOT guaranteed unique. Numbering discipline is real,
  // but enforcing it here means refusing a register as it actually is: Gundih's
  // VDRL uses `PRGG-VDR-KMI-IN-PSV-DOC-003` twice, and Petrogas' EDL — an EDL,
  // where this rule was once thought safe — uses `WPP-IN-LAY-003` twice. What
  // replaces the refusal is sight: the paste preview counts them before writing,
  // and the workbench flags them afterwards.
]);
```

- [x] **Step 3: Hasilkan migrasinya dan baca isinya**

```bash
npx drizzle-kit generate
cat data/migrations/0005_*.sql
```

Expected: berisi `DROP INDEX` (satu baris). **Kalau yang keluar `CREATE TABLE __new_documents` + `INSERT INTO ... SELECT` + `DROP TABLE`, JANGAN dijalankan** — itu bangun-ulang tabel, dan `PRAGMA foreign_keys=OFF` tidak berlaku di dalam transaksi drizzle, jadi `doc_stages` akan ikut terhapus. Ganti isi berkas `.sql` itu dengan satu baris `DROP INDEX \`documents_project_no_idx\`;` sebelum melanjutkan.

- [x] **Step 4: Jalankan dan hitung ulang**

```bash
npx drizzle-kit migrate
node -e "const d=require('better-sqlite3')('data/report.db');for(const t of ['documents','doc_stages','doc_categories'])console.log(t,d.prepare('select count(*) c from '+t).get().c)"
```

Expected: ketiga angkanya sama persis dengan Step 1.

- [x] **Step 5: Buktikan index-nya benar hilang**

```bash
node -e "const d=require('better-sqlite3')('data/report.db');console.log(d.prepare(\"select name from sqlite_master where type='index' and name like 'documents%'\").all())"
```

Expected: `documents_project_no_idx` tidak ada lagi; dua index lainnya tetap.

- [x] **Step 6: Commit**

```bash
rm data/report.db.before-0005
git add lib/schema.ts data/migrations
git commit -m "A document number is not unique, because real registers say so"
```

---

### Task 3: Menuliskan rencana tempelan

Penulisnya dipisah dari action-nya supaya bisa diuji: `lib/doc-actions.ts` memakai `'use server'` dan `next/cache`, yang tidak bisa diimpor sebuah script node.

**Files:**
- Create: `lib/register-seed.ts`
- Create: `scripts/verify-register-seed.ts`
- Modify: `lib/doc-actions.ts` (tambah `seedRegister` di bawah `addDocument`, sekitar baris 297)

**Interfaces:**
- Consumes: `parseRegisterPaste`, `PastePlan` dari Task 1.
- Produces:
  ```ts
  // lib/register-seed.ts
  export interface SeedInput {
    projectId: string; register: RegisterKind; text: string;
    mapping?: Partial<ColumnMapping>; clientName: string; contractorName: string;
  }
  export function writeSeed(input: SeedInput): { categories: number; documents: number }
  // lib/doc-actions.ts
  export async function seedRegister(input: SeedInput): Promise<ActionResult>
  ```

- [x] **Step 1: Tulis uji yang gagal**

Buat `scripts/verify-register-seed.ts`:

```ts
/**
 * Membuktikan tempelan menjadi register yang benar di database — dan bahwa
 * kegagalan tidak meninggalkan setengah register.
 *
 * Berjalan di atas salinan sementara, bukan `data/report.db`.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-register-seed.ts
 */
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

const tmp = path.join(os.tmpdir(), `report-seed-${Date.now()}.db`);

// Disalin lewat `backup()`, BUKAN `copyFileSync`. Database ini berjalan dalam
// mode WAL (lihat `lib/sqlite.ts`), jadi menyalin berkas utamanya saja akan
// meninggalkan seluruh isi `-wal` — dan salinan itu adalah keadaan sebelum
// migrasi terakhir.
const source = new Database('data/report.db', { readonly: true });
await source.backup(tmp);
source.close();

process.env.REPORT_DB_PATH = tmp;

const { db, schema, sqlite } = await import('../lib/sqlite.ts');
const { writeSeed } = await import('../lib/register-seed.ts');
const { eq, and } = await import('drizzle-orm');

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
const roots = cats.filter((c) => c.parentId === null);
check('akar', roots.length, 2);
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
const after = db.select().from(schema.docCategories)
  .where(and(eq(schema.docCategories.projectId, PROJECT), eq(schema.docCategories.register, 'edl'))).all();
check('kategori tetap', after.length, 36);

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

// Ditutup dulu: Windows mengunci berkas database selama koneksinya hidup, dan
// WAL meninggalkan dua berkas pendamping.
sqlite.close();
for (const suffix of ['', '-wal', '-shm']) rmSync(tmp + suffix, { force: true });
if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
```

- [x] **Step 2: Jalankan supaya gagal**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-register-seed.ts
```

Expected: FAIL — `Cannot find module '../lib/register-seed.ts'`.

- [x] **Step 3: Tulis penulisnya**

Buat `lib/register-seed.ts`:

```ts
/**
 * Rencana tempelan, dituliskan — dalam satu transaksi, atau tidak sama sekali.
 *
 * Terpisah dari `lib/doc-actions.ts` karena berkas itu `'use server'` dan
 * mengimpor `next/cache`, yang tidak bisa dijalankan sebuah script node. Yang
 * di sini murni database, jadi `scripts/verify-register-seed.ts` bisa
 * membuktikannya di atas salinan sementara.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { STAGE_ORDER } from './register-shared';
import { parseRegisterPaste, type ColumnMapping } from './register-paste';
import type { RegisterKind } from './schema';

export interface SeedInput {
  projectId: string;
  register: RegisterKind;
  text: string;
  mapping?: Partial<ColumnMapping>;
  clientName: string;
  contractorName: string;
}

/** IFR 0,5 · IFA 0,3 · AFC 0,2 — kesepakatan Gundih DAN Petrogas, jadi awal yang jujur. */
const DEFAULT_WEIGHT: Record<string, number> = { IFR: 50, IFA: 30, AFC: 20 };

/** `General Prosedur` → `GENERAL-PROSEDUR`, dan `-2` bila sudah dipakai. */
function codeFor(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'CATEGORY';
  let code = base;
  let n = 2;
  while (taken.has(code)) { code = `${base}-${n}`; n += 1; }
  taken.add(code);
  return code;
}

export function writeSeed(input: SeedInput): { categories: number; documents: number } {
  const clientName = input.clientName.trim();
  const contractorName = input.contractorName.trim();
  if (!clientName) throw new Error('Client name is required');
  if (!contractorName) throw new Error('Contractor name is required');

  const plan = parseRegisterPaste(input.text, input.mapping);
  if (plan.counts.documents === 0) throw new Error('Nothing to add — the list has no documents');

  return db.transaction((tx) => {
    tx.update(schema.projects)
      .set({ clientName, contractorName })
      .where(eq(schema.projects.id, input.projectId))
      .run();

    const existingWeights = tx.select().from(schema.docStageWeights)
      .where(and(
        eq(schema.docStageWeights.projectId, input.projectId),
        eq(schema.docStageWeights.register, input.register),
      )).all();
    if (existingWeights.length === 0) {
      tx.insert(schema.docStageWeights).values(
        STAGE_ORDER.map((stage, order) => ({
          id: randomUUID(),
          projectId: input.projectId,
          register: input.register,
          stage,
          // Resubmission tidak berbobot: ia bukti berapa kali gambar bolak-balik,
          // bukan progress tambahan.
          weight: DEFAULT_WEIGHT[stage] ?? 0,
          order,
        })),
      ).run();
    }

    const existing = tx.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all();

    const taken = new Set(existing.map((c) => c.code));
    const byKey = new Map(existing.map((c) => [`${c.parentId ?? ''}|${c.name.toLowerCase()}`, c.id]));
    let order = existing.reduce((a, c) => Math.max(a, c.order), -1);

    const stack: string[] = [];
    let newCategories = 0;
    let newDocuments = 0;

    for (const category of plan.categories) {
      const parentId = category.depth > 1 ? (stack[category.depth - 2] ?? null) : null;
      const key = `${parentId ?? ''}|${category.name.toLowerCase()}`;
      let id = byKey.get(key);

      if (!id) {
        id = randomUUID();
        order += 1;
        tx.insert(schema.docCategories).values({
          id,
          projectId: input.projectId,
          register: input.register,
          parentId,
          code: codeFor(category.name, taken),
          name: category.name,
          order,
        }).run();
        byKey.set(key, id);
        newCategories += 1;
      }

      stack.length = Math.min(stack.length, category.depth - 1);
      stack[category.depth - 1] = id;

      const siblings = tx.select().from(schema.documents)
        .where(eq(schema.documents.categoryId, id)).all();
      let docOrder = siblings.reduce((a, d) => Math.max(a, d.order), -1);

      for (const doc of category.documents) {
        docOrder += 1;
        tx.insert(schema.documents).values({
          id: randomUUID(),
          projectId: input.projectId,
          register: input.register,
          categoryId: id,
          docNo: doc.docNo,
          title: doc.title,
          kind: doc.kind ?? 'Doc',
          order: docOrder,
        }).run();
        newDocuments += 1;
      }
    }

    return { categories: newCategories, documents: newDocuments };
  });
}
```

- [x] **Step 4: Jalankan sampai lulus**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-register-seed.ts
```

Expected: PASS. Kalau `kode unik` gagal, dua kategori bernama sama di induk berbeda ikut menabrak — perbaiki `codeFor`, bukan ujinya.

- [x] **Step 5: Bungkus jadi server action**

Di `lib/doc-actions.ts`, tepat setelah `addDocument` berakhir (sekitar baris 297), tambahkan:

```ts
/* ------------------------------------------------- membangun register baru */

/**
 * Daftar yang ditempel orang, menjadi register.
 *
 * Sampai ini ada, satu-satunya cara mengisi register adalah menjalankan
 * `scripts/import-edl.ts` — sebuah importer yang ditulis untuk satu workbook.
 * Nama client dan contractor ikut ditanyakan di sini karena register punya dua
 * sisi dan sisi itu bernama: pada EDL Petrogas keduanya adalah judul kolomnya
 * sendiri, "INDOTURBINE Submission" lawan "PETROGAS Response".
 */
export async function seedRegister(input: SeedInput): Promise<ActionResult> {
  try {
    const written = writeSeed(input);
    refreshRegister();
    return { ok: true, changed: written.documents };
  } catch (err) {
    return fail(err);
  }
}
```

Dan di kepala berkas, tambahkan importnya:

```ts
import { writeSeed, type SeedInput } from './register-seed';
```

- [x] **Step 6: Commit**

```bash
git add lib/register-seed.ts lib/doc-actions.ts scripts/verify-register-seed.ts
git commit -m "A pasted list becomes a register, all of it or none of it"
```

---

### Task 4: Layar kosong yang bisa diisi

Deliverable yang terlihat: register kosong berhenti menyuruh orang membuka terminal.

**Files:**
- Create: `components/dokumen/RegisterSeed.tsx`
- Modify: `lib/register.ts` (tambah `getRegisterShape`, dekat `getRegisterWeeks` sekitar baris 266)
- Modify: `app/dokumen/[week]/data/page.tsx`, `app/dokumen/[week]/summary/page.tsx`, `app/dokumen/[week]/vdrl/page.tsx`, `app/dokumen/[week]/vdrl-data/page.tsx`
- Delete: `components/dokumen/EmptyRegister.tsx`

**Interfaces:**
- Consumes: `seedRegister` (Task 3), `parseRegisterPaste` (Task 1).
- Produces:
  ```ts
  export function getRegisterShape(projectId: string, register: RegisterKind): { documents: number; categories: number }
  export function getRegisterParties(projectId: string): { clientName: string; contractorName: string }
  ```

- [x] **Step 1: Tambahkan `getRegisterShape` dan `getRegisterParties`**

Di `lib/register.ts`, setelah `getRegisterWeeks`:

```ts
/**
 * Seberapa jauh register ini ada — dua hitungan murah, bukan seluruh muatannya.
 *
 * Dipakai halaman untuk memutuskan antara layar isi dan layar tempel. Ia tidak
 * boleh memakai `loadRegister`, yang menyerah pada nol dokumen: kategori yang
 * baru dibuat tapi belum diisi tetap register, dan menyembunyikannya berarti
 * melenyapkan pekerjaan orang dari pandangannya.
 */
export function getRegisterShape(projectId: string, register: RegisterKind): {
  documents: number; categories: number;
} {
  const documents = db.select().from(schema.documents)
    .where(and(eq(schema.documents.projectId, projectId), eq(schema.documents.register, register)))
    .all().length;
  const categories = db.select().from(schema.docCategories)
    .where(and(eq(schema.docCategories.projectId, projectId), eq(schema.docCategories.register, register)))
    .all().length;
  return { documents, categories };
}

/**
 * Nama kedua pihak, untuk mengisi layar tempel di muka.
 *
 * Dibaca langsung dari tabel `projects` di SQLite, bukan lewat `lib/data.ts` —
 * berkas itu membaca store JSON yang lama dan tidak tahu-menahu soal tabel ini.
 * Bacaan sinkron seperti ini prerender apa adanya (lihat `lib/sqlite.ts`), jadi
 * ia tidak perlu `'use cache'` dan tidak perlu `<Suspense>`.
 */
export function getRegisterParties(projectId: string): {
  clientName: string; contractorName: string;
} {
  const project = db.select().from(schema.projects)
    .where(eq(schema.projects.id, projectId)).all()[0];
  return { clientName: project?.clientName ?? '', contractorName: project?.contractorName ?? '' };
}
```

- [x] **Step 2: Tulis layarnya**

Buat `components/dokumen/RegisterSeed.tsx`:

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { seedRegister } from '@/lib/doc-actions';
import { parseRegisterPaste, type ColumnMapping } from '@/lib/register-paste';
import type { RegisterKind } from '@/lib/schema';

/**
 * Di mana sebuah register mulai ada.
 *
 * Yang digantikannya menampilkan `node scripts/import-edl.ts` dan tidak
 * menawarkan apa pun — modul ini karena itu hanya bisa dipakai proyek yang
 * datanya sudah diimpor orang lain.
 *
 * Halaman ini menerima daftar apa adanya: ditempel dari Excel dengan tujuh
 * puluh lima kolom dan empat baris judul, atau diketik dua kolom. Yang tidak
 * dilakukannya adalah menjadi Excel — tidak ada kisi sel yang bisa disunting,
 * dan pratinjaunya berbentuk sama dengan tempat kerjanya nanti: daftar
 * kategori, masing-masing dengan jumlah dokumennya.
 */
const EXAMPLE = `GENERAL
WPP-GN-DRE-001\tJadwal Pelaksanaan Pekerjaan
WPP-GN-DRE-002\tWeekly Progress Report
PROCEDURE
WPP-GN-DGS-001\tProsedur Penomoran Dokumen`;

export function RegisterSeed({
  projectId, register, clientName, contractorName,
}: {
  projectId: string;
  register: RegisterKind;
  clientName: string;
  contractorName: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [client, setClient] = useState(clientName);
  const [contractor, setContractor] = useState(contractorName);
  const [text, setText] = useState('');
  const [override, setOverride] = useState<Partial<ColumnMapping>>({});

  const plan = useMemo(() => parseRegisterPaste(text, override), [text, override]);
  const wide = plan.mapping.outline !== null;
  const ready = plan.counts.documents > 0 && client.trim() !== '' && contractor.trim() !== '';
  const label = register === 'edl' ? 'Engineering Drawing List' : 'Vendor Drawing Register List';

  const submit = () => {
    setError(null);
    start(async () => {
      const result = await seedRegister({
        projectId, register, text, mapping: override,
        clientName: client, contractorName: contractor,
      });
      if (!result.ok) setError(result.error);
    });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 pb-16">
      <header className="animate-enter">
        <h1 className="text-2xl font-semibold tracking-tight">Build the {label}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paste the list you already have — from Excel, from Word, or typed by hand.
          Nothing is written until you press the button.
        </p>
      </header>

      {/* ----------------------------------------------------- dua pihaknya */}
      <section className="animate-enter stagger-1 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">Who are the two sides?</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A register has two sides and they have names: one submits, the other responds.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="seed-contractor">Contractor</Label>
            <Input id="seed-contractor" className="h-11" value={contractor}
              onChange={(e) => setContractor(e.target.value)} placeholder="PT. INDOTURBINE" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="seed-client">Client</Label>
            <Input id="seed-client" className="h-11" value={client}
              onChange={(e) => setClient(e.target.value)} placeholder="PETROGAS (BASIN) LTD." />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- daftarnya */}
      <section className="animate-enter stagger-2 rounded-xl border bg-card p-4">
        <h2 className="text-sm font-semibold">The list</h2>
        <Textarea
          className="mt-3 min-h-64 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          aria-label="Paste your document list"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          A line on its own is a category. A line with a number and a title is a document.
          Pasting a whole spreadsheet works too — the headings above the table are ignored.
        </p>
      </section>

      {/* --------------------------------------------- kolom mana yang mana */}
      {wide && (
        <section className="animate-fade-in-up rounded-xl border bg-card p-4">
          <h2 className="text-sm font-semibold">Which column is which?</h2>
          <div className="mt-3 flex flex-wrap gap-4">
            {(['docNo', 'title', 'kind'] as const).map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor={`col-${field}`}>
                  {field === 'docNo' ? 'Number' : field === 'title' ? 'Title' : 'Type'}
                </label>
                {/* Native select: satu baris kontrol, dan tidak menambah portal
                    Radix ke layar yang sudah punya textarea besar. */}
                <select
                  id={`col-${field}`}
                  className="h-11 rounded-md border bg-background px-3 text-sm"
                  value={plan.mapping[field] ?? -1}
                  onChange={(e) => setOverride((o) => ({ ...o, [field]: Number(e.target.value) }))}
                >
                  <option value={-1}>none</option>
                  {plan.columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {`column ${c.index + 1} — ${c.values[0]?.slice(0, 28) || 'empty'}`}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- pratinjau */}
      {text.trim() !== '' && (
        <section className="animate-fade-in-up rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-sm font-semibold">
              {plan.counts.categories} categor{plan.counts.categories === 1 ? 'y' : 'ies'} ·{' '}
              {plan.counts.documents} document{plan.counts.documents === 1 ? '' : 's'}
            </h2>
            {plan.counts.duplicateNumbers > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                {plan.counts.duplicateNumbers} number
                {plan.counts.duplicateNumbers === 1 ? '' : 's'} used more than once
              </span>
            )}
            {plan.problems.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {plan.problems.length} row{plan.problems.length === 1 ? '' : 's'} skipped
                {' '}(line{plan.problems.length === 1 ? '' : 's'}{' '}
                {plan.problems.slice(0, 5).map((p) => p.line).join(', ')})
              </span>
            )}
          </div>

          <ul className="mt-4 flex flex-col gap-1.5">
            {plan.categories.map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate" style={{ paddingLeft: `${(c.depth - 1) * 16}px` }}>
                  {c.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {c.documents.length}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && (
        <p role="alert" className="animate-fade-in-up rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button className="h-11" disabled={!ready || pending} onClick={submit}>
          {pending ? 'Creating…' : 'Create this register'}
        </Button>
      </div>
    </div>
  );
}
```

- [x] **Step 3: Sambungkan keempat halaman**

Pola yang sama di keempatnya. `app/dokumen/[week]/data/page.tsx` menjadi:

```tsx
import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterSeed } from '@/components/dokumen/RegisterSeed';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import {
  getObstacles, getRegisterCards, getRegisterParties, getRegisterShape,
  getRegisterSummary, getRegisterTree,
} from '@/lib/register';

export const metadata = { title: 'EDL Data' };

const PROJECT_ID = 'gundih';

/** Where the engineering register is written to, not just read. */
export default async function EdlDataPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const shape = getRegisterShape(PROJECT_ID, 'edl');
  const summary = shape.documents > 0 ? getRegisterSummary(PROJECT_ID, 'edl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(PROJECT_ID);
    return (
      <RouteTransition id="dokumen-edl-data">
        <RegisterSeed
          projectId={PROJECT_ID}
          register="edl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition id="dokumen-edl-data">
    <RegisterWorkbench
      projectId={PROJECT_ID}
      register="edl"
      tree={getRegisterTree(PROJECT_ID, 'edl', week)}
      cards={getRegisterCards(PROJECT_ID, 'edl', week)}
      obstacles={getObstacles(PROJECT_ID, 'edl', week)}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
    />
    </RouteTransition>
  );
}
```

Kalau `getProject` belum ada di `lib/data.ts`, tambahkan di sana dengan pola yang sama seperti `getProjects()` yang sudah ada — **harus ter-cache**, karena bacaan tak-ter-cache di layout/halaman memblokir build (`Uncached data was accessed outside of <Suspense>`):

```ts
export async function getProject(projectId: string) {
  'use cache';
  return db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0] ?? null;
}
```

Ulangi untuk `summary/page.tsx` (register `edl`), `vdrl/page.tsx` dan `vdrl-data/page.tsx` (register `vdrl`), masing-masing dengan `RouteTransition` id yang sudah dipakai halaman itu.

Jangan menambahkan bacaan ini ke `lib/data.ts`: berkas itu membaca store JSON lama (`readDb`) dan harus ter-cache karena root layout memakainya. `getRegisterParties` membaca SQLite secara sinkron, yang prerender apa adanya.

- [x] **Step 4: Hapus layar lama**

```bash
git rm components/dokumen/EmptyRegister.tsx
grep -rn "EmptyRegister" app components lib
```

Expected: tidak ada hasil.

- [x] **Step 5: Buktikan di layar**

```bash
npx next build > build.log 2>&1; echo $?
```

Expected: `0`.

Lalu jalankan dev server dan potret layar kosongnya. Karena `gundih` sudah berisi, buat proyek kosong untuk dilihat, atau tunjuk `REPORT_DB_PATH` ke salinan yang registernya dikosongkan:

```bash
node scripts/make-empty-db.mjs
```

Jalankan dev dengan `REPORT_DB_PATH=data/empty.db`, lalu:

```bash
node scripts/shoot.mjs http://localhost:3000/dokumen/36/data /tmp/seed-desktop.png 1440 900
node scripts/shoot.mjs http://localhost:3000/dokumen/36/data /tmp/seed-390.png 390 844
```

**Lihat kedua gambarnya.** Yang harus benar: dua field nama tidak berdesakan di 390px, textarea cukup tinggi untuk dilihat isinya, tidak ada yang terpotong ke kanan. Teks yang diekstrak tidak membuktikan apa pun tentang komposisi.

- [x] **Step 6: Tempel sungguhan, lalu lihat hasilnya**

Di layar itu, tempel isi `scripts/fixtures/petrogas-edl.tsv`, isi kedua nama, tekan tombolnya. Expected: halaman berpindah ke workbench, kolom kiri berisi GENERAL → EXECUTION PLAN dan seterusnya. Potret lagi pada dua ukuran dan lihat.

```bash
rm data/empty.db
```

- [x] **Step 7: Commit**

```bash
git add -A components/dokumen app/dokumen lib/register.ts lib/data.ts
git commit -m "An empty register offers a place to paste, not a command to run"
```

---

### Task 5: Merawat isinya — action

Kategori dan dokumen bisa ditambah, diganti nama, dan dihapus. Tanpa ini, salah tempel hanya bisa dibereskan lewat database.

**Files:**
- Modify: `lib/doc-actions.ts` (tambah di bawah `seedRegister`)

**Interfaces:**
- Consumes: `ActionResult`, `refreshRegister`, `fail` yang sudah ada di berkas itu.
- Produces:
  ```ts
  export async function addCategory(input: { projectId: string; register: RegisterKind; name: string; parentId: string | null }): Promise<ActionResult>
  export async function renameCategory(input: { projectId: string; register: RegisterKind; categoryId: string; name: string }): Promise<ActionResult>
  export async function deleteCategory(input: { projectId: string; register: RegisterKind; categoryId: string }): Promise<ActionResult>
  export async function deleteDocument(input: { projectId: string; register: RegisterKind; documentId: string }): Promise<ActionResult>
  ```

- [x] **Step 1: Tulis keempatnya**

Di `lib/doc-actions.ts`:

```ts
/* ------------------------------------------------------- merawat isinya */

/**
 * Kategori boleh dihapus HANYA ketika sudah kosong.
 *
 * `docCategories` punya `onDelete: cascade` ke `documents`: menghapus kategori
 * berisi akan melenyapkan dokumennya beserta seluruh riwayat tahapnya tanpa
 * ada yang bertanya. Syarat ini yang berdiri di antaranya.
 */
export async function deleteCategory(input: {
  projectId: string; register: RegisterKind; categoryId: string;
}): Promise<ActionResult> {
  try {
    const category = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all()[0];
    if (!category) throw new Error('Category not found');

    const docs = db.select().from(schema.documents)
      .where(eq(schema.documents.categoryId, category.id)).all();
    if (docs.length > 0) {
      throw new Error(`Empty it first — ${docs.length} document${docs.length === 1 ? '' : 's'} still inside`);
    }

    const children = db.select().from(schema.docCategories)
      .where(eq(schema.docCategories.parentId, category.id)).all();
    if (children.length > 0) throw new Error('Delete the groups inside it first');

    db.delete(schema.docCategories).where(eq(schema.docCategories.id, category.id)).run();
    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

export async function addCategory(input: {
  projectId: string; register: RegisterKind; name: string; parentId: string | null;
}): Promise<ActionResult> {
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Category name is required');

    const siblings = db.select().from(schema.docCategories)
      .where(and(
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).all();

    if (siblings.some((c) => (c.parentId ?? null) === input.parentId
      && c.name.toLowerCase() === name.toLowerCase())) {
      throw new Error(`"${name}" is already here`);
    }

    const taken = new Set(siblings.map((c) => c.code));
    const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'CATEGORY';
    let code = base;
    let n = 2;
    while (taken.has(code)) { code = `${base}-${n}`; n += 1; }

    db.insert(schema.docCategories).values({
      id: randomUUID(),
      projectId: input.projectId,
      register: input.register,
      parentId: input.parentId,
      code,
      name,
      order: siblings.reduce((a, c) => Math.max(a, c.order), -1) + 1,
    }).run();

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

export async function renameCategory(input: {
  projectId: string; register: RegisterKind; categoryId: string; name: string;
}): Promise<ActionResult> {
  try {
    const name = input.name.trim();
    if (!name) throw new Error('Category name is required');

    const updated = db.update(schema.docCategories)
      .set({ name })
      .where(and(
        eq(schema.docCategories.id, input.categoryId),
        eq(schema.docCategories.projectId, input.projectId),
        eq(schema.docCategories.register, input.register),
      )).run();
    if (updated.changes === 0) throw new Error('Category not found');

    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Menghapus dokumen menghapus riwayatnya — itu memang yang diminta, dan
 * `doc_stages` sudah cascade dari `documents`. Yang berubah diam-diam adalah
 * penyebutnya: setiap persentase di kategori ini dihitung ulang dari jumlah
 * dokumen yang tersisa.
 */
export async function deleteDocument(input: {
  projectId: string; register: RegisterKind; documentId: string;
}): Promise<ActionResult> {
  try {
    const [doc] = ownedDocuments(input.projectId, input.register, [input.documentId]);
    db.delete(schema.documents).where(eq(schema.documents.id, doc.id)).run();
    refreshRegister();
    return { ok: true, changed: 1 };
  } catch (err) {
    return fail(err);
  }
}
```

- [x] **Step 2: Periksa tipe**

```bash
npx tsc --noEmit -p tsconfig.json > tsc.log 2>&1; echo $?
```

Expected: `0`. (Berkas `tsconfig.json` di repo ini sudah disaring untuk keperluan ini — jangan mengubahnya.)

- [x] **Step 3: Commit**

```bash
git add lib/doc-actions.ts
git commit -m "A category can be added, renamed, and — when empty — removed"
```

---

### Task 6: Workbench yang merawat

**Files:**
- Modify: `components/dokumen/RegisterWorkbench.tsx` (baris 151-161 untuk `groups`, header grup sekitar baris 425-435, kaki kolom kiri sekitar baris 380)
- Create: `components/dokumen/CategoryDialog.tsx`

**Interfaces:**
- Consumes: `addCategory`, `renameCategory`, `deleteCategory`, `deleteDocument` (Task 5).
- Produces: tidak ada modul baru yang dikonsumsi task lain.

- [x] **Step 1: Tampilkan kategori kosong**

Di `components/dokumen/RegisterWorkbench.tsx`, ubah `walk` (baris 153-160):

```tsx
    const walk = (node: RegisterNode, packageName: string) => {
      if (node.children.length === 0) {
        // Kategori berdokumen-nol IKUT tampil. Sebelumnya `node.documents > 0`,
        // yang benar selama register hanya bisa datang dari importer — tapi
        // kategori yang baru dibuat orang lahir kosong, dan menyembunyikannya
        // berarti tidak ada tempat untuk menekan Add.
        out.push({ id: node.id, name: node.name, packageName, node });
        return;
      }
      for (const child of node.children) walk(child, node.name);
    };
```

- [x] **Step 2: Dialog kategori**

Buat `components/dokumen/CategoryDialog.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addCategory, renameCategory } from '@/lib/doc-actions';
import type { RegisterKind } from '@/lib/schema';

/**
 * Satu dialog untuk dua pekerjaan yang bentuknya sama: satu nama, satu tombol.
 * Dua dialog terpisah hanya akan menggandakan penanganan galat yang identik.
 */
export function CategoryDialog({
  open, onOpenChange, projectId, register, editing, parentId, parentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  register: RegisterKind;
  /** Ada = ganti nama; tidak ada = buat baru. */
  editing?: { id: string; name: string };
  parentId: string | null;
  parentName: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(editing?.name ?? '');

  const submit = () => {
    setError(null);
    start(async () => {
      const result = editing
        ? await renameCategory({ projectId, register, categoryId: editing.id, name })
        : await addCategory({ projectId, register, name, parentId });
      if (!result.ok) { setError(result.error); return; }
      setName('');
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Rename group' : 'Add group'}</DialogTitle>
          <DialogDescription>
            {editing ? 'It keeps its documents.' : parentName ? `Inside ${parentName}.` : 'At the top level.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="category-name">Name</Label>
          <Input id="category-name" className="h-11" value={name} onChange={(e) => setName(e.target.value)} />
          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" className="h-11" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button className="h-11" onClick={submit} disabled={pending || !name.trim()}>
            {pending ? 'Saving…' : editing ? 'Rename' : 'Add'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [x] **Step 3: Pasang di workbench**

`components/ui/dropdown-menu.tsx` belum ada di repo ini. Ambil dulu — `shadcn add` aman, ia hanya menyentuh `components/ui/`:

```bash
npx shadcn add dropdown-menu
```

**Jangan `shadcn init`.** Ia menulis ulang berkas tema dan pernah menukar font, dan laporan di repo ini bergantung pada Inter yang resolusinya sama di setiap mesin.

Di `RegisterWorkbench.tsx`, di sebelah import dinamis `AddDocumentDialog` yang sudah ada (baris 20):

```tsx
const CategoryDialog = dynamic(() => import('./CategoryDialog').then((m) => m.CategoryDialog));
```

DropdownMenu diimpor biasa, bukan lewat `next/dynamic`: aturan lazy-load di AGENTS.md menyebut Dialog, Command, Sheet dan Popover — bukan DropdownMenu — dan pemicunya harus ada sejak render pertama supaya tombolnya bisa ditekan sebelum bundle overlay tiba.

```tsx
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteCategory } from '@/lib/doc-actions';
```

Dan tambahkan `FolderPlus, MoreHorizontal` ke import `lucide-react` di baris 6.

State baru, di sebelah `adding`:

```tsx
  const [categoryDialog, setCategoryDialog] = useState<
    { mode: 'add'; parentId: string | null; parentName: string | null }
    | { mode: 'rename'; id: string; name: string }
    | null
  >(null);
```

Tombol di kaki kolom kiri, setelah daftar grup ditutup:

```tsx
  <Button
    variant="outline"
    className="h-11 w-full"
    onClick={() => setCategoryDialog({ mode: 'add', parentId: null, parentName: null })}
  >
    <FolderPlus className="mr-1.5 h-4 w-4" /> Add group
  </Button>
```

Satu DropdownMenu di header grup, di sebelah tombol `Add` yang sudah ada — **satu instance untuk grup yang sedang dibuka**, bukan satu per kartu:

```tsx
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Group actions">
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuItem
        onSelect={() => setCategoryDialog({ mode: 'rename', id: selected.id, name: selected.name })}
      >
        Rename group
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={selected.node.documents > 0}
        onSelect={async () => {
          const result = await deleteCategory({ projectId, register, categoryId: selected.id });
          if (result.ok) { setSelectedId(null); setOpenDoc(null); }
        }}
      >
        {selected.node.documents > 0 ? 'Delete group (empty it first)' : 'Delete group'}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
```

Dan dialognya, di sebelah `<AddDocumentDialog … />` yang sudah ada:

```tsx
  {categoryDialog && (
    <CategoryDialog
      open
      onOpenChange={(o) => { if (!o) setCategoryDialog(null); }}
      projectId={projectId}
      register={register}
      editing={categoryDialog.mode === 'rename' ? { id: categoryDialog.id, name: categoryDialog.name } : undefined}
      parentId={categoryDialog.mode === 'add' ? categoryDialog.parentId : null}
      parentName={categoryDialog.mode === 'add' ? categoryDialog.parentName : null}
    />
  )}
```

- [x] **Step 4: Tandai nomor yang dipakai dua kali**

Di `RegisterWorkbench.tsx`, hitung sekali dari `cards`:

```tsx
  /**
   * Nomor yang dipakai lebih dari sekali. Register menerimanya — data nyata
   * memang begitu — tapi menerima tanpa mengatakan berarti orang menemukannya
   * saat sudah jadi sengketa.
   */
  const duplicateNumbers = useMemo(() => {
    const seen = new Map<string, number>();
    for (const list of Object.values(cards)) {
      for (const d of list) if (d.docNo) seen.set(d.docNo, (seen.get(d.docNo) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([no]) => no));
  }, [cards]);
```

Pada kartu dokumen, di sebelah nomornya:

```tsx
  {doc.docNo && duplicateNumbers.has(doc.docNo) && (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
      number used twice
    </span>
  )}
```

- [x] **Step 5: Lihat hasilnya**

```bash
npx next build > build.log 2>&1; echo $?
node scripts/shoot.mjs http://localhost:3000/dokumen/36/data /tmp/wb-desktop.png 1440 900
node scripts/shoot.mjs http://localhost:3000/dokumen/36/data /tmp/wb-390.png 390 844
```

Expected build `0`. **Lihat gambarnya:** tombol Add group terlihat di kaki kolom kiri tanpa menutupi kartu terakhir; header grup tidak jadi berdesakan oleh tombol ketiga di 390px.

- [x] **Step 6: Commit**

```bash
git add components/dokumen/RegisterWorkbench.tsx components/dokumen/CategoryDialog.tsx
git commit -m "The register can be tended: groups added, renamed, emptied, removed"
```

---

### Task 7: Bobot tahap yang bisa diubah

**Files:**
- Create: `components/dokumen/StageWeightsCard.tsx`
- Modify: `lib/doc-actions.ts` (tambah `saveStageWeights`)
- Modify: `lib/register.ts` (tambah `getStageWeights`)
- Modify: `app/dokumen/[week]/summary/page.tsx`

**Interfaces:**
- Consumes: `ActionResult` dari `lib/doc-actions.ts`.
- Produces:
  ```ts
  export function getStageWeights(projectId: string, register: RegisterKind): { stage: DocStage; weight: number }[]
  export async function saveStageWeights(input: { projectId: string; register: RegisterKind; weights: { stage: string; weight: number }[] }): Promise<ActionResult>
  ```

- [x] **Step 1: Bacaannya**

Di `lib/register.ts`:

```ts
/** Bobot tahap apa adanya, termasuk yang nol — layar pengaturannya perlu semuanya. */
export function getStageWeights(projectId: string, register: RegisterKind) {
  return db.select().from(schema.docStageWeights)
    .where(and(
      eq(schema.docStageWeights.projectId, projectId),
      eq(schema.docStageWeights.register, register),
    )).all()
    .sort((a, b) => a.order - b.order)
    .map((w) => ({ stage: w.stage, weight: w.weight }));
}
```

- [x] **Step 2: Penulisnya**

Di `lib/doc-actions.ts`:

```ts
/**
 * Bobot tahap adalah kesepakatan per proyek, bukan hukum — Gundih dan Petrogas
 * sama-sama 0,5/0,3/0,2, tapi kontrak lain boleh lain. Yang tidak boleh adalah
 * berjumlah selain 100: setiap persentase register dihitung darinya, dan
 * jumlah 90 berarti dokumen yang selesai penuh terbaca 90%.
 */
export async function saveStageWeights(input: {
  projectId: string; register: RegisterKind; weights: { stage: string; weight: number }[];
}): Promise<ActionResult> {
  try {
    const total = input.weights.reduce((a, w) => a + w.weight, 0);
    if (Math.abs(total - 100) > 0.001) throw new Error(`The weights add up to ${total}, not 100`);

    db.transaction((tx) => {
      for (const { stage, weight } of input.weights) {
        if (weight < 0) throw new Error('A weight cannot be negative');
        tx.update(schema.docStageWeights)
          .set({ weight })
          .where(and(
            eq(schema.docStageWeights.projectId, input.projectId),
            eq(schema.docStageWeights.register, input.register),
            eq(schema.docStageWeights.stage, assertStage(stage)),
          )).run();
      }
    });

    refreshRegister();
    return { ok: true, changed: input.weights.length };
  } catch (err) {
    return fail(err);
  }
}
```

- [x] **Step 3: Kartunya**

Buat `components/dokumen/StageWeightsCard.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveStageWeights } from '@/lib/doc-actions';
import { STAGE_FULL, STAGE_LABEL } from '@/lib/register-shared';
import type { DocStage, RegisterKind } from '@/lib/schema';

/**
 * Tiga angka yang menentukan setiap persentase di register ini.
 *
 * Hanya tahap berbobot yang ditampilkan — resubmission memang nol dan
 * memperlihatkannya sebagai kotak isian hanya mengundang orang mengisinya.
 */
export function StageWeightsCard({
  projectId, register, weights,
}: {
  projectId: string;
  register: RegisterKind;
  weights: { stage: DocStage; weight: number }[];
}) {
  const weighted = weights.filter((w) => w.weight > 0);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(weighted.map((w) => [w.stage, String(w.weight)])),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const total = Object.values(values).reduce((a, v) => a + (Number(v) || 0), 0);

  const submit = () => {
    setError(null); setSaved(false);
    start(async () => {
      const result = await saveStageWeights({
        projectId, register,
        weights: Object.entries(values).map(([stage, v]) => ({ stage, weight: Number(v) || 0 })),
      });
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
    });
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">How much each stage is worth</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        A per-contract agreement. Every percentage in this register is computed from it.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        {weighted.map((w) => (
          <div key={w.stage} className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor={`w-${w.stage}`}>
              {STAGE_LABEL[w.stage]} — {STAGE_FULL[w.stage]}
            </label>
            <Input
              id={`w-${w.stage}`} inputMode="decimal" className="h-11 w-24 tabular-nums"
              value={values[w.stage] ?? ''}
              onChange={(e) => { setSaved(false); setValues((v) => ({ ...v, [w.stage]: e.target.value })); }}
            />
          </div>
        ))}
        <span className={`text-sm tabular-nums ${Math.abs(total - 100) > 0.001 ? 'text-rose-600' : 'text-muted-foreground'}`}>
          total {total}
        </span>
        <Button className="ml-auto h-11" onClick={submit} disabled={pending || Math.abs(total - 100) > 0.001}>
          {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="animate-fade-in-up mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </p>
      )}
    </section>
  );
}
```

- [x] **Step 4: Pasang di Summary**

Di `app/dokumen/[week]/summary/page.tsx`, di bawah isi yang sudah ada, di dalam `RouteTransition`:

```tsx
<StageWeightsCard
  projectId={PROJECT_ID}
  register="edl"
  weights={getStageWeights(PROJECT_ID, 'edl')}
/>
```

Lakukan hal yang sama di `app/dokumen/[week]/vdrl/page.tsx` dengan `register="vdrl"`.

- [x] **Step 5: Buktikan penolakan bekerja**

```bash
npx next build > build.log 2>&1; echo $?
```

Lalu di layar Summary: ubah IFR menjadi 60 (total 110) — tombol Save harus mati dan angka total merah. Kembalikan ke 50, Save, muat ulang halaman: angka register tidak berubah. Ubah IFR 40 / IFA 40 / AFC 20, Save, muat ulang: persentase kategori berubah. Kembalikan ke 50/30/20.

```bash
node scripts/shoot.mjs http://localhost:3000/dokumen/36/summary /tmp/weights-390.png 390 844
```

**Lihat gambarnya** — tiga kotak dan tombolnya tidak boleh membungkus jadi empat baris di 390px.

- [x] **Step 6: Commit**

```bash
git add components/dokumen/StageWeightsCard.tsx lib/doc-actions.ts lib/register.ts app/dokumen
git commit -m "The stage weights are a contract agreement, so they can be changed"
```

---

### Task 8: Verifikasi akhir

**Files:** tidak ada yang dibuat; ini gerbang sebelum pekerjaan disebut selesai.

- [x] **Step 1: Semua uji**

```bash
node scripts/verify-register-paste.ts
node scripts/verify-register-seed.ts
node scripts/verify-edl.ts
node scripts/verify-worklist.ts
```

Expected: keempatnya `all checks passed`. Dua yang terakhir membuktikan register Gundih yang sudah ada tidak berubah artinya oleh pekerjaan ini.

- [x] **Step 2: Build**

```bash
npx next build > build.log 2>&1; echo $?
```

Expected: `0`. Kalau gagal dengan "Uncached data was accessed outside of `<Suspense>`", penyebabnya hampir pasti bacaan baru di halaman yang belum ter-cache — lihat `getProject` di Task 4.

- [x] **Step 3: Perjalanan lengkap di database kosong**

```bash
node scripts/make-empty-db.mjs --all
node -e "const d=require('better-sqlite3')('data/report.db');d.exec(\"delete from documents; delete from doc_categories; delete from doc_stage_weights;\")"
```

Jalankan dev, buka `/dokumen/36/data`, tempel `scripts/fixtures/petrogas-edl.tsv`, isi kedua nama, buat. Lalu:

- kolom kiri berisi 36 grup dalam tiga tingkat
- buka EXECUTION PLAN → tiga dokumen
- Add group → tampil, kosong, dengan tombol Add-nya
- hapus grup kosong itu → hilang
- hapus grup berisi → ditolak dengan alasannya
- kartu `WPP-IN-LAY-003` bertanda "number used twice"

```bash
# tidak ada yang dikembalikan: data/report.db tidak pernah disentuh
```

- [x] **Step 4: Potret dua ukuran, lalu lihat**

```bash
node scripts/shoot.mjs http://localhost:3000/dokumen/36/data /tmp/final-390.png 390 844
node scripts/shoot.mjs http://localhost:3000/dokumen/36/data /tmp/final-desktop.png 1440 900
node scripts/shoot.mjs http://localhost:3000/dokumen/36/summary /tmp/final-summary-390.png 390 844
```

**Lihat ketiganya.** Teks yang diekstrak menunjukkan isi, tidak pernah komposisi.

- [x] **Step 5: Commit terakhir**

```bash
git add -A
git commit -m "Item 15 finishes the way it should have started: you can build the register"
```

---

## Catatan untuk yang mengerjakan

- **Jangan menjalankan `shadcn init`.** Ia menulis ulang berkas tema dan pernah menukar font — laporan di repo ini bergantung pada Inter yang resolusinya sama di mana-mana. `shadcn add <component>` aman.
- Yang sudah ada di `components/ui/`: `textarea`, `label`, `input`, `button`, `dialog`, `card`, `badge`. Yang **belum** dan harus diambil: `dropdown-menu` (Task 6).
- `size`, `revision` dan `priority` **tidak** ikut diimpor dari tempelan meski kolomnya ada di tabel. Tebakan kolom untuk ketiganya tidak cukup andal, dan salah tebak yang diam lebih buruk daripada kolom yang kosong. Itu menyempit dari spec dengan sengaja.
- Kalau sebuah langkah gagal karena spec-nya keliru, **berhenti dan katakan** — jangan mengubah angka di uji supaya cocok dengan hasil.
