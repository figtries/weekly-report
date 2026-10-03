/**
 * One letter, many documents: what recording a transmittal writes.
 *
 * Runs on a throwaway copy of data/report.db, never on the file itself.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-transmittal.ts
 */
import path from 'node:path';
import os from 'node:os';
import { rmSync } from 'node:fs';

import { copyDbFixture } from './db-fixture.ts';

const tmp = copyDbFixture('data/report.db', path.join(os.tmpdir(), `report-transmittal-${Date.now()}.db`));
process.env.REPORT_DB_PATH = tmp;

const { db, schema, sqlite } = await import('../lib/sqlite.ts');
const { writeTransmittal } = await import('../lib/transmittal-write.ts');
const { getRegisterCards } = await import('../lib/register.ts');
const { and, eq } = await import('drizzle-orm');

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};
const throws = (label: string, fn: () => unknown, match: RegExp) => {
  let message = '';
  try { fn(); } catch (err) { message = err instanceof Error ? err.message : String(err); }
  check(label, match.test(message), true);
  if (!match.test(message)) console.log(`        got: ${message || '(no error)'}`);
};

const P = 'pdemo-merbau';
// A project of our own, so every document starts with the ball on our side.
const T = 'transmittal-test';
db.insert(schema.projects).values({ id: T, name: 'Transmittal test', alias: 'TTS', clientName: 'C', contractorName: 'K' }).run();
const { writeDraft } = await import('../lib/register-seed.ts');
writeDraft({
  projectId: T, register: 'edl', clientName: 'C', contractorName: 'K',
  groups: [{ path: ['INSTRUMENT'], documents: [
    { docNo: 'TTS-IN-DDS-001', title: 'Datasheet', kind: 'Doc', planIfr: '2026-10-20' },
    { docNo: 'TTS-IN-GDW-001', title: 'Layout', kind: 'Dwg', planIfr: null },
    { docNo: 'TTS-IN-DLS-001', title: 'List', kind: 'Doc', planIfr: null },
  ] }],
});

const cardsOf = (projectId: string) => Object.values(getRegisterCards(projectId, 'edl')).flat();
const stageRow = (documentId: string, stage: string) => db.select().from(schema.docStages)
  .where(and(eq(schema.docStages.documentId, documentId), eq(schema.docStages.stage, stage as never))).all()[0];

console.log('a new register: every document is ours to send, at IFR');
let cards = cardsOf(T);
check('send next', cards.map((c) => c.sendNext), ['IFR', 'IFR', 'IFR']);
check('nothing out', cards.map((c) => c.out), [null, null, null]);

console.log('\nsending three in one letter');
const sent = writeTransmittal({
  projectId: T, register: 'edl', direction: 'out', date: '2026-10-05', letter: 'TTS-TRM-O-0001',
  items: cards.map((c) => ({ documentId: c.id, stage: 'IFR' })),
});
check('documents written', sent, 3);
const rows = cards.map((c) => stageRow(c.id, 'IFR'));
check('all sent on the date', rows.map((r) => [Boolean(r.submitted), r.submittedAt]), [[true, '2026-10-05'], [true, '2026-10-05'], [true, '2026-10-05']]);
check('one transmittal, shared', new Set(rows.map((r) => r.submitTransmittalId)).size, 1);
const letter = db.select().from(schema.transmittals).where(eq(schema.transmittals.id, rows[0].submitTransmittalId!)).all()[0];
check('its number and direction', [letter.no, letter.direction], ['TTS-TRM-O-0001', 'out']);
check('plan date untouched', rows[0].planSubmitDate, '2026-10-20');

cards = cardsOf(T);
check('now out, with the client', cards.map((c) => c.out?.stage ?? null), ['IFR', 'IFR', 'IFR']);
check('nothing to send while out', cards.map((c) => c.sendNext), [null, null, null]);

console.log('\nthey come back in one letter, each with its code');
const back = writeTransmittal({
  projectId: T, register: 'edl', direction: 'in', date: '2026-10-12', letter: 'TTS-TRM-I-0001',
  items: cards.map((c, i) => ({ documentId: c.id, stage: 'IFR', code: ['APP', 'awc', 'RWC'][i] })),
});
check('documents written', back, 3);
const after = cards.map((c) => stageRow(c.id, 'IFR'));
check('returned with codes', after.map((r) => [r.returnedAt, r.returnCode]), [['2026-10-12', 'APP'], ['2026-10-12', 'AWC'], ['2026-10-12', 'RWC']]);
check('one inbound transmittal', new Set(after.map((r) => r.returnTransmittalId)).size, 1);
check('sent date kept', after[0].submittedAt, '2026-10-05');
cards = cardsOf(T);
check('APP and AWC move on to IFA, RWC goes back out as RE-IFR', cards.map((c) => c.sendNext), ['IFA', 'IFA', 'RE_IFR']);
writeTransmittal({ projectId: T, register: 'edl', direction: 'out', date: '2026-10-14', letter: 'TTS-TRM-O-0002', items: [{ documentId: cards[2].id, stage: 'RE_IFR' }] });
writeTransmittal({ projectId: T, register: 'edl', direction: 'in', date: '2026-10-18', letter: 'TTS-TRM-I-0002', items: [{ documentId: cards[2].id, stage: 'RE_IFR', code: 'AWC' }] });
check('AWC at RE-IFR moves on to IFA', cardsOf(T).find((c) => c.id === cards[2].id)?.sendNext, 'IFA');

console.log('\nwhat it refuses');
throws('a letter is required', () => writeTransmittal({
  projectId: T, register: 'edl', direction: 'out', date: '2026-10-13', letter: '  ',
  items: [{ documentId: cards[0].id, stage: 'IFA' }],
}), /letter/i);
throws('back for a stage never sent', () => writeTransmittal({
  projectId: T, register: 'edl', direction: 'in', date: '2026-10-13', letter: 'TTS-TRM-I-0002',
  items: [{ documentId: cards[0].id, stage: 'IFA', code: 'APP' }],
}), /never sent/i);
throws('another project\'s document', () => writeTransmittal({
  projectId: T, register: 'edl', direction: 'out', date: '2026-10-13', letter: 'X',
  items: [{ documentId: cardsOf(P)[0].id, stage: 'IFR' }],
}), /not in this register/i);
throws('a code that is not a code', () => writeTransmittal({
  projectId: T, register: 'edl', direction: 'in', date: '2026-10-13', letter: 'TTS-TRM-I-0003',
  items: [{ documentId: cards[0].id, stage: 'IFR', code: 'MAYBE' }],
}), /code/i);
check('a refused letter wrote nothing', db.select().from(schema.transmittals).where(eq(schema.transmittals.projectId, T)).all().length, 4);

console.log('\nMerbau: the rule agrees with Outstanding');
const merbau = cardsOf(P);
check('a document is never both out and to send', merbau.every((c) => !(c.out && c.sendNext)), true);
check('some are out', merbau.some((c) => c.out !== null), true);

sqlite.close();
rmSync(tmp, { force: true });
if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall passed');
