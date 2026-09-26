/**
 * Proves the rule behind the dashboard's Priority Actions card.
 *
 * The card replaced "What is urgent" and "What has to happen next" on 27 Sep
 * 2026. The second one looked at the PROJECT total, so a project ahead of plan
 * read "Reached" twice and said nothing about the activities; this one names
 * activities, and it is only worth anything if every name on it belongs there
 * and nothing that belongs there is missing. So each rule is asserted on a
 * hand-built plan, both ways: what gets in, and what must stay out.
 *
 * Then the deployed project's own shape (PHSS Samberah, 11 activities, read
 * off the deployment on 27 Sep 2026) at two weeks, because that is the plan
 * the card was designed against: at W36 nothing is due and the next thing is
 * Engineering by PTI starting W42; at W39 that start is the one action.
 *
 * No database. The tree is built by hand so a failure here is a failure in
 * `lib/priority-actions.ts` (or the worklist window it reads) and nowhere else.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-priority-actions.ts
 */
import type { RollupNode } from '../lib/rollup.ts';
import type { ScheduleItem } from '../lib/types.ts';
import { buildWorklist } from '../lib/worklist.ts';
import { buildPriorityActions, LOOK_AHEAD_WEEKS } from '../lib/priority-actions.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

/** id, weight, actual now, plan now %, plan at the horizon %, start week, finish week. */
type Spec = [string, number, number, number, number, number, number];

function leaf(id: string, bobot: number, cur: number, planPct: number, order: number): RollupNode {
  return {
    id,
    parentId: null,
    wbsCode: id,
    deskripsi: `Item ${id}`,
    bobot,
    vol: null,
    satuan: null,
    order,
    children: [],
    isLeaf: true,
    depth: 1,
    prevProgressPct: cur,
    prevWF: (bobot * cur) / 100,
    curProgressPct: cur,
    curWF: (bobot * cur) / 100,
    thisWeekProgressPct: 0,
    thisWeekWF: 0,
    targetWF: (bobot * planPct) / 100,
    variance: 0,
  } as RollupNode;
}

function run(specs: Spec[], week: number, lastWeek: number) {
  const roots = specs.map(([id, b, cur, now], i) => leaf(id, b, cur, now, i));
  const horizonRoots = specs.map(([id, b, cur, , atH], i) => leaf(id, b, cur, atH, i));
  const schedule: ScheduleItem[] = specs.map(([id, , , , , s, f]) => ({
    leafId: id,
    startWeek: s,
    finishWeek: f,
    pattern: 'linear',
  }));
  const worklist = buildWorklist({ roots, schedule, week, changeLog: [], weightsLocked: false });
  const horizonWeek = Math.min(week + LOOK_AHEAD_WEEKS, lastWeek);
  return buildPriorityActions({ roots, horizonRoots, schedule, week, horizonWeek, worklist });
}

/* ------------------------------------------------------------ every rule */

const W = 36;
const plan: Spec[] = [
  //  id    weight  now  planNow planH start finish
  ['L1', 8, 90, 100, 100, 20, 34], // late 2 weeks
  ['L2', 2, 50, 100, 100, 20, 31], // late 5 weeks: sorts above L1
  ['F1', 10, 20, 60, 100, 30, 38], // finishes W38, 40 points behind now: P1
  ['F2', 6, 85, 85, 100, 30, 37], // finishes W37, on plan: P2
  ['F3', 4, 70, 70, 100, 30, 39], // finishes on the horizon itself: in the window
  ['F4', 3, 50, 50, 70, 30, 40], // finishes one week past it, on plan: out
  ['C1', 12, 30, 45, 55, 30, 50], // running, 15 behind, finishes later: P2 catch up
  ['C2', 9, 45, 45, 55, 30, 50], // running on plan: normal work, out
  ['C3', 9, 44.5, 45, 55, 30, 50], // half a point behind: rounding noise, out
  ['C4', 5, 0, 20, 35, 32, 50], // should have started and has not: catch up
  ['S1', 5, 0, 0, 30, 38, 45], // starts W38: P3
  ['S2', 5, 0, 0, 0, 40, 45], // starts past the window: out
  ['D1', 7, 100, 100, 100, 30, 37], // finished: out, even with a finish in the window
  ['N1', 1, 99.6, 99, 100, 30, 37], // not quite finished: reads 99 → 100, never 100 → 100
  ['Z1', 0, 0, 0, 0, 36, 38], // zero weight and no plan: never a catch up or a start
];

const r = run(plan, W, 72);
const ids = r.actions.map((a) => a.node.id);
const byId = new Map(r.actions.map((a) => [a.node.id, a]));
console.log('   order:', ids.join(' '));

check('the window is the three weeks after the viewed one', r.fromWeek === 37 && r.horizonWeek === 39);

check('late items are P1', byId.get('L1')?.level === 1 && byId.get('L2')?.level === 1);
check('late carries how late', byId.get('L1')?.weeksLate === 2 && byId.get('L2')?.weeksLate === 5);
check('a finish in the window that is behind now is P1', byId.get('F1')?.level === 1 && byId.get('F1')?.behind === true);
check('a finish in the window on plan is P2', byId.get('F2')?.level === 2 && byId.get('F2')?.behind === false);
check('a finish on the horizon week is in the window', byId.get('F3')?.kind === 'finish');
check('a finish past the horizon, on plan, is out', !byId.has('F4'));
check('running behind is a P2 catch up', byId.get('C1')?.level === 2 && byId.get('C1')?.kind === 'behind');
check('running on plan is out', !byId.has('C2'));
check('half a point behind is out', !byId.has('C3'));
check('not started when it should have is a catch up', byId.get('C4')?.kind === 'behind');
check('a start in the window is P3', byId.get('S1')?.level === 3 && byId.get('S1')?.kind === 'start');
check('a start past the window is out', !byId.has('S2'));
check('a finished item is out', !byId.has('D1'));
check('zero weight is out', !byId.has('Z1'));

check('targets: late and finish aim at 100', ['L1', 'F1', 'F2', 'F3'].every((id) => byId.get(id)?.targetPct === 100));
check('targets: catch up and start aim at the horizon plan', byId.get('C1')?.targetPct === 55 && byId.get('S1')?.targetPct === 30);
check('99.6% reads 99 → 100', byId.get('N1')?.nowPct === 99 && byId.get('N1')?.targetPct === 100);

const levels = r.actions.map((a) => a.level);
check('P1 before P2 before P3', levels.every((l, i) => i === 0 || levels[i - 1] <= l), levels.join(''));
check(
  'within P1: longest late first, then the behind finish',
  ids.slice(0, 3).join(' ') === 'L2 L1 F1',
  ids.slice(0, 3).join(' ')
);
check(
  'within P2: soonest finish first, catch-ups after',
  ids.slice(3, 8).join(' ') === 'F2 N1 F3 C1 C4',
  ids.slice(3, 8).join(' ')
);
check('nothing on the list is shown as already there', r.actions.every((a) => a.targetPct > a.nowPct));
check('next is only for an empty list', r.next === null);

/* ------------------------------------------------ the last week of a plan */

const end = run([['E1', 10, 80, 100, 100, 60, 72], ['E2', 10, 100, 100, 100, 60, 72]], 72, 72);
check('on the last week the window is empty, not negative', end.horizonWeek === 72 && end.fromWeek === 73);
check('and what is due that week still shows', end.actions.length === 1 && end.actions[0].kind === 'finish');

/* ----------------------------------- PHSS Samberah, as deployed 27 Sep 2026 */

// Weeks run Monday to Sunday from 29 Dec 25. Plan now / at the horizon are the
// linear-by-day shares the app derives; the ones that matter are PTI at W42
// (7 of 28 days = 25%) and Fabrication at W36 (252 of 301 days = 83.72%).
const samberah = (week: number, h: number): Spec[] => [
  ['1.1 Engineering by Solar', 10.74, 100, week >= 43 ? 100 : 0, h >= 43 ? 100 : Math.max(0, (h - 39) * 25), 40, 43],
  ['1.2 Engineering by PTI', 10.74, 0, 0, h >= 42 ? Math.min(100, (h - 41) * 25) : 0, 42, 45],
  ['2.1 PO Material Solar', 16.03, 100, 100, 100, 1, 1],
  ['2.2 Fabrication and RTS Material Solar', 24.05, 100, (week * 7) / 301 * 100, (h * 7) / 301 * 100, 1, 43],
  ['2.3 Shipment to Site Material Solar', 19.61, 0, 0, 0, 43, 48],
  ['2.4 Fabrication and RTS Consumable Retrofit', 5.01, 0, 0, 0, 46, 63],
  ['2.5 Shipment to Site Consumable Retrofit', 5.01, 0, 0, 0, 58, 72],
  ['3.1 Preparation Work', 4, 50, 0, 0, 58, 62],
  ['3.2 Dismantling Retrofit', 0.8, 0, 0, 0, 68, 68],
  ['3.3 Installation Retrofit', 2, 0, 0, 0, 68, 70],
  ['4.1 Pre-commissioning, Commissioning & Startup', 2, 0, 0, 0, 70, 72],
];

const s36 = run(samberah(36, 39), 36, 72);
check('Samberah W36: nothing is due by W39', s36.actions.length === 0, s36.actions.map((a) => a.node.id).join(', '));
check(
  'Samberah W36: next up skips the finished Solar and names PTI starting W42',
  s36.next?.node.id === '1.2 Engineering by PTI' && s36.next.kind === 'start' && s36.next.week === 42,
  `${s36.next?.node.id} ${s36.next?.kind} W${s36.next?.week}`
);

const s39 = run(samberah(39, 42), 39, 72);
const pti = s39.actions[0];
check('Samberah W39: one action', s39.actions.length === 1, s39.actions.map((a) => a.node.id).join(', '));
check(
  'Samberah W39: P3 start of Engineering by PTI at W42, 0 → 25',
  pti?.node.id === '1.2 Engineering by PTI' && pti.level === 3 && pti.week === 42 && pti.nowPct === 0 && pti.targetPct === 25,
  pti ? `P${pti.level} ${pti.kind} W${pti.week} ${pti.nowPct} → ${pti.targetPct}` : ''
);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
