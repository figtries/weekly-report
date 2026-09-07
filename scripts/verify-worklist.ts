/**
 * Checks the weekly queue against the Gundih data.
 *
 * The queue's whole value is that it is SHORT — a week's real work rather than
 * the whole WBS. That property is not visible in the UI until it has already
 * gone wrong, so it is asserted here: if a change to the rule, the schedule
 * backfill or the rollup makes W43 hand someone 28 items instead of 3, this
 * fails rather than shipping a list nobody reads.
 *
 * Run: node scripts/verify-worklist.ts
 */
import { readFileSync } from 'node:fs';
import { computeRollup, promoteNestedSpkContracts } from '../lib/rollup.ts';
import { buildWorklist } from '../lib/worklist.ts';
import type { Database } from '../lib/types.ts';

const workspace = JSON.parse(readFileSync('data/db.json', 'utf8'));
const db: Database = workspace.projects[workspace.activeProjectId];

function worklistFor(week: number) {
  const meta = db.weeks.find((w) => w.week === week);
  const prev = db.weeks.find((w) => w.week === week - 1);
  if (!meta) throw new Error(`Week ${week} missing`);
  const roots = promoteNestedSpkContracts(
    computeRollup(db.wbsItems, meta.leafData, prev?.leafData ?? null)
  );
  return buildWorklist({ roots, schedule: db.schedule, week, changeLog: db.changeLog });
}

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
  if (!ok) failures.push(label);
};

// Read off the imported contract dates (active baseline) — see
// scripts/backfill-schedule.ts. These are counts of weighted leaves whose
// scheduled span covers the week.
console.log('queue size per week');
check('W1 due+done', worklistFor(1).due.length + worklistFor(1).done.length, 6);
check('W20 due+done', worklistFor(20).due.length + worklistFor(20).done.length, 12);
check('W43 due+done', worklistFor(43).due.length + worklistFor(43).done.length, 3);
check('W60 due+done', worklistFor(60).due.length + worklistFor(60).done.length, 3);

console.log('\nthe queue stays short across the whole project');
const sizes = db.weeks.map((w) => {
  const wl = worklistFor(w.week);
  return wl.due.length + wl.done.length;
});
const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
const max = Math.max(...sizes);
console.log(`  avg ${avg.toFixed(1)} · max ${max}`);
if (max > 30) failures.push(`a week hands over ${max} items — the queue is no longer a queue`);
if (avg > 15) failures.push(`average week is ${avg.toFixed(1)} items`);

console.log('\nstuck items are warned about, never queued');
const w43 = worklistFor(43);
check('W43 stuck', w43.stuck.length, 44);
const queued = new Set([...w43.due, ...w43.done].map((e) => e.node.id));
const overlap = w43.stuck.filter((s) => queued.has(s.node.id));
check('stuck∩queued', overlap.length, 0);

console.log('\nevery queued item carries what a card needs');
const missingTrail = [...w43.due, ...w43.done].filter((e) => e.trail.length === 0);
check('entries without a contract trail', missingTrail.length, 0);
const badSpan = [...w43.due, ...w43.done].filter(
  (e) => e.weekOfSpan < 1 || e.weekOfSpan > e.spanWeeks
);
check('entries with a nonsense span', badSpan.length, 0);

console.log('\na project with no schedule says so instead of showing an empty week');
const noSched = (() => {
  const meta = db.weeks.find((w) => w.week === 43)!;
  const roots = promoteNestedSpkContracts(computeRollup(db.wbsItems, meta.leafData, null));
  return buildWorklist({ roots, schedule: undefined, week: 43, changeLog: [] });
})();
check('hasSchedule', noSched.hasSchedule, false);
check('due when unscheduled', noSched.due.length, 0);

if (failures.length) {
  console.log(`\n${failures.length} FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall checks passed');
