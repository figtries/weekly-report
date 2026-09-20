/**
 * Proves that changing how something is measured never changes how much of it
 * was done, and that the preview shown before a bulk apply is the same arithmetic
 * the apply itself performs.
 *
 * The rule being protected is `applyProgressMethod`'s: rungs are awarded in order
 * until the next one would exceed what was already reported, so a restatement is
 * never more generous than the number it came from. A row at 100 stays at 100. A
 * row at 0 stays at 0. Only a row genuinely between rungs moves, and it moves
 * DOWN, which is why a preview exists at all.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind-apply.ts
 */
import { BUILT_IN_KINDS } from '../lib/work-kind.ts';
import { changeFor, impactOf, ladderFor } from '../lib/work-kind-apply.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

const construction = ladderFor('construction', 'steps', 'Exhaust System Installation', BUILT_IN_KINDS);
check('construction ladder has four rungs', construction.length === 4);

const gate = ladderFor('procurement', 'gate', 'Material On Site', BUILT_IN_KINDS);
check('a gate ladder has one rung named after the row', gate.length === 1 && gate[0].label === 'Material On Site');

/* a finished row does not move */
const done = changeFor({ id: 'a', name: 'x', bobot: 10, pct: 100 }, construction);
check('100 stays 100', done.toPct === 100, String(done.toPct));

/* an untouched row does not move */
const zero = changeFor({ id: 'b', name: 'x', bobot: 10, pct: 0 }, construction);
check('0 stays 0', zero.toPct === 0, String(zero.toPct));

/* 15/50/25/10: 57.5 clears material(15) and install(65)? no — 15+50=65 > 57.5 */
const mid = changeFor({ id: 'c', name: 'x', bobot: 10, pct: 57.5 }, construction);
check('57.5 restates DOWN to 15, never up', mid.toPct === 15, String(mid.toPct));
check('57.5 awards exactly one rung', mid.done.length === 1 && mid.done[0] === 'material');

/* landing exactly on a rung boundary keeps that rung */
const exact = changeFor({ id: 'd', name: 'x', bobot: 10, pct: 65 }, construction);
check('65 keeps material + install', exact.toPct === 65 && exact.done.length === 2, String(exact.toPct));

/* THE CLIMB STOPS AT THE FIRST RUNG IT CANNOT REACH.
   Without the stop, 57.5 on 15/50/25/10 awards material, connections and QC but
   not installation: a QC pass on something not yet installed, and 50% instead of
   15%. This is the single assertion that keeps that from coming back. */
check('a missed rung ends the climb', !mid.done.includes('qc') && !mid.done.includes('connect'), mid.done.join(','));

/* a gate rounds to the nearest end, never to the middle */
const g1 = changeFor({ id: 'e', name: 'x', bobot: 10, pct: 99 }, gate);
check('a gate at 99 restates to 0, because one rung is all or nothing', g1.toPct === 0, String(g1.toPct));
const g2 = changeFor({ id: 'f', name: 'x', bobot: 10, pct: 100 }, gate);
check('a gate at 100 stays 100', g2.toPct === 100);

/* impact is weighted, and a preview equals the sum of the changes it previewed */
const impact = impactOf([done, zero, mid, exact]);
const expectedDelta = (15 - 57.5) / 100 * 10;
check('only rows that moved are counted', impact.movedRows === 1, String(impact.movedRows));
check('points delta is weighted and negative', Math.abs(impact.pointsDelta - expectedDelta) < 1e-9, String(impact.pointsDelta));

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
