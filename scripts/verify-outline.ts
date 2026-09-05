/**
 * Membuktikan satu aturan bentuk dipakai di tiga tempat: membaca, menulis, dan
 * membangun. B = judul besar, B.1 = judul utama, B.1.1 = sub judul, baris
 * bernomor di bawahnya = dokumen.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-outline.ts
 */
import { readFileSync } from 'node:fs';
import { outlineCode, outlineLevel } from '../lib/register-outline.ts';
import { parseRegisterPaste } from '../lib/register-paste.ts';

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
};

console.log('kode outline disusun dari posisi');
check('[1]', outlineCode([1]), 'A');
check('[2]', outlineCode([2]), 'B');
check('[2,1]', outlineCode([2, 1]), 'B.1');
check('[2,1,1]', outlineCode([2, 1, 1]), 'B.1.1');

console.log('\nkedalaman menentukan tingkatnya, bukan yang lain');
check('B', outlineLevel(1), 'heading');
check('B.1', outlineLevel(2), 'section');
check('B.1.1', outlineLevel(3), 'group');

console.log('\ndibaca dari bentuk yang persis seperti sheet-nya');
const plan = parseRegisterPaste([
  '\tB\tDETAIL ENGINEERING',
  '\tB.1\tPROCESS',
  '\tB.1.1\tProces Study/report',
  '\t18\tWPP-PC-DSY-001\t\tB\t\tPRIORITAS-1\tProcess Simulation Report\tA4\t1\tDoc',
  '\t19\tWPP-PC-DSY-002\t\tA\t\tPRIORITAS-1\tHydraulic Calculation Report\tA4\t1\tDoc',
  '\tB.1.2\tScehedule',
  '\t22\tWPP-PC-DSC-001\t\tA\t\tPRIORITAS-1\tHazard Area Classification Schedule\tA3\t1\tDwg',
].join('\n'));

check('judul besar', plan.categories.filter((c) => c.depth === 1).length, 1);
check('judul utama', plan.categories.filter((c) => c.depth === 2).length, 1);
check('sub judul', plan.categories.filter((c) => c.depth === 3).length, 2);
check('nama judul besar', plan.categories[0].name, 'DETAIL ENGINEERING');
check('nama sub judul pertama', plan.categories[2].name, 'Proces Study/report');
check('dokumen di sub judul pertama', plan.categories[2].documents.length, 2);
check('dokumen di sub judul kedua', plan.categories[3].documents.length, 1);
check('judul besar tidak memuat dokumen', plan.categories[0].documents.length, 0);
check('judul utama tidak memuat dokumen', plan.categories[1].documents.length, 0);

console.log('\ndokumen boleh menempel langsung di judul utama');
const direct = parseRegisterPaste([
  '\tA\tGENERAL',
  '\tA.1\tEXECUTION PLAN',
  '\t1\tWPP-GN-DRE-001\t\tA\t\tPRIORITAS-1\tJadwal Pelaksanaan Pekerjaan\tA4\t1\tDoc',
  '\t2\tWPP-GN-DRE-002\t\t0\t\tPRIORITAS-2\tWeekly Progress Report\tA4\t1\tDoc',
].join('\n'));
check('tanpa sub judul', direct.categories.filter((c) => c.depth === 3).length, 0);
check('dokumen di judul utama', direct.categories[1].documents.length, 2);

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
