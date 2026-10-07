/**
 * Guards the bar model: colours per mode, defaults, overrides, and that the
 * solid part of a bar IS its done percentage for every shape.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-bar-view.ts
 */
import {
  DEFAULT_BAR_VIEW,
  PALETTE,
  canColourByPackage,
  effectiveColourBy,
  paintOf,
  parseBarView,
  segmentsOf,
} from '../lib/bar-view.ts';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
  if (!ok) failed += 1;
};
const solid = (s: { from: number; to: number; done: boolean }[]) =>
  s.filter((x) => x.done).reduce((a, x) => a + (x.to - x.from), 0);

const v = parseBarView(null);
check('null reads as defaults', JSON.stringify(v) === JSON.stringify(DEFAULT_BAR_VIEW));
check('default colours by kind', v.colourBy === 'kind');
check('default marks', v.marks.done && v.marks.forecast && v.marks.contract && !v.marks.slip);
check(
  'palette has 8, no red or amber',
  PALETTE.length === 8 && !PALETTE.some((p) => (['danger', 'warn'] as string[]).includes(p.key))
);
check('garbage json reads as defaults', JSON.stringify(parseBarView('{nope')) === JSON.stringify(DEFAULT_BAR_VIEW));
check(
  'unknown paint dropped',
  parseBarView(JSON.stringify({ colours: { kind: { engineering: 'danger' } } })).colours.kind.engineering === undefined
);

const row = { colorGroup: 1, unitId: 'u2' };
check('kind default', paintOf(row, 'engineering', v, 'kind') === 'plan-1');
check('no kind is grey', paintOf(row, null, v, 'kind') === 'muted');
const custom = parseBarView(
  JSON.stringify({ colours: { kind: { engineering: 'plan-6' }, package: { u2: 'plan-4' }, one: 'foreground' } })
);
check('kind override', paintOf(row, 'engineering', custom, 'kind') === 'plan-6');
check('package default from group', paintOf(row, null, v, 'package') === 'plan-2');
check('package override', paintOf(row, null, custom, 'package') === 'plan-4');
check('one colour', paintOf(row, 'engineering', custom, 'one') === 'foreground');
check(
  'package needs two groups',
  !canColourByPackage([{ colorGroup: 0 }, { colorGroup: -1 }]) && canColourByPackage([{ colorGroup: 0 }, { colorGroup: 1 }])
);
const pkg = parseBarView(JSON.stringify({ colourBy: 'package' }));
check('package falls back to kind on a one-package plan', effectiveColourBy(pkg, [{ colorGroup: 0 }]) === 'kind');

const ladder = [
  { label: 'IFR', weight: 50, done: true },
  { label: 'IFA', weight: 30, done: true },
  { label: 'AFC', weight: 20, done: false },
];
const s1 = segmentsOf(ladder, 80);
check('ladder: one segment per rung', s1.length === 3, `${s1.length}`);
check('ladder: segments close at 1', Math.abs(s1.at(-1)!.to - 1) < 1e-9);
check('ladder: solid = done %', Math.abs(solid(s1) - 0.8) < 1e-9, `${solid(s1)}`);
const s2 = segmentsOf([], 37.5);
check('typed: solid = done %', Math.abs(solid(s2) - 0.375) < 1e-9, `${solid(s2)}`);
check('typed: closes at 1', Math.abs(s2.at(-1)!.to - 1) < 1e-9);
check('nothing done: no solid', solid(segmentsOf([], 0)) === 0 && segmentsOf([], 0).length === 1);
check('all done: one solid', segmentsOf([], 100).length === 1 && solid(segmentsOf([], 100)) === 1);
check('gate: one labelled segment', segmentsOf([{ label: 'IFR', weight: 100, done: false }], 0)[0].label === 'IFR');

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
