/**
 * What the new builder stores, and what it copies from.
 *
 * Runs on a throwaway copy of data/report.db, never on the file itself.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-edl-builder.ts
 */
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

import { copyDbFixture } from './db-fixture.ts';

const tmp = copyDbFixture('data/report.db', path.join(os.tmpdir(), `report-builder-${Date.now()}.db`));
process.env.REPORT_DB_PATH = tmp;

const { db, schema, sqlite } = await import('../lib/sqlite.ts');
const { writeDraft } = await import('../lib/register-seed.ts');
const { getRegisterOutline, getRegisterSources, getNumbering } = await import('../lib/register.ts');
const { and, eq, inArray } = await import('drizzle-orm');

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};

const PROJECT = 'builder-test';
db.insert(schema.projects).values({
  id: PROJECT, name: 'Builder test', alias: 'BTS', clientName: 'Client', contractorName: 'Contractor',
}).run();

const names = { clientName: 'Client', contractorName: 'Contractor' };

console.log('a heading with sub-headings, and one without');
writeDraft({
  projectId: PROJECT, register: 'edl', ...names,
  groups: [
    { path: ['GENERAL', 'Execution Plan'], documents: [
      { docNo: 'BTS-GN-DRE-001', title: 'Project Execution Plan', kind: 'Doc', planIfr: null },
      { docNo: 'BTS-GN-DRE-002', title: 'Project Quality Plan', kind: 'Doc', planIfr: null },
    ] },
    { path: ['INSTRUMENT'], documents: [
      { docNo: 'BTS-IN-GDW-001', title: 'Instrument Location Layout', kind: 'Dwg', planIfr: '2026-10-20' },
    ] },
  ],
});

const cats = () => db.select().from(schema.docCategories)
  .where(and(eq(schema.docCategories.projectId, PROJECT), eq(schema.docCategories.register, 'edl'))).all();
const docs = () => db.select().from(schema.documents)
  .where(and(eq(schema.documents.projectId, PROJECT), eq(schema.documents.register, 'edl'))).all();

check('categories', cats().length, 3);
const general = cats().find((c) => c.name === 'GENERAL')!;
check('GENERAL is a root', general.parentId, null);
check('GENERAL has one child', cats().filter((c) => c.parentId === general.id).map((c) => c.name), ['Execution Plan']);
check('documents', docs().length, 3);
const layout = docs().find((d) => d.title === 'Instrument Location Layout')!;
check('kind stored', layout.kind, 'Dwg');

const stagesOf = (ids: string[]) => db.select().from(schema.docStages).where(inArray(schema.docStages.documentId, ids)).all();
const layoutStages = stagesOf([layout.id]);
check('planned document has one stage row', layoutStages.map((s) => [s.stage, s.planSubmitDate, Boolean(s.submitted)]),
  [['IFR', '2026-10-20', false]]);
check('unplanned documents have none', stagesOf(docs().filter((d) => d.id !== layout.id).map((d) => d.id)).length, 0);

console.log('\nadding to an existing heading adds, it does not duplicate');
writeDraft({
  projectId: PROJECT, register: 'edl', ...names,
  groups: [{ path: ['INSTRUMENT'], documents: [{ docNo: 'BTS-IN-DDS-001', title: 'Control Valve Datasheet', kind: 'Doc', planIfr: null }] }],
});
check('categories still', cats().length, 3);
check('documents now', docs().length, 4);

console.log('\nthe outline a copy starts from');
const outline = getRegisterOutline('pdemo-merbau', 'edl');
check('Merbau headings', outline.length, 10);
check('Merbau documents', outline.reduce((n, h) => n + h.documents.length + h.subheadings.reduce((m, s) => m + s.documents.length, 0), 0), 51);
check('no sub-headings in a flat register', outline.every((h) => h.subheadings.length === 0), true);
check('every kind is Doc or Dwg', outline.every((h) => h.documents.every((d) => d.kind === 'Doc' || d.kind === 'Dwg')), true);
const mine = getRegisterOutline(PROJECT, 'edl');
check('own outline: GENERAL keeps its sub-heading', mine.find((h) => h.name === 'GENERAL')?.subheadings.map((s) => [s.name, s.documents.length]),
  [['Execution Plan', 2]]);

console.log('\nprojects that can be copied from');
const sources = getRegisterSources(PROJECT, 'edl');
const merbau = sources.find((s) => s.projectId === 'pdemo-merbau');
check('Merbau offered', merbau ? [merbau.documents, merbau.headings] : null, [51, 10]);
check('own project not offered', sources.some((s) => s.projectId === PROJECT), false);

console.log('\nthe numbering guess falls back to the project initial');
db.insert(schema.projects).values({ id: 'builder-empty', name: 'Empty', alias: 'JPI' }).run();
check('initial used', getNumbering('builder-empty', 'edl').suggestedPrefix, 'JPI');
check('existing numbers win', getNumbering(PROJECT, 'edl').suggestedPrefix, 'BTS');
const { deriveInitial } = await import('../lib/initial.ts');
db.insert(schema.projects).values({ id: 'builder-noalias', name: 'asdasd' }).run();
check('no initial stored: the sidebar\x27s guess', getNumbering('builder-noalias', 'edl').suggestedPrefix, deriveInitial('asdasd'));
check('and it is not empty', deriveInitial('asdasd').length > 0, true);

sqlite.close();
rmSync(tmp, { force: true });
if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall passed');
