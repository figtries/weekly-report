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
