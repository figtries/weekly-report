/**
 * Membuktikan pakem penomoran menghasilkan nomor yang bentuknya sama dengan
 * nomor asli di dua register nyata — bukan bentuk karangan.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-numbering.ts
 */
import { defaultRule, disciplineFor, kindLetter, nextNumber, typeFor, detectPrefix } from '../lib/register-numbering.ts';

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
};

console.log('huruf pertama kode jenis mengikuti Doc/Dwg');
check('Doc', kindLetter('Doc'), 'D');
check('Dwg', kindLetter('Dwg'), 'G');

console.log('\ndisiplin per seksi, seperti di Petrogas');
check('PROCESS', disciplineFor('PROCESS'), 'PC');
check('CIVIL', disciplineFor('CIVIL'), 'CV');
check('MECHANICAL', disciplineFor('MECHANICAL'), 'ME');
check('PIPING', disciplineFor('PIPING'), 'PG');
check('ELECTRICAL', disciplineFor('ELECTRICAL'), 'EL');
check('INSTRUMENT', disciplineFor('INSTRUMENT'), 'IN');
check('seksi tak dikenal', disciplineFor('Marine Works'), 'MW');

console.log('\njenis per grup');
check('Electrical Datasheet', typeFor('Electrical Datasheet'), 'DS');
check('Civil Calculation', typeFor('Civil Calculation'), 'CC');
check('Piping Bill of Material', typeFor('Piping Bill of Material'), 'MT');
check('General Procedure', typeFor('General Procedure'), 'GS');
check('Instrument Drawing', typeFor('Instrument Drawing'), 'DW');
check('Electrical List', typeFor('Electrical List'), 'LS');

console.log('\nnomor tersusun, dan bentuknya sama dengan yang asli');
const rule = defaultRule('WPP');
check('datasheet listrik (Doc)', nextNumber(rule, 'ELECTRICAL', 'Electrical Datasheet', 'Doc', []), 'WPP-EL-DDS-001');
check('gambar listrik (Dwg)', nextNumber(rule, 'ELECTRICAL', 'Electrical Drawing', 'Dwg', []), 'WPP-EL-GDW-001');
check('kalkulasi sipil', nextNumber(rule, 'CIVIL', 'Civil Calculation', 'Doc', []), 'WPP-CV-DCC-001');

console.log('\nurutan meneruskan yang sudah ada, bukan mengulang dari 001');
const taken = ['WPP-EL-DDS-001', 'WPP-EL-DDS-007', 'WPP-EL-GDW-003', 'PRGG-20-E0-DS-009'];
check('lanjut ke 008', nextNumber(rule, 'ELECTRICAL', 'Electrical Datasheet', 'Doc', taken), 'WPP-EL-DDS-008');
check('grup lain tidak terpengaruh', nextNumber(rule, 'CIVIL', 'Civil Drawing', 'Dwg', taken), 'WPP-CV-GDW-001');

console.log('\npakem bisa ditimpa per seksi dan per grup');
const custom = { prefix: 'PRGG', disciplines: { ELECTRICAL: '20-E0' }, types: { 'Electrical Datasheet': 'S' }, digits: 3 };
check('ikut yang ditetapkan', nextNumber(custom, 'ELECTRICAL', 'Electrical Datasheet', 'Doc', []), 'PRGG-20-E0-DS-001');

console.log('\nprefix ditebak dari nomor yang sudah ada');
check('Gundih', detectPrefix(['PRGG-00-G0-SC-001', 'PRGG-20-E0-DS-002', 'PPGJ-PRO-UFD-1']), 'PRGG');
check('kosong', detectPrefix([]), null);

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
