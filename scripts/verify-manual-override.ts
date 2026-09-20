/**
 * Proves the escape hatch actually moves the reported figure, and that it
 * un-freezes the moment the row is measured a different way again.
 *
 * `resolveLeafProgress` used to switch on `progressMethod` alone: a `qty` or
 * `milestone` row always recomputed from its own evidence and silently
 * ignored `cumProgressPct`, so a percent typed through "Type a percent
 * instead" was stored honestly and then thrown away on every read. The fix is
 * one more check ahead of the method switch: a snapshot carrying
 * `source: 'manual'` reports its own `cumProgressPct`, because a number a
 * person typed AND LABELLED as typed is evidence of its own kind, not a
 * calculation to be overridden.
 *
 * The dangerous edge is the reverse: a stale `source: 'manual'` left on a row
 * after someone later ticks a rung would freeze that week's figure forever.
 * Every save path must set `source` to what that save actually was, so a
 * gate/steps save clears the override by writing `'gate'`/`'steps'` over it.
 * Assertion 5 below is that un-freezing, and it is the one that matters most.
 *
 * No database. Everything is built by hand so a failure here is a failure in
 * `lib/progress.ts` and nowhere else.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-manual-override.ts
 */
import { resolveLeafProgress, syncLeafSnapshot } from '../lib/progress.ts';
import type { LeafSnapshot, Milestone, WbsItem } from '../lib/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

const rungs: Milestone[] = [
  { id: 'material', label: 'Material on site', weight: 15 },
  { id: 'install', label: 'Installation', weight: 50 },
  { id: 'connect', label: 'Connections', weight: 25 },
  { id: 'qc', label: 'QC inspection', weight: 10 },
];

const milestoneItem: Pick<WbsItem, 'progressMethod' | 'vol' | 'milestones'> = {
  progressMethod: 'milestone',
  vol: null,
  milestones: rungs,
};

const qtyItem: Pick<WbsItem, 'progressMethod' | 'vol' | 'milestones'> = {
  progressMethod: 'qty',
  vol: 200,
  milestones: undefined,
};

/* 1 — a milestone row with source: 'manual' reports the typed figure */
const milestoneManual: LeafSnapshot = {
  cumProgressPct: 73.5,
  targetWF: 0,
  milestonesDone: ['material', 'install'], // ladder alone would say 65
  source: 'manual',
};
check(
  'milestone + source manual reports the typed figure, not the ladder',
  resolveLeafProgress(milestoneItem, milestoneManual) === 73.5,
  `got ${resolveLeafProgress(milestoneItem, milestoneManual)}`
);

/* 2 — the SAME row without the override reports the ladder's own figure,
   proving the override (not something else) is what changed the answer */
const milestoneNoOverride: LeafSnapshot = {
  cumProgressPct: 73.5,
  targetWF: 0,
  milestonesDone: ['material', 'install'],
  // no source at all
};
const ladderPct = resolveLeafProgress(milestoneItem, milestoneNoOverride);
check(
  'the same row without source manual reports the ladder figure instead',
  Math.abs(ladderPct - 65) < 1e-9,
  `got ${ladderPct}`
);

/* 3 — a qty row behaves the same way in both directions */
const qtyManual: LeafSnapshot = { cumProgressPct: 88, targetWF: 0, qtyDone: 40, source: 'manual' };
check(
  'qty + source manual reports the typed figure, not qtyDone/total',
  resolveLeafProgress(qtyItem, qtyManual) === 88,
  `got ${resolveLeafProgress(qtyItem, qtyManual)}`
);
const qtyNoOverride: LeafSnapshot = { cumProgressPct: 88, targetWF: 0, qtyDone: 40 };
const qtyPct = resolveLeafProgress(qtyItem, qtyNoOverride);
check(
  'the same qty row without source manual reports qtyDone/total instead',
  Math.abs(qtyPct - 20) < 1e-9, // 40 / 200 * 100
  `got ${qtyPct}`
);

/* 4 — syncLeafSnapshot must not immediately overwrite the figure the
   override just recorded */
const synced = syncLeafSnapshot(milestoneItem, milestoneManual);
check(
  'syncLeafSnapshot leaves a manual snapshot\'s cumProgressPct untouched',
  synced.cumProgressPct === 73.5,
  `got ${synced.cumProgressPct}`
);

/* 4b — a non-manual snapshot is still recomputed as before (no regression) */
const syncedLadder = syncLeafSnapshot(milestoneItem, milestoneNoOverride);
check(
  'syncLeafSnapshot still recomputes a non-manual milestone snapshot',
  Math.abs(syncedLadder.cumProgressPct - 65) < 1e-9,
  `got ${syncedLadder.cumProgressPct}`
);

/* 5 — THE UN-FREEZING ASSERTION. Someone ticks a rung after the override,
   and the save path that does it writes source back to 'steps'. The row
   must return to the ladder's own figure, not stay pinned to the old
   hand-typed number. */
const afterAnotherTick: LeafSnapshot = {
  cumProgressPct: 73.5, // stale — nothing has recomputed this field yet
  targetWF: 0,
  milestonesDone: ['material', 'install', 'connect'], // a rung was ticked: 15+50+25 = 90
  source: 'steps', // the steps save path cleared the override
};
const unfrozen = resolveLeafProgress(milestoneItem, afterAnotherTick);
check(
  'ticking a rung with source reset to steps un-freezes the ladder figure',
  Math.abs(unfrozen - 90) < 1e-9,
  `got ${unfrozen}`
);
// And the recompute path agrees, so the STORED cumProgressPct catches up too.
const resynced = syncLeafSnapshot(milestoneItem, afterAnotherTick);
check(
  'syncLeafSnapshot recomputes cumProgressPct once the override is cleared',
  Math.abs(resynced.cumProgressPct - 90) < 1e-9,
  `got ${resynced.cumProgressPct}`
);

/* 6 — a manual snapshot with no cumProgressPct at all falls through rather
   than reporting null/NaN as a percentage */
const manualNoValue: LeafSnapshot = {
  cumProgressPct: undefined as unknown as number,
  targetWF: 0,
  milestonesDone: ['material'],
  source: 'manual',
};
const fallback = resolveLeafProgress(milestoneItem, manualNoValue);
check(
  'a manual snapshot with no cumProgressPct falls back to the ladder rather than NaN',
  Number.isFinite(fallback) && Math.abs(fallback - 15) < 1e-9,
  `got ${fallback}`
);

/* 7 — lumpsum is unaffected either way (no regression on the pre-existing path) */
const lumpsumItem: Pick<WbsItem, 'progressMethod' | 'vol' | 'milestones'> = {
  progressMethod: 'lumpsum',
  vol: null,
  milestones: undefined,
};
const lumpsumManual: LeafSnapshot = { cumProgressPct: 42, targetWF: 0, source: 'manual' };
check(
  'lumpsum + source manual still just reads cumProgressPct (no change in behaviour)',
  resolveLeafProgress(lumpsumItem, lumpsumManual) === 42
);
check(
  'syncLeafSnapshot is still a no-op for lumpsum',
  syncLeafSnapshot(lumpsumItem, lumpsumManual).cumProgressPct === 42
);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
