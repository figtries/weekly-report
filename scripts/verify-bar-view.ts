/**
 * Guards the bar model: colours per mode, defaults, overrides, and that the
 * solid part of a bar IS its done percentage for every shape.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-bar-view.ts
 */
import {
  DEFAULT_BAR_VIEW,
  PALETTE,
  hasPackages,
  labelsByRow,
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
check('a new project starts on one colour', v.colourBy === 'one');
check('default marks', v.marks.done && v.marks.forecast && v.marks.contract && !v.marks.slip && v.marks.links);
check(
  'palette has 12 (two full rows of six), no red or amber',
  PALETTE.length === 12 &&!PALETTE.some((p) => (['danger', 'warn'] as string[]).includes(p.key))
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
check('packages are found or not, never hidden', hasPackages([{ colorGroup: 0 }]) && !hasPackages([{ colorGroup: -1 }]));
const lv = parseBarView(
  JSON.stringify({
    colourBy: 'label',
    labels: [
      { id: 'a', name: '  Critical vendor  ', paint: 'plan-4' },
      { id: 'b', name: 'Client scope', paint: 'danger' },
      { id: 'a', name: 'dup', paint: 'plan-1' },
      { name: 'no id' },
    ],
  })
);
check('labels read: trimmed, deduped, bad paint made grey', lv.labels.length === 2 && lv.labels[0].name === 'Critical vendor' && lv.labels[1].paint === 'muted', JSON.stringify(lv.labels));
check('label colour', paintOf(row, 'engineering', lv, 'label', 'a') === 'plan-4');
check('no label is grey', paintOf(row, 'engineering', lv, 'label', null) === 'muted');
const tree = labelsByRow([
  { id: 'h', parentId: null, barLabel: 'a' },
  { id: 'x', parentId: 'h', barLabel: null },
  { id: 'y', parentId: 'h', barLabel: 'b' },
  { id: 'z', parentId: null, barLabel: null },
]);
check('a heading label paints rows with none of their own', tree.get('x') === 'a' && tree.get('y') === 'b' && tree.get('z') === null);

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

// What a pressed bar says: every clause only when it has something to say.
{
  const { barSentence } = await import('../lib/bar-sentence.ts');
  const row = {
    isSummary: false,
    isMilestone: false,
    startDate: '2026-03-23',
    finishDate: '2026-05-17',
    contractStart: null as string | null,
    contractFinish: null as string | null,
  };
  const fact = {
    kindId: 'engineering',
    shape: 'steps' as const,
    disciplineId: null,
    disciplineShort: null,
    donePct: 80,
    rungs: ladder,
    ladder: ['ifr', 'ifa', 'afc'],
    forecastFinish: '2026-05-24',
    planFinish: '2026-05-17',
    reason: 'it waits for Process Design Basis',
  };
  const late = barSentence(row, fact, { setsFinish: true });
  check(
    'late bar sentence',
    late ===
      'Plan 23 Mar → 17 May · Done 80% (IFR, IFA) · Finishes 24 May, 7 days late because it waits for Process Design Basis · Sets the project finish',
    late
  );
  const onPlan = barSentence(
    { ...row, contractStart: '2026-03-18', contractFinish: '2026-05-12' },
    { ...fact, forecastFinish: '2026-05-17', reason: null, donePct: 0, rungs: [] },
    { setsFinish: false }
  );
  check('on-plan bar sentence', onPlan === 'Plan 23 Mar → 17 May · Finishes on plan · Contract 18 Mar → 12 May', onPlan);
  const bare = barSentence(row, undefined, { setsFinish: false });
  check('bar with no facts', bare === 'Plan 23 Mar → 17 May', bare);
  const ms = barSentence({ ...row, isMilestone: true }, undefined, { setsFinish: false });
  check('milestone sentence', ms === 'On 23 Mar', ms);
}

// The column the panel writes, round-tripped on a copy of the real database.
{
  const { default: Database } = await import('better-sqlite3');
  const { copyDbFixture } = await import('./db-fixture.ts');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = copyDbFixture('data/report.db', join(tmpdir(), `bar-view-${Date.now()}.db`));
  const d = new Database(file);
  const id = (d.prepare('select id from projects limit 1').get() as { id: string }).id;
  d.prepare('update projects set bar_view = ? where id = ?').run(
    JSON.stringify({ colourBy: 'one', colours: { one: 'plan-6' } }),
    id
  );
  const back = parseBarView((d.prepare('select bar_view v from projects where id = ?').get(id) as { v: string }).v);
  check('stored view reads back', back.colourBy === 'one' && back.colours.one === 'plan-6');
  check('a project never written reads defaults', parseBarView(null).colourBy === 'one');
  d.close();
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
