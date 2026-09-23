/**
 * The week-by-week log in the activity panel, and the reminders beside it.
 *
 * Runs against a COPY of the working database. What it guards:
 *   - which weeks the log shows (starting early, running past the plan)
 *   - the actual line never goes down: a correction moves the recorded weeks
 *     around it, and only those — a carried week is never written
 *   - "Repeat weekly": per week, in total, and never past 100%
 *   - Undo puts back EXACTLY what was there, including "nothing"
 *   - a signed week is not written without a yes
 *   - the log's figure for a week is the rollup's figure for that week
 *   - late / ending-soon come from the worklist and match the schedule
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-week-log.ts
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const work = path.join(os.tmpdir(), `week-log-${Date.now()}.db`);
copyDbFixture(path.join(process.cwd(), 'data', 'report.db'), work);
process.env.REPORT_DB_PATH = work;

const { cascade, repeatFill, logRange, figureOf, buildLeafWeekLog } = await import('../lib/week-log.ts');
const { db, schema } = await import('../lib/sqlite.ts');
const { and, eq } = await import('drizzle-orm');
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const { saveLeafWeeksSqlite, restoreLeafWeeksSqlite, SignedWeeksError } = await import(
  '../lib/progress-sqlite.ts'
);
const { computeRollup, findNode } = await import('../lib/rollup.ts');
const { buildWorklist, DUE_SOON_WEEKS } = await import('../lib/worklist.ts');

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}
const typed = (pct: number) => ({ cumProgressPct: pct, source: 'manual' as const });
const lump = { progressMethod: 'lumpsum' as const, vol: null };

console.log('range');
check('starts early when work began before the plan', () => {
  const r = logRange({ weeks: range(1, 60), startWeek: 43, finishWeek: 48, recordedWeeks: [42], currentWeek: 45, complete: false });
  assert.deepEqual(r, { from: 42, to: 48 });
});
check('runs on to this week while it is still short', () => {
  const r = logRange({ weeks: range(1, 60), startWeek: 43, finishWeek: 48, recordedWeeks: [44, 50], currentWeek: 55, complete: false });
  assert.deepEqual(r, { from: 43, to: 55 });
});
check('stops at the plan once it is finished', () => {
  const r = logRange({ weeks: range(1, 60), startWeek: 43, finishWeek: 48, recordedWeeks: [43, 47], currentWeek: 55, complete: true });
  assert.deepEqual(r, { from: 43, to: 48 });
});
check('nothing to anchor it: no log', () => {
  assert.equal(logRange({ weeks: range(1, 60), startWeek: null, finishWeek: null, recordedWeeks: [], currentWeek: 9, complete: false }), null);
});
check('unscheduled but recorded: first record to this week', () => {
  const r = logRange({ weeks: range(1, 60), startWeek: null, finishWeek: null, recordedWeeks: [5], currentWeek: 9, complete: false });
  assert.deepEqual(r, { from: 5, to: 9 });
});
check('clamped to the project', () => {
  const r = logRange({ weeks: range(1, 20), startWeek: 15, finishWeek: 30, recordedWeeks: [], currentWeek: 18, complete: false });
  assert.deepEqual(r, { from: 15, to: 20 });
});

console.log('cascade');
check('a correction up carries the recorded weeks after it', () => {
  const rec = new Map([[44, typed(30)], [45, typed(50)], [47, typed(55)]]);
  const { writes, moved } = cascade(lump, rec, new Map([[44, typed(60)]]));
  assert.deepEqual(moved, [{ week: 45, pct: 60 }, { week: 47, pct: 60 }]);
  assert.deepEqual([...writes.keys()].sort(), [44, 45, 47]);
});
check('a correction down carries the recorded weeks before it', () => {
  const rec = new Map([[44, typed(30)], [45, typed(50)]]);
  const { moved } = cascade(lump, rec, new Map([[45, typed(20)]]));
  assert.deepEqual(moved, [{ week: 44, pct: 20 }]);
});
check('a correction that fits moves nothing', () => {
  const rec = new Map([[44, typed(30)], [45, typed(50)]]);
  const { writes, moved } = cascade(lump, rec, new Map([[44, typed(40)]]));
  assert.deepEqual(moved, []);
  assert.deepEqual([...writes.keys()], [44]);
});
check('quantity moves as a quantity', () => {
  const qty = { progressMethod: 'qty' as const, vol: 100 };
  const rec = new Map([[10, { cumProgressPct: 20, qtyDone: 20, source: 'qty' as const }], [12, { cumProgressPct: 30, qtyDone: 30, source: 'qty' as const }]]);
  const { writes, moved } = cascade(qty, rec, new Map([[10, { cumProgressPct: 50, qtyDone: 50, source: 'qty' as const }]]));
  assert.equal(writes.get(12)?.qtyDone, 50);
  assert.deepEqual(moved, [{ week: 12, pct: 50 }]);
});
check('stages are united, never dropped', () => {
  const ms = { progressMethod: 'milestone' as const, vol: null, milestones: [
    { id: 'a', label: 'A', weight: 50 }, { id: 'b', label: 'B', weight: 30 }, { id: 'c', label: 'C', weight: 20 },
  ] };
  const rec = new Map([[12, { cumProgressPct: 30, milestonesDone: ['b'] }]]);
  const { writes, moved } = cascade(ms, rec, new Map([[10, { cumProgressPct: 70, milestonesDone: ['a', 'c'] }]]));
  assert.deepEqual([...(writes.get(12)?.milestonesDone ?? [])].sort(), ['a', 'b', 'c']);
  assert.deepEqual(moved, [{ week: 12, pct: 100 }]);
});

console.log('repeat weekly');
check('8% each week for 10 weeks', () => {
  const r = repeatFill(lump, typed(10), { from: 45, count: 10, amount: 8, mode: 'each', lastWeek: 60 });
  assert.ok(r.ok);
  assert.equal(r.edits.size, 10);
  assert.equal(r.last, 54);
  assert.equal(r.endPct, 90);
  assert.equal(r.reached, null);
});
check('20% in total over 4 weeks', () => {
  const r = repeatFill(lump, null, { from: 5, count: 4, amount: 20, mode: 'total', lastWeek: 60 });
  assert.ok(r.ok);
  assert.deepEqual([...r.edits.values()].map((e) => e.cumProgressPct), [5, 10, 15, 20]);
});
check('stops on the week it reaches 100%', () => {
  const r = repeatFill(lump, typed(50), { from: 5, count: 5, amount: 20, mode: 'each', lastWeek: 60 });
  assert.ok(r.ok);
  assert.equal(r.edits.size, 3);
  assert.equal(r.reached, 7);
  assert.equal(r.endPct, 100);
});
check('quantity fills in its own unit', () => {
  const qty = { progressMethod: 'qty' as const, vol: 200 };
  const r = repeatFill(qty, { cumProgressPct: 75, qtyDone: 150, source: 'qty' }, { from: 5, count: 3, amount: 30, mode: 'each', lastWeek: 60 });
  assert.ok(r.ok);
  assert.deepEqual([...r.edits.values()].map((e) => e.qtyDone), [180, 200]);
  assert.equal(r.reached, 6);
});
check('never past the last week', () => {
  const r = repeatFill(lump, null, { from: 58, count: 5, amount: 5, mode: 'each', lastWeek: 60 });
  assert.ok(r.ok);
  assert.equal(r.edits.size, 3);
});
check('stages fill as a typed percent, keeping the stages already ticked', () => {
  const ms = { progressMethod: 'milestone' as const, vol: null, milestones: [
    { id: 'a', label: 'A', weight: 50 }, { id: 'b', label: 'B', weight: 50 },
  ] };
  const r = repeatFill(ms, { cumProgressPct: 50, milestonesDone: ['a'], source: 'steps' }, { from: 3, count: 2, amount: 10, mode: 'each', lastWeek: 9 });
  assert.ok(r.ok);
  assert.deepEqual([...r.edits.values()].map((e) => [e.cumProgressPct, e.source, e.milestonesDone?.join()]), [[60, 'manual', 'a'], [70, 'manual', 'a']]);
});
check('until 100%: the last week takes only what is left', () => {
  const r = repeatFill(lump, null, { from: 24, count: 72 - 24 + 1, amount: 8, mode: 'each', lastWeek: 72 });
  assert.ok(r.ok);
  assert.equal(r.last, 36);
  assert.equal(r.reached, 36);
  assert.equal(r.edits.get(35)?.cumProgressPct, 96);
  assert.equal(r.edits.get(36)?.cumProgressPct, 100);
});
check('nothing to fill on an activity already at 100%', () => {
  const r = repeatFill(lump, typed(100), { from: 5, count: 3, amount: 5, mode: 'each', lastWeek: 9 });
  assert.equal(r.ok, false);
});

console.log('sqlite');
const projectId = 'pmtygg3od7c19';
const load = () => buildProjectDashboardData(projectId)!.db;
const first = load();
const sched = first.schedule!.find((s) => s.finishWeek - s.startWeek >= 6)!;
assert.ok(sched, 'a scheduled leaf of at least seven weeks');
const leaf = sched.leafId;
const S = sched.startWeek;
const logOf = (signed = new Set<number>()) =>
  buildLeafWeekLog(load(), leaf, { signedWeeks: signed, editable: true })!;
const rowAt = (w: number) => logOf().rows.find((r) => r.week === w)!;
const rawRows = () =>
  db.select().from(schema.leafProgress).where(eq(schema.leafProgress.nodeId, leaf)).all()
    .sort((a, b) => a.weekId.localeCompare(b.weekId));

check('an empty log still spans the plan', () => {
  const log = logOf();
  assert.equal(log.range!.from, S);
  assert.ok(log.range!.to >= sched.finishWeek);
  assert.ok(log.rows.every((r) => !r.recorded && r.pct === 0));
});
check("this week is today's date, not the reporting pin", () => {
  const d = load();
  const w10 = d.weeks.find((w) => w.week === 10)!;
  const log = buildLeafWeekLog(d, leaf, { signedWeeks: new Set(), editable: true, today: new Date(w10.periodStart + 'T12:00:00Z') });
  assert.equal(log!.todayWeek, 10);
  const before = buildLeafWeekLog(d, leaf, { signedWeeks: new Set(), editable: true, today: new Date('2000-01-01T00:00:00Z') });
  assert.equal(before!.todayWeek, 0, 'nothing has started before the plan');
});

check('one week written, the next one carries it', () => {
  saveLeafWeeksSqlite(projectId, leaf, [{ week: S, evidence: typed(30) }]);
  assert.equal(rowAt(S).pct, 30);
  assert.equal(rowAt(S).recorded, true);
  assert.equal(rowAt(S + 1).pct, 30);
  assert.equal(rowAt(S + 1).recorded, false);
});

let undo: ReturnType<typeof saveLeafWeeksSqlite> = [];
let beforeRows: ReturnType<typeof rawRows> = [];
check('a correction moves the recorded week after it, not the carried one', () => {
  saveLeafWeeksSqlite(projectId, leaf, [{ week: S + 2, evidence: typed(50) }]);
  beforeRows = rawRows();
  undo = saveLeafWeeksSqlite(projectId, leaf, [{ week: S, evidence: typed(70) }]);
  assert.equal(rowAt(S).pct, 70);
  assert.equal(rowAt(S + 1).recorded, false, 'the carried week gets no row');
  assert.equal(rowAt(S + 2).pct, 70);
  assert.deepEqual(undo.map((u) => u.leaf?.cumProgressPct).sort(), [30, 50]);
});

check('undo puts back exactly what was there', () => {
  restoreLeafWeeksSqlite(projectId, leaf, undo);
  assert.deepEqual(rawRows(), beforeRows);
});

check('undo of a first-ever week removes the row again', () => {
  const u = saveLeafWeeksSqlite(projectId, leaf, [{ week: S + 4, evidence: typed(60) }]);
  assert.equal(u.length, 1);
  assert.equal(u[0].leaf, null);
  restoreLeafWeeksSqlite(projectId, leaf, u);
  assert.equal(rowAt(S + 4).recorded, false);
  assert.deepEqual(rawRows(), beforeRows);
});

check('undo refuses rows that are not this leaf', () => {
  const forged = [{ ...undo[0], leaf: { ...undo[0].leaf!, nodeId: 'someone-else' } }];
  assert.throws(() => restoreLeafWeeksSqlite(projectId, leaf, forged));
});

check('a signed week is not written without a yes', () => {
  db.insert(schema.users).values({ id: 'u-verify', email: 'verify@example.test', name: 'Verify' }).run();
  const weekId = db.select().from(schema.weeks)
    .where(and(eq(schema.weeks.projectId, projectId), eq(schema.weeks.weekNo, S + 2))).all()[0].id;
  db.insert(schema.approvals).values({
    id: 'a-verify', weekId, approvedBy: 'u-verify', approvedAt: new Date().toISOString(),
    snapshotActualPct: 0, snapshotPlanPct: 0, signerName: 'Verify',
  }).run();
  assert.throws(
    () => saveLeafWeeksSqlite(projectId, leaf, [{ week: S, evidence: typed(90) }]),
    (err: unknown) => err instanceof SignedWeeksError && err.weeks.join() === String(S + 2)
  );
  assert.equal(rowAt(S).pct, 30, 'nothing written on refusal');
  saveLeafWeeksSqlite(projectId, leaf, [{ week: S, evidence: typed(90) }], { allowSigned: true });
  assert.equal(rowAt(S + 2).pct, 90);
});

check('repeat weekly writes through the same door', () => {
  const log = logOf();
  const base = log.rows.find((r) => r.week === S + 2)!.evidence;
  const r = repeatFill(lump, base, { from: S + 3, count: 3, amount: 2, mode: 'each', lastWeek: 72 });
  assert.ok(r.ok);
  saveLeafWeeksSqlite(projectId, leaf, [...r.edits].map(([week, evidence]) => ({ week, evidence })));
  assert.deepEqual([S + 3, S + 4, S + 5].map((w) => rowAt(w).pct), [92, 94, 96]);
});

check("the log's figure is the rollup's figure", () => {
  const d = load();
  for (const w of [S, S + 1, S + 4]) {
    const meta = d.weeks.find((x) => x.week === w)!;
    const node = findNode(computeRollup(d.wbsItems, meta.leafData, null), leaf)!;
    assert.equal(rowAt(w).pct, Math.round(node.curProgressPct * 100) / 100);
  }
});

console.log('reminders');
check('late and ending soon match the schedule, week by week', () => {
  const d = load();
  for (const week of [S, S + 3, sched.finishWeek, sched.finishWeek + 2]) {
    const meta = d.weeks.find((x) => x.week === week);
    if (!meta) continue;
    const roots = computeRollup(d.wbsItems, meta.leafData, null);
    const wl = buildWorklist({ roots, schedule: d.schedule, week, changeLog: d.changeLog, weightsLocked: false });
    const pctOf = (id: string) => findNode(roots, id)!.curProgressPct;
    const expectSoon = d.schedule!
      .filter((s) => s.finishWeek - week >= 0 && s.finishWeek - week < DUE_SOON_WEEKS && pctOf(s.leafId) < 99.995)
      .map((s) => s.leafId).sort();
    const expectLate = d.schedule!
      .filter((s) => s.finishWeek < week && pctOf(s.leafId) < 99.995)
      .map((s) => s.leafId).sort();
    assert.deepEqual(wl.soon.map((e) => e.node.id).sort(), expectSoon, `soon at W${week}`);
    assert.deepEqual(wl.stuck.map((e) => e.node.id).sort(), expectLate, `late at W${week}`);
  }
});

console.log(`\n${passed} checks passed`);

function range(a: number, b: number) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
void figureOf;
