/**
 * The EDL/VDRL builder's model, proved without a browser.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-builder-model.ts
 */
import {
  addSub, countDocuments, fromOutline, fromPaste, headingSuggestions, newHeading,
  renumber, rowsFromText, subSuggestions, toDraftGroups,
} from '../lib/builder-model.ts';
import { defaultRule } from '../lib/register-numbering.ts';
import { parseRegisterPaste } from '../lib/register-paste.ts';

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};

console.log('suggestions come from the template');
check('EDL headings', headingSuggestions('edl'),
  ['GENERAL', 'PROCESS', 'CIVIL', 'MECHANICAL', 'PIPING', 'ELECTRICAL', 'INSTRUMENT']);
check('GENERAL subs', subSuggestions('edl', 'GENERAL'), ['Execution Plan', 'Procedure']);
check('ELECTRICAL first sub', subSuggestions('edl', 'Electrical')[0], 'Electrical Calculation & Study');
check('own heading has none', subSuggestions('edl', 'COMMISSIONING'), []);
check('VDRL has no headings', headingSuggestions('vdrl'), []);

console.log('\nrows from typed or pasted lines');
const rows = rowsFromText('Project Execution Plan\n\n  Project Quality Plan  \n');
check('two rows, trimmed', rows.map((r) => r.title), ['Project Execution Plan', 'Project Quality Plan']);
check('typed rows are picked Doc', rows.map((r) => [r.picked, r.kind, r.fromSource]),
  [[true, 'Doc', false], [true, 'Doc', false]]);

console.log("\na first sub-heading takes the heading's documents");
let general = { ...newHeading('GENERAL'), rows };
general = addSub(general, 'Execution Plan');
check('heading rows emptied', general.rows.length, 0);
check('sub holds them', general.subs[0].rows.length, 2);
general = addSub(general, 'Procedure');
check('second sub starts empty', general.subs[1].rows.length, 0);
general.subs[1].rows = rowsFromText('Document Control Procedure');

console.log('\nnumbers follow the project rule');
const instrument = { ...newHeading('INSTRUMENT'), rows: rowsFromText('Control Valve Datasheet\nInstrument Location Layout') };
instrument.rows[1].kind = 'Dwg';
const numbered = renumber([general, instrument], defaultRule('JPI'), []);
check('execution plan numbers', numbered[0].subs[0].rows.map((r) => r.docNo), ['JPI-GN-DRE-001', 'JPI-GN-DRE-002']);
check('procedure number', numbered[0].subs[1].rows[0].docNo, 'JPI-GN-DGS-001');
check('instrument numbers', numbered[1].rows.map((r) => r.docNo), ['JPI-IN-DDS-001', 'JPI-IN-GDW-001']);
const continued = renumber([instrument], defaultRule('JPI'), ['JPI-IN-DDS-004']);
check('sequence continues past taken', continued[0].rows[0].docNo, 'JPI-IN-DDS-005');
const hand = renumber([{ ...instrument, rows: [{ ...instrument.rows[0], docNo: 'X-1', auto: false }] }], defaultRule('JPI'), []);
check('hand-typed number kept', hand[0].rows[0].docNo, 'X-1');
const blank = renumber([{ ...instrument, rows: [{ ...instrument.rows[0], title: '  ' }] }], defaultRule('JPI'), []);
check('a row with no title gets no number', blank[0].rows[0].docNo, '');

console.log('\ndraft groups: heading path, or heading and sub');
const groups = toDraftGroups(numbered);
check('paths', groups.map((g) => g.path), [['GENERAL', 'Execution Plan'], ['GENERAL', 'Procedure'], ['INSTRUMENT']]);
check('kinds kept', groups[2].documents.map((d) => d.kind), ['Doc', 'Dwg']);
check('count', countDocuments(numbered), 5);
const planned = renumber([{ ...instrument, rows: [{ ...instrument.rows[0], planIfr: '2026-10-20' }] }], defaultRule('JPI'), []);
check('plan IFR travels', toDraftGroups(planned)[0].documents[0].planIfr, '2026-10-20');

console.log('\nunticked rows from a source are left out');
const copied = fromOutline([{
  name: 'Instrument & Control',
  documents: [{ title: 'Instrument Index', kind: 'Doc' }, { title: 'DCS / ESD Panel Layout', kind: 'Dwg' }],
  subheadings: [],
}]);
check('copied rows are picked and from source', copied[0].rows.map((r) => [r.picked, r.fromSource]), [[true, true], [true, true]]);
copied[0].rows[1].picked = false;
check('unpicked dropped', toDraftGroups(renumber(copied, defaultRule('JPI'), []))[0].documents.map((d) => d.title), ['Instrument Index']);

console.log('\npaste: depth 1 is a heading, a deeper leaf is a sub-heading');
const plan = parseRegisterPaste([
  'A\tGENERAL',
  'A.2\tPROCEDURE',
  'A.2.1\tGeneral Prosedur',
  '1\tWPP-GN-DGS-001\tDocument Control Procedure',
  'B\tELECTRICAL',
  '1\tWPP-EL-GDW-001\tSingle Line Diagram\tDwg',
].join('\n'));
const pasted = fromPaste(plan);
check('headings', pasted.map((h) => h.name), ['GENERAL', 'ELECTRICAL']);
check('general sub', pasted[0].subs.map((s) => s.name), ['General Prosedur']);
check('pasted number kept, not auto', pasted[0].subs[0].rows.map((r) => [r.docNo, r.auto]), [['WPP-GN-DGS-001', false]]);
check('electrical row on the heading', pasted[1].rows.map((r) => [r.title, r.kind]), [['Single Line Diagram', 'Dwg']]);

if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall passed');
