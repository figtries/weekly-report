/**
 * Proves the four claims the Data Overall map makes to whoever reads it.
 *
 * One: it invents no figure — every percentage on screen is the one
 * `lib/rollup.ts` already computed. Two: milestone ROWS (zero weight) never
 * appear, because a row that cannot move a report must not be offered as work.
 * Three: due and filled-in counts roll up from the leaves the worklist named,
 * so "3 of 9" on a contract means the same as "3 of 9" at the top. Four: the
 * optimistic tree — the thing that makes a contract bar visibly grow the moment
 * an activity under it is saved — carries a leaf's new percent up by WEIGHT,
 * exactly as the real rollup would, so the half second before the server
 * answers never shows a number the server then contradicts.
 *
 * No database. The tree is built by hand so a failure here is a failure in
 * `lib/overall-map.ts` and nowhere else.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-overall-map.ts
 */
import type { RollupNode } from '../lib/rollup.ts';
import type { LeafSnapshot } from '../lib/types.ts';
import type { Worklist } from '../lib/worklist.ts';
import { buildOverallMap, findNode, matchingIds, withOptimistic } from '../lib/overall-map.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};
const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol;

function leaf(
  id: string,
  bobot: number,
  cur: number,
  target: number,
  extra: Partial<RollupNode> = {}
): RollupNode {
  return {
    id,
    parentId: null,
    wbsCode: id,
    deskripsi: `Item ${id}`,
    bobot,
    vol: null,
    satuan: null,
    order: 0,
    children: [],
    isLeaf: true,
    depth: 1,
    prevProgressPct: 0,
    prevWF: 0,
    curProgressPct: cur,
    curWF: (bobot * cur) / 100,
    thisWeekProgressPct: 0,
    thisWeekWF: 0,
    targetWF: target,
    variance: 0,
    ...extra,
  } as RollupNode;
}

function branch(id: string, kids: RollupNode[], extra: Partial<RollupNode> = {}): RollupNode {
  const bobot = kids.reduce((s, k) => s + k.bobot, 0);
  const curWF = kids.reduce((s, k) => s + k.curWF, 0);
  const targetWF = kids.reduce((s, k) => s + k.targetWF, 0);
  return {
    ...leaf(id, bobot, bobot > 0 ? (curWF / bobot) * 100 : 0, targetWF, extra),
    deskripsi: `Branch ${id} (SPK-00${id})`,
    children: kids,
    isLeaf: false,
    depth: 0,
    curWF,
  } as RollupNode;
}

/**
 * One contract of three leaves — 30/20/10 of the project — plus a zero-weight
 * milestone row that must never show up, and a second contract nobody has
 * touched.
 */
const a1 = leaf('a1', 30, 50, 18, { workKind: 'civil' }); // plan 60%, actual 50% → 10 behind
const a2 = leaf('a2', 20, 100, 20, { workKind: null }); // asked, and the answer is none of the above
const a3 = leaf('a3', 10, 0, 2); // never asked
const flag = leaf('a9', 0, 0, 0);
const unitA = branch('1', [a1, a2, a3, flag]);
const b1 = leaf('b1', 40, 25, 16);
const unitB = branch('2', [b1]);

const worklist: Worklist = {
  due: [{ node: a1 } as never, { node: a3 } as never],
  done: [{ node: a2 } as never],
  stuck: [{ node: b1, weeksLate: 2 } as never],
  soon: [{ node: a3, weeksLeft: 1 } as never],
  hasSchedule: true,
};

const map = buildOverallMap({
  roots: [unitA, unitB],
  snapshots: {
    a1: { cumProgressPct: 50, targetWF: 18, note: 'vendor report #4', source: 'gate' },
    // The nullable DB column can hold an explicit null, not just "absent".
    a3: { cumProgressPct: 0, targetWF: 2, source: null } as unknown as LeafSnapshot,
  },
  worklist,
  schedule: [{ leafId: 'a1', startWeek: 3, finishWeek: 9, pattern: 'linear' }],
  changeLog: [
    { id: 'c1', leafId: 'a1', week: 4, field: 'cumProgressPct', oldValue: 40, newValue: 50, at: '2026-09-10T02:00:00.000Z' },
    { id: 'c2', leafId: 'a1', week: 5, field: 'cumProgressPct', oldValue: 50, newValue: 50, at: '2026-09-12T02:00:00.000Z' },
  ],
  facts: { a1: { price: 1000, start: '2026-01-05', finish: '2026-02-20' } },
});

/* ------------------------------------------------------- figures, unchanged */

const mA = findNode(map.units, '1')!;
const mA1 = findNode(map.units, 'a1')!;

check('a contract keeps the rollup percent it arrived with', near(mA.actualPct, unitA.curProgressPct), `${mA.actualPct}`);
check('a leaf keeps its own percent', near(mA1.actualPct, 50), `${mA1.actualPct}`);
check('plan percent is targetWF over weight', near(mA1.planPct, 60), `${mA1.planPct}`);
check('behind is plan minus actual', near(mA1.behindPct, 10), `${mA1.behindPct}`);

/* ---------------------------------------------------- zero-weight rows gone */

check('a zero-weight milestone row is not on the map', findNode(map.units, 'a9') === null);
check('it is not counted as an activity either', mA.leafCount === 3, `${mA.leafCount}`);

/* ----------------------------------------------------------- due and filled */

check('the whole week counts three due', map.due === 3, `${map.due}`);
check('one of them is already filled in', map.filled === 1, `${map.filled}`);
check('a contract rolls its own due count up', mA.dueCount === 3, `${mA.dueCount}`);
check('and its own filled count', mA.filledCount === 1, `${mA.filledCount}`);
check('a contract nothing is due in reads zero', findNode(map.units, '2')!.dueCount === 0);
check('stuck comes straight from the worklist', map.stuck === 1, `${map.stuck}`);

/* -------------------------------------------------------------- leaf detail */

check('a leaf carries its measurement method', mA1.method === 'lumpsum', String(mA1.method));
check('a leaf carries its price when SQLite has one', mA1.price === 1000, String(mA1.price));
check('last touched is the LATEST entry, not the first', mA1.lastTouchedAt === '2026-09-12T02:00:00.000Z', String(mA1.lastTouchedAt));
check('schedule weeks come through', mA1.startWeek === 3 && mA1.finishWeek === 9);

/* --------------------------------------------------- work kind, note, source */

const mA2 = findNode(map.units, 'a2')!;
const mA3 = findNode(map.units, 'a3')!;

check('a leaf carries its work kind unchanged', mA1.workKind === 'civil', String(mA1.workKind));
check("this week's note comes through unchanged", mA1.note === 'vendor report #4', String(mA1.note));
check('how the figure was arrived at comes through unchanged', mA1.source === 'gate', String(mA1.source));

check('an explicit null work kind stays null, not undefined', mA2.workKind === null, String(mA2.workKind));
check('no snapshot at all leaves the note null', mA2.note === null, String(mA2.note));
check('no snapshot at all leaves the source null', mA2.source === null, String(mA2.source));

check('a work kind nobody set reads null, not a default', mA3.workKind === null, String(mA3.workKind));
check('a snapshot with no note leaves it null', mA3.note === null, String(mA3.note));
check('an explicit null source stays null, not defaulted to a method', mA3.source === null, String(mA3.source));

/* ------------------------------------------ the new fields move no percentage */

function expectedPlanPct(n: RollupNode): number {
  return n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0;
}
[unitA, unitB, a1, a2, a3, b1].forEach((n) => {
  const m = findNode(map.units, n.id)!;
  const plan = expectedPlanPct(n);
  const ok =
    near(m.weight, n.bobot) &&
    near(m.actualPct, n.curProgressPct) &&
    near(m.planPct, plan) &&
    near(m.behindPct, plan - n.curProgressPct);
  check(
    `${n.id} keeps every percentage exactly as before work kind/note/source were added`,
    ok,
    `weight=${m.weight} actual=${m.actualPct} plan=${m.planPct} behind=${m.behindPct}`
  );
});

/* ------------------------------------------------- a single root is unwrapped */

const wrapped = buildOverallMap({
  roots: [branch('0', [unitA, unitB])],
  snapshots: {},
  worklist,
  schedule: [],
  changeLog: [],
});
check('a lone project row is not the map', wrapped.units.length === 2, `${wrapped.units.length}`);
check('its children become the contracts', wrapped.units.map((u) => u.id).join() === '1,2');
check('two top rows are left alone', map.units.length === 2, `${map.units.length}`);

/* ------------------------------------------------------------------- filter */

const dueOnly = matchingIds(map.units, (n) => n.dueCount > 0);
check('a filter keeps the contract that holds a match', dueOnly.has('1'));
check('a filter drops the contract that holds none', !dueOnly.has('2'));
check('a filter keeps the matching leaf itself', dueOnly.has('a1') && dueOnly.has('a3'));

/* --------------------------------------------------------------- optimistic */

const moved = withOptimistic(map.units, { a3: 100 });
const oA = findNode(moved, '1')!;
const oA3 = findNode(moved, 'a3')!;
// 30×50 + 20×100 + 10×100 = 1500 + 2000 + 1000 = 4500 over weight 60 → 75%.
check('the saved leaf shows its new percent at once', near(oA3.actualPct, 100), `${oA3.actualPct}`);
check('its contract rises by WEIGHT, as the real rollup would', near(oA.actualPct, 75), `${oA.actualPct}`);
check('an untouched contract does not move', near(findNode(moved, '2')!.actualPct, 25));
check('the original tree is left alone', near(findNode(map.units, 'a3')!.actualPct, 0));
check('behind is re-read from the new percent', near(oA3.behindPct, (2 / 10) * 100 - 100), `${oA3.behindPct}`);

// Late and ending-soon are the worklist's, carried onto the row — never
// worked out by the map.
check('a late leaf carries how late it is', findNode(map.units, 'b1')!.lateBy === 2);
check('an ending-soon leaf carries how soon', findNode(map.units, 'a3')!.dueIn === 1);
check('a leaf that is neither carries neither', findNode(map.units, 'a1')!.lateBy === undefined && findNode(map.units, 'a1')!.dueIn === undefined);
check('the contracts count them', findNode(map.units, '2')!.lateCount === 1 && findNode(map.units, '1')!.soonCount === 1);
check('and so does the map', map.stuck === 1 && map.soon === 1);

console.log(failed ? `\n${failed} FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
