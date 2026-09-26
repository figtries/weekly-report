/**
 * Checks the weekly queue against a real plan, every week of it.
 *
 * The queue's whole value is that it is SHORT — a week's real work rather than
 * the whole WBS. That property is not visible in the UI until it has already
 * gone wrong, so it is asserted here: if a change to the rule, the schedule or
 * the rollup starts handing someone the whole plan, this fails rather than
 * shipping a list nobody reads.
 *
 * It was written against Gundih's weeks in db.json, with that project's own
 * counts pinned (W43: 3 due, 44 stuck). Gundih was removed on 26 Sep 2026; the
 * rules are what is asserted now, on every week of the largest plan in the
 * database, read the way the app reads it.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-worklist.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const work = path.join(os.tmpdir(), `verify-worklist-${process.pid}.db`);
copyDbFixture('data/report.db', work);
process.env.REPORT_DB_PATH = work;

const { sqlite } = await import('../lib/sqlite.ts');
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const { computeRollup, promoteNestedSpkContracts } = await import('../lib/rollup.ts');
const { buildWorklist } = await import('../lib/worklist.ts');

const project = (
  sqlite
    .prepare('select project_id id, count(*) c from wbs_nodes group by project_id order by c desc limit 1')
    .get() as { id: string } | undefined
)?.id;
const db = project ? buildProjectDashboardData(project)?.db : null;
if (!db || db.weeks.length === 0) throw new Error('This database has no plan with weeks to queue');

function worklistFor(week: number) {
  const meta = db!.weeks.find((w) => w.week === week);
  const prev = db!.weeks.find((w) => w.week === week - 1);
  if (!meta) throw new Error(`Week ${week} missing`);
  const roots = promoteNestedSpkContracts(computeRollup(db!.wbsItems, meta.leafData, prev?.leafData ?? null));
  return buildWorklist({ roots, schedule: db!.schedule, week, changeLog: db!.changeLog, weightsLocked: db!.project.weightsLocked });
}

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
};

console.log(`the plan: ${db.project.name.slice(0, 60)} · ${db.weeks.length} weeks`);

console.log('\nthe queue stays short across the whole project');
const lists = db.weeks.map((w) => ({ week: w.week, wl: worklistFor(w.week) }));
const sizes = lists.map(({ wl }) => wl.due.length + wl.done.length);
const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
const max = Math.max(...sizes);
console.log(`  avg ${avg.toFixed(1)} · max ${max}`);
if (max > 30) failures.push(`a week hands over ${max} items — the queue is no longer a queue`);
if (avg > 15) failures.push(`average week is ${avg.toFixed(1)} items`);
check('some week has something due', max > 0, true);

console.log('\nstuck items are warned about, never queued');
const overlaps = lists.reduce((n, { wl }) => {
  const queued = new Set([...wl.due, ...wl.done].map((e) => e.node.id));
  return n + wl.stuck.filter((s) => queued.has(s.node.id)).length;
}, 0);
check('stuck∩queued, every week', overlaps, 0);

console.log('\nevery queued item carries a sane span');
const badSpan = lists.reduce(
  (n, { wl }) => n + [...wl.due, ...wl.done].filter((e) => e.weekOfSpan < 1 || e.weekOfSpan > e.spanWeeks).length,
  0
);
check('entries with a nonsense span, every week', badSpan, 0);

console.log('\na project with no schedule says so instead of showing an empty week');
const noSched = (() => {
  const meta = db.weeks[Math.floor(db.weeks.length / 2)];
  const roots = promoteNestedSpkContracts(computeRollup(db.wbsItems, meta.leafData, null));
  return buildWorklist({ roots, schedule: undefined, week: meta.week, changeLog: [] });
})();
check('hasSchedule', noSched.hasSchedule, false);
check('due when unscheduled', noSched.due.length, 0);

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
process.exit(0);
