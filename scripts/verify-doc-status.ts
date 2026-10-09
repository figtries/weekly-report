/**
 * Setting a document's status directly (9 Oct 2026): what Save writes, what the
 * register then reads back, and what it must never touch.
 *
 * Walks one untouched document through IFR -> IFA -> RWC -> resubmission ->
 * back to the start, and sends a finished one out again, on a throwaway copy
 * of data/report.db.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-doc-status.ts
 */
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';

import { copyDbFixture } from './db-fixture.ts';

const tmp = copyDbFixture('data/report.db', path.join(os.tmpdir(), `report-status-${Date.now()}.db`));
process.env.REPORT_DB_PATH = tmp;

const { db, schema, sqlite } = await import('../lib/sqlite.ts');
const { writeDocumentStatus } = await import('../lib/transmittal-write.ts');
const { getRegisterCards, getRegisterSummary, withUs } = await import('../lib/register.ts');
const { eq } = await import('drizzle-orm');

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};
const throws = (label: string, fn: () => unknown) => {
  let refused = false;
  try { fn(); } catch { refused = true; }
  check(label, refused ? 'refused' : 'accepted', 'refused');
};

type Row = typeof schema.docStages.$inferSelect;
const facts = (r: Row) => ({ stage: r.stage, submitted: Boolean(r.submitted), sent: r.submittedAt, back: r.returnedAt, code: r.returnCode });
const has = (r: Row) => Boolean(r.submitted || r.submittedAt || r.returnedAt || r.returnCode);
const rowsOf = (docId: string) => db.select().from(schema.docStages).where(eq(schema.docStages.documentId, docId)).all();
const stagesOf = (docId: string) => rowsOf(docId).filter(has).sort((a, b) => a.order - b.order).map(facts);
const allStages = () => JSON.stringify(db.select().from(schema.docStages).all().sort((a, b) => a.id.localeCompare(b.id)));
const othersThan = (ids: string[]) => JSON.stringify(db.select().from(schema.docStages).all()
  .filter((r) => !ids.includes(r.documentId)).sort((a, b) => a.id.localeCompare(b.id)));

// A finished EDL document, and a new one beside it in the same discipline.
const docs = db.select().from(schema.documents).where(eq(schema.documents.register, 'edl')).all();
const finished = docs.find((d) => stagesOf(d.id).some((s) => s.stage === 'AFC' && s.code === 'APP'));
if (!finished) {
  console.log('No finished EDL document anywhere; nothing to prove.');
  process.exit(1);
}
db.insert(schema.documents).values({
  id: 'verify-status-doc', projectId: finished.projectId, register: 'edl', categoryId: finished.categoryId,
  docNo: 'VS-TEST-001', title: 'Status test drawing', kind: 'Dwg',
}).run();
const fresh = db.select().from(schema.documents).where(eq(schema.documents.id, 'verify-status-doc')).all()[0];
// A plan date already on IFR: setting and clearing its status must leave it alone.
db.insert(schema.docStages).values({ id: 'verify-status-plan', documentId: fresh.id, stage: 'IFR', order: 0, submitted: false, planSubmitDate: '2026-02-28' }).run();
const projectId = finished.projectId;
const base = { projectId, register: 'edl' as const, letter: '', confirmed: false };
const card = (id: string) => Object.values(getRegisterCards(projectId, 'edl')).flat().find((c) => c.id === id)!;
const others = othersThan([fresh.id, finished.id]);
const planOf = (id: string) => rowsOf(id).map((x) => [x.stage, x.planSubmitDate] as const).filter(([, p]) => p).sort();
const planBefore = planOf(fresh.id);

console.log(`untouched: ${fresh.docNo ?? fresh.id} · finished: ${finished.docNo ?? finished.id} · project ${projectId}`);

console.log('\n1. IFR sent to the client');
let r = writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFR', where: 'them', code: null, date: '2026-03-02', letter: 'VS-OUT-1' });
check('written without asking', r, { written: 1 });
check('rows', stagesOf(fresh.id), [{ stage: 'IFR', submitted: true, sent: '2026-03-02', back: null, code: null }]);
check('card: out with the client at IFR', card(fresh.id).out?.stage, 'IFR');
const letterOut = db.select().from(schema.transmittals).all().find((t) => t.no === 'VS-OUT-1');
check('letter created as out', letterOut?.direction, 'out');
check('stage row points at the letter', rowsOf(fresh.id).find((x) => x.stage === 'IFR')?.submitTransmittalId, letterOut?.id);

console.log('\n2. IFR came back APP');
r = writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFR', where: 'us', code: 'APP', date: '2026-03-12', letter: 'VS-IN-1' });
check('written without asking (nothing replaced)', r, { written: 1 });
check('rows keep the send date', stagesOf(fresh.id), [{ stage: 'IFR', submitted: true, sent: '2026-03-02', back: '2026-03-12', code: 'APP' }]);
check('the out letter is kept', rowsOf(fresh.id).find((x) => x.stage === 'IFR')?.submitTransmittalId, letterOut?.id);
check('card: with us', [card(fresh.id).out, withUs(card(fresh.id))], [null, true]);
check('card: next is IFA', card(fresh.id).sendNext, 'IFA');

console.log('\n3. IFA sent, then back RWC');
writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFA', where: 'them', code: null, date: '2026-03-20', letter: '' });
check('card: out at IFA', card(fresh.id).out?.stage, 'IFA');
writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFA', where: 'us', code: 'RWC', date: '2026-03-30', letter: '' });
check('card: back RWC', [card(fresh.id).out, card(fresh.id).returnCode], [null, 'RWC']);

console.log('\n4. Sent again after RWC: the resubmission, not the same round');
r = writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFA', where: 'them', code: null, date: '2026-04-05', letter: '' });
check('written without asking', r, { written: 1 });
check('RE_IFA added, IFA kept', stagesOf(fresh.id).map((s) => [s.stage, s.sent, s.code]), [['IFR', '2026-03-02', 'APP'], ['IFA', '2026-03-20', 'RWC'], ['RE_IFA', '2026-04-05', null]]);
check('card: out at RE_IFA', card(fresh.id).out?.stage, 'RE_IFA');

console.log('\n5. Back to "IFR being prepared": asks first, writes nothing until yes');
const before = allStages();
r = writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFR', where: 'us', code: null, date: '2026-04-10', letter: '' });
check('asks, naming every recorded fact', 'confirm' in r ? r.confirm.length : 0, 5);
check('nothing written before yes', allStages() === before, true);
writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFR', where: 'us', code: null, date: '2026-04-10', letter: '', confirmed: true });
check('cleared after yes', stagesOf(fresh.id), []);
check('plan dates survive', planOf(fresh.id), planBefore);
check('card: nothing sent', [card(fresh.id).out, card(fresh.id).stage], [null, null]);

console.log('\n6. A finished document sent out again at AFC');
const earlier = stagesOf(finished.id).filter((s) => s.stage.includes('IFR') || s.stage.includes('IFA'));
r = writeDocumentStatus({ ...base, documentId: finished.id, stage: 'AFC', where: 'them', code: null, date: '2026-10-09', letter: '' });
check('asks (its AFC reply is replaced)', 'confirm' in r && r.confirm.some((l) => l.startsWith('AFC back')), true);
writeDocumentStatus({ ...base, documentId: finished.id, stage: 'AFC', where: 'them', code: null, date: '2026-10-09', letter: '', confirmed: true });
check('IFR and IFA untouched', stagesOf(finished.id).filter((s) => s.stage.includes('IFR') || s.stage.includes('IFA')), earlier);
check('card: out at AFC', card(finished.id).out?.stage, 'AFC');

console.log('\n7. Refusals');
throws('a bad date', () => writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFR', where: 'them', code: null, date: '9 Oct', letter: '' }));
throws('an unknown code', () => writeDocumentStatus({ ...base, documentId: fresh.id, stage: 'IFR', where: 'us', code: 'XYZ', date: '2026-10-09', letter: '' }));
throws('another project', () => writeDocumentStatus({ ...base, projectId: 'nope', documentId: fresh.id, stage: 'IFR', where: 'them', code: null, date: '2026-10-09', letter: '' }));

console.log('\n8. Nothing else moved, and Summary still agrees with Data');
check('every other document\'s stages identical', othersThan([fresh.id, finished.id]) === others, true);
const summary = getRegisterSummary(projectId, 'edl');
const all = Object.values(getRegisterCards(projectId, 'edl')).flat();
check('With us', summary?.withUs, all.filter(withUs).length);
check('With client', summary?.awaiting, all.filter((c) => c.out !== null).length);

sqlite.close();
for (const ext of ['', '-wal', '-shm']) rmSync(tmp + ext, { force: true });
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join('; ')}` : '\nall passed');
process.exit(failures.length ? 1 : 0);
