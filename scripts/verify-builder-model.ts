/**
 * The EDL/VDRL builder's model, proved without a browser.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-builder-model.ts
 */
import {
  addDocs, addHeadings, canHold, countDocuments, countNewHeadings, findNode, fromExisting, fromOutline,
  fromPaste, guessKind, linesOf, removeNode, renumber, toDraftGroups, updateDoc, type BuilderNode,
} from '../lib/builder-model.ts';
import { defaultRule } from '../lib/register-numbering.ts';
import { parseRegisterPaste } from '../lib/register-paste.ts';

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};
const id = (t: BuilderNode[], ...names: string[]) => {
  let list = t;
  let node: BuilderNode | undefined;
  for (const n of names) { node = list.find((x) => x.name === n); list = node?.children ?? []; }
  if (!node) throw new Error(`no ${names.join(' > ')}`);
  return node.id;
};

console.log('main headings from typed or pasted lines');
check('lines trimmed, blanks dropped', linesOf('GENERAL\n\n  PROCESS  \n'), ['GENERAL', 'PROCESS']);
let tree = addHeadings([], null, ['GENERAL', 'PROCESS', 'general']);
check('a repeated name is not doubled', tree.map((n) => n.name), ['GENERAL', 'PROCESS']);

console.log('\nsub and sub-sub headings go in by pressing the mother');
tree = addHeadings(tree, id(tree, 'GENERAL'), ['Execution Plan', 'Procedure']);
tree = addHeadings(tree, id(tree, 'GENERAL', 'Procedure'), ['General Procedure']);
check('three levels', tree[0].children.map((c) => [c.name, c.children.map((x) => x.name)]),
  [['Execution Plan', []], ['Procedure', ['General Procedure']]]);
const third = findNode(tree, id(tree, 'GENERAL', 'Procedure', 'General Procedure'))!;
check('third level takes documents, not headings', canHold(third.node, third.depth), { headings: false, documents: true });
const second = findNode(tree, id(tree, 'GENERAL', 'Procedure'))!;
check('a heading with headings under it takes no documents', canHold(second.node, second.depth), { headings: true, documents: false });

console.log('\nan edit copies only the path to it');
const before = tree;
tree = addDocs(tree, id(tree, 'GENERAL', 'Execution Plan'), ['Project Execution Plan', 'Overall Plot Plan Layout']);
check('PROCESS untouched (same object)', tree[1] === before[1], true);
check('Procedure untouched (same object)', tree[0].children[1] === before[0].children[1], true);
check('kind guessed from the title', tree[0].children[0].docs.map((d) => d.kind), ['Doc', 'Dwg']);
check('guessKind', [guessKind('Single Line Diagram'), guessKind('Instrument Index')], ['Dwg', 'Doc']);

console.log("\nthe first sub-heading takes its mother's new documents");
tree = addDocs(tree, id(tree, 'PROCESS'), ['Process Datasheet A']);
tree = addHeadings(tree, id(tree, 'PROCESS'), ['Datasheet']);
check('moved', [tree[1].docs.length, tree[1].children[0].docs.map((d) => d.title)], [0, ['Process Datasheet A']]);

console.log('\nnumbers follow the project rule');
const rule = defaultRule('JPI');
tree = addDocs(tree, id(tree, 'GENERAL', 'Procedure', 'General Procedure'), ['Document Control Procedure']);
let numbered = renumber(tree, rule, []);
check('execution plan', numbered[0].children[0].docs.map((d) => d.docNo), ['JPI-GN-DRE-001', 'JPI-GN-GRE-001']);
check('third level, typed from its own heading', numbered[0].children[1].children[0].docs[0].docNo, 'JPI-GN-DGS-001');
check('process datasheet', numbered[1].children[0].docs[0].docNo, 'JPI-PC-DDS-001');
check('sequence continues past taken', renumber(tree, rule, ['JPI-PC-DDS-004'])[1].children[0].docs[0].docNo, 'JPI-PC-DDS-005');
check('unchanged renumber keeps the tree', renumber(numbered, rule, []) === numbered, true);
const band = addHeadings([], null, ['DETAIL ENGINEERING']);
let eng = addHeadings(band, band[0].id, ['ELECTRICAL']);
eng = addHeadings(eng, id(eng, 'DETAIL ENGINEERING', 'ELECTRICAL'), ['Electrical Drawing']);
eng = addDocs(eng, id(eng, 'DETAIL ENGINEERING', 'ELECTRICAL', 'Electrical Drawing'), ['Single Line Diagram']);
check('discipline is the heading that names one, not the band', renumber(eng, rule, [])[0].children[0].children[0].docs[0].docNo, 'JPI-EL-GDW-001');
const blank = updateDoc(tree, id(tree, 'PROCESS', 'Datasheet'), tree[1].children[0].docs[0].id, { title: ' ' });
check('a row with no title gets no number', renumber(blank, rule, [])[1].children[0].docs[0].docNo, '');

console.log('\ndraft groups: one per new leaf, with its whole path');
numbered = renumber(tree, rule, []);
check('paths', toDraftGroups(numbered).map((g) => [g.path.join(' > '), g.documents.length]), [
  ['GENERAL > Execution Plan', 2],
  ['GENERAL > Procedure > General Procedure', 1],
  ['PROCESS > Datasheet', 1],
]);
check('kinds kept', toDraftGroups(numbered)[0].documents.map((d) => d.kind), ['Doc', 'Dwg']);
check('count', [countDocuments(numbered), countNewHeadings(numbered)], [4, 6]);
const removed = removeNode(tree, id(tree, 'GENERAL', 'Procedure'));
check('remove takes the branch', countNewHeadings(removed), 4);

console.log('\nadding to a register that already exists');
let more = fromExisting([
  { name: 'GENERAL', documents: 5, children: [{ name: 'Execution Plan', documents: 5, children: [] }] },
  { name: 'PIPING', documents: 0, children: [] },
]);
const filled = findNode(more, id(more, 'GENERAL', 'Execution Plan'))!;
check('a leaf the register filled takes no headings', canHold(filled.node, filled.depth), { headings: false, documents: true });
check('locked rows cannot be removed', removeNode(more, more[0].id) === more, true);
check('nothing new, nothing written', toDraftGroups(more), []);
more = addHeadings(more, id(more, 'GENERAL'), ['Procedure']);
more = addDocs(more, id(more, 'GENERAL', 'Execution Plan'), ['Quality Plan']);
more = addHeadings(more, id(more, 'PIPING'), ['Piping Drawing']);
check('only what is new is written, under the paths that exist', toDraftGroups(renumber(more, rule, [])).map((g) => [g.path.join(' > '), g.documents.map((d) => d.title)]), [
  ['GENERAL > Execution Plan', ['Quality Plan']],
  ['GENERAL > Procedure', []],
  ['PIPING > Piping Drawing', []],
]);

console.log('\ncopy from another project keeps every level');
const copied = fromOutline([{
  name: 'GENERAL',
  documents: [{ title: 'Loose One', kind: 'Doc' }],
  children: [{ name: 'Procedure', documents: [], children: [{ name: 'General Procedure', documents: [{ title: 'DCP', kind: 'Doc' }], children: [] }] }],
}]);
check('levels', copied[0].children.map((c) => c.name), ['GENERAL', 'Procedure']);
check('own documents moved into a heading named after it', copied[0].children[0].docs.map((d) => d.title), ['Loose One']);
check('third level', copied[0].children[1].children[0].docs.map((d) => d.title), ['DCP']);

console.log('\npaste keeps the depth it was written in');
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
check('three levels kept', pasted[0].children[0].children.map((c) => c.name), ['General Prosedur']);
check('pasted number kept, not auto', pasted[0].children[0].children[0].docs.map((d) => [d.docNo, d.auto]), [['WPP-GN-DGS-001', false]]);
check('electrical row on the heading', pasted[1].docs.map((d) => [d.title, d.kind]), [['Single Line Diagram', 'Dwg']]);

if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall passed');
