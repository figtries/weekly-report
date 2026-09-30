/**
 * Proves the daily report's list helpers, carry-forward, patching, section
 * states and weekly progress. The numbers are the supplied workbook's
 * (PRGG-00-G0-RPT-003, 12 Mar 2026): PTI Office 3 people at 8 h, Site 7 at 12 h,
 * Vendor 1 at 12 h; one OPEN permit valid to 23 Nov 2025.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-daily-carry.ts
 */
import assert from 'node:assert/strict';
import {
  activityStrings,
  hoursEachOf,
  inferHoursEach,
  joinItems,
  parseLegacyItems,
  suggestActivities,
  todayItemsOf,
  tomorrowItemsOf,
} from '../lib/daily-items.ts';
import { dailyProgressFor } from '../lib/daily-progress.ts';
import { daysLapsed, lapsedPermits, readyCount, sectionStates } from '../lib/daily-status.ts';
import { applyCreateDaily, applyPatchDaily } from '../lib/mutations.ts';
import type { DailyReport, Database } from '../lib/types.ts';

let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${(e as Error).message}`);
  }
}

function report(over: Partial<DailyReport> = {}): DailyReport {
  return {
    date: '2026-03-11',
    hariKe: 32,
    weather: {
      hujanDeras: false, hujanDerasJam: '', hujanSedang: false, hujanSedangJam: '',
      berawanMendung: true, berawanMendungJam: '', cerahTerang: false, cerahTerangJam: '',
      waktuMulai: '06:00', waktuSelesai: '18:00',
    },
    manHours: [
      { id: 'a', company: 'PTI - Office', pobQty: 3, previousHours: 3848, todayHours: 24 },
      { id: 'b', company: 'PTI - Site', pobQty: 7, previousHours: 8472, todayHours: 84 },
      { id: 'c', company: 'Vendor', pobQty: 1, previousHours: 156, todayHours: 12 },
    ],
    nonEffective: [{ id: 'n1', cause: 'Bad Weather', previous: 0, today: 2, remark: '' }],
    ptw: [
      { id: 'p1', description: 'Scaffolding', type: 'Cold Work', pwtNo: 'PW/TJG-PP/11-25/00002', pa: 'M Sulaeman', issued: '2025-11-17', validity: '2025-11-23', status: 'OPEN' },
      { id: 'p2', description: 'Old', type: 'Cold Work', pwtNo: 'PW/OLD', pa: 'X', issued: '2025-10-01', validity: '2025-10-07', status: 'CLOSED' },
    ],
    hseInput: [{ id: 'h1', activity: 'Near Miss', previous: 1, today: 0 }],
    activitiesToday: '1. Mobilisasi exhaust silencer\n2. Lubang coring unit 1201E',
    activitiesTomorrow: '1. Install baut angkur base skid\n2) Leveling base skid',
    planPct: 0,
    actualPct: 0,
    photos: [null, null, null, null, null, null],
    ...over,
  };
}

check('parseLegacyItems strips list marks and blank lines', () => {
  const items = parseLegacyItems('1. Mobilisasi silencer\n2) Lubang coring\n\n- Assist tim sipil\n2.5 m pipe', 'lt', true);
  assert.deepEqual(items.map((i) => i.text), ['Mobilisasi silencer', 'Lubang coring', 'Assist tim sipil', '2.5 m pipe']);
  assert.ok(items.every((i) => i.done));
  assert.deepEqual(items.map((i) => i.id), ['lt-1', 'lt-2', 'lt-3', 'lt-4']);
});

check('legacy strings read as items: today done, tomorrow not', () => {
  const r = report();
  assert.equal(todayItemsOf(r).length, 2);
  assert.ok(todayItemsOf(r).every((i) => i.done));
  assert.deepEqual(tomorrowItemsOf(r).map((i) => i.text), ['Install baut angkur base skid', 'Leveling base skid']);
  assert.ok(tomorrowItemsOf(r).every((i) => !i.done));
});

check('stored items win over the legacy strings', () => {
  const r = report({ todayItems: [{ id: 'x', text: 'Only this', done: false }] });
  assert.deepEqual(todayItemsOf(r).map((i) => i.text), ['Only this']);
});

check('activityStrings prints only what was done today, all of tomorrow', () => {
  const s = activityStrings(
    [{ id: '1', text: 'Done one', done: true }, { id: '2', text: 'Not done', done: false }],
    [{ id: '3', text: 'Plan A', done: false }, { id: '4', text: 'Plan B', done: false }]
  );
  assert.equal(s.activitiesToday, '1. Done one');
  assert.equal(s.activitiesTomorrow, '1. Plan A\n2. Plan B');
  assert.equal(joinItems([]), '');
});

check('inferHoursEach reads the workbook rows', () => {
  assert.equal(inferHoursEach({ pobQty: 3, todayHours: 24 }), 8);
  assert.equal(inferHoursEach({ pobQty: 7, todayHours: 84 }), 12);
  assert.equal(inferHoursEach({ pobQty: 1, todayHours: 12 }), 12);
  assert.equal(inferHoursEach({ pobQty: 0, todayHours: 0 }), undefined);
  assert.equal(inferHoursEach({ pobQty: 3, todayHours: 25 }), undefined);
  assert.equal(hoursEachOf({ id: 'a', company: 'x', pobQty: 3, previousHours: 0, todayHours: 24 }), 8);
  assert.equal(hoursEachOf({ id: 'a', company: 'x', pobQty: 3, hoursEach: 10, previousHours: 0, todayHours: 24 }), 10);
});

check('suggestActivities: newest first, deduplicated, skips what is taken', () => {
  const older = report({ date: '2026-03-10', activitiesToday: '1. Lubang coring unit 1201E', activitiesTomorrow: '1. Cleaning area' });
  const newer = report({ date: '2026-03-11' });
  const got = suggestActivities([older, newer], ['leveling base skid'], 10);
  assert.deepEqual(got.slice(0, 3), ['Mobilisasi exhaust silencer', 'Lubang coring unit 1201E', 'Install baut angkur base skid']);
  assert.ok(!got.map((g) => g.toLowerCase()).includes('leveling base skid'));
  assert.equal(new Set(got.map((g) => g.toLowerCase())).size, got.length);
  assert.equal(suggestActivities([newer], [], 1).length, 1);
});

function dbWith(...daily: DailyReport[]): Database {
  return { daily } as unknown as Database;
}

check('create carries crew at hours each, previous grows, OPEN permits and tomorrow into today', () => {
  const db = dbWith(report({ tomorrowItems: [{ id: 't1', text: 'Install baut angkur', done: false }] }));
  const r = applyCreateDaily(db, '2026-03-12');
  assert.equal(r.hariKe, 33);
  const [office, site, vendor] = r.manHours;
  assert.equal(office.pobQty, 3);
  assert.equal(office.hoursEach, 8);
  assert.equal(office.previousHours, 3848 + 24);
  assert.equal(office.todayHours, 24);
  assert.equal(site.todayHours, 84);
  assert.equal(vendor.todayHours, 12);
  assert.deepEqual(r.ptw.map((p) => p.id), ['p1']);
  assert.deepEqual(r.todayItems?.map((i) => [i.text, i.done]), [['Install baut angkur', false]]);
  assert.deepEqual(r.tomorrowItems, []);
  assert.equal(r.activitiesToday, '');
  assert.deepEqual(r.confirmed, {});
  assert.deepEqual(r.log, []);
  assert.equal(r.weather.berawanMendung, false);
  assert.equal(r.nonEffective[0].previous, 2);
  assert.equal(db.daily.length, 2);
});

check('create reads a legacy predecessor: tomorrow text becomes today items', () => {
  const r = applyCreateDaily(dbWith(report()), '2026-03-12');
  assert.deepEqual(r.todayItems?.map((i) => i.text), ['Install baut angkur base skid', 'Leveling base skid']);
});

check('patch merges confirmed and appends the log entry in one call', () => {
  const db = dbWith(report({ confirmed: { hse: true } }));
  applyPatchDaily(db, '2026-03-11', { confirmed: { manHours: true }, activitiesToday: 'x' }, [
    { id: 'l1', at: '2026-03-11T02:30:00.000Z', kind: 'hse', text: 'Near Miss +1' },
    { id: 'l2', at: '2026-03-11T02:31:00.000Z', kind: 'activity', text: 'Lubang coring' },
  ]);
  const r = db.daily[0];
  assert.deepEqual(r.confirmed, { hse: true, manHours: true });
  assert.equal(r.activitiesToday, 'x');
  assert.deepEqual(r.log?.map((l) => l.id), ['l1', 'l2']);
  applyPatchDaily(db, '2026-03-11', { hariKe: 5 });
  assert.equal(db.daily[0].log?.length, 2);
  assert.throws(() => applyPatchDaily(db, '2030-01-01', {}), /not found/);
});

check('a text-only patch is not shadowed by stored items; the screen writes both and keeps them', () => {
  const db = dbWith(applyCreateDaily(dbWith(report()), '2026-03-12'));
  const r = db.daily[0];
  assert.deepEqual(r.tomorrowItems, []);
  applyPatchDaily(db, '2026-03-12', { activitiesTomorrow: '1. From the API' });
  assert.deepEqual(tomorrowItemsOf(r).map((i) => i.text), ['From the API']);
  const items = [{ id: 'x', text: 'From the screen', done: false }];
  applyPatchDaily(db, '2026-03-12', { tomorrowItems: items, ...activityStrings([], items) });
  assert.deepEqual(tomorrowItemsOf(r).map((i) => i.text), ['From the screen']);
  assert.equal(r.activitiesTomorrow, '1. From the screen');
});

const READY_PROGRESS = { state: 'ready', week: 5, actual: 44, plan: 42.29, variance: 1.71, weightsTotal: 100 } as const;

check('the workbook permit is 109 days past its validity', () => {
  const r = report({ date: '2026-03-12' });
  assert.deepEqual(lapsedPermits(r).map((p) => p.id), ['p1']);
  assert.equal(daysLapsed('2025-11-23', '2026-03-12'), 109);
  assert.equal(lapsedPermits(report({ date: '2025-11-20' })).length, 0);
});

check('a freshly created day: nothing is ready that nobody said, crew and permits are "same"', () => {
  const r = applyCreateDaily(dbWith(report()), '2026-03-12');
  const s = sectionStates(r, READY_PROGRESS);
  assert.equal(s.weather, 'look');
  assert.equal(s.manHours, 'same');
  assert.equal(s.ptw, 'look');
  assert.equal(s.hse, 'same');
  assert.equal(s.activities, 'same');
  assert.equal(s.aoc, 'empty');
  assert.equal(s.progress, 'ready');
  assert.equal(s.photos, 'empty');
  assert.equal(readyCount(s), 1);
});

check('confirming and entering move sections to ready', () => {
  const r = applyCreateDaily(dbWith(report()), '2026-03-12');
  r.confirmed = { manHours: true, hse: true, activities: true, ptw: true };
  r.ptw = r.ptw.map((p) => ({ ...p, status: 'CLOSED' }));
  r.weather.cerahTerang = true;
  r.aocNone = true;
  r.photos[0] = '/uploads/x.jpg';
  const s = sectionStates(r, READY_PROGRESS);
  assert.deepEqual(Object.values(s), ['ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready', 'ready']);
  assert.equal(readyCount(s), 8);
});

check('an HSE count entered today is ready without a confirm', () => {
  const r = applyCreateDaily(dbWith(report()), '2026-03-12');
  r.hseInput[0].today = 1;
  assert.equal(sectionStates(r, null).hse, 'ready');
  assert.equal(sectionStates(r, null).progress, 'empty');
  assert.equal(sectionStates(r, { ...READY_PROGRESS, state: 'held' }).progress, 'held');
});

check('an older report (no confirmed) counts its filled sections as confirmed, AOC excepted', () => {
  const s = sectionStates(report({ date: '2025-11-20' }), READY_PROGRESS);
  assert.equal(s.manHours, 'ready');
  assert.equal(s.hse, 'ready');
  assert.equal(s.activities, 'ready');
  assert.equal(s.ptw, 'ready');
  assert.equal(s.aoc, 'empty');
});

const STATUS = {
  week: 36,
  ready: true,
  weightsTotal: 100,
  anchorEnd: '2025-10-30',
  byWeek: { 1: { actual: 1, plan: 2 }, 5: { actual: 10.5, plan: 12.25 }, 36: { actual: 51.09, plan: 37.85 } } as Record<number, { actual: number; plan: number }>,
};

check('progress: the week the date falls in, clamped to the current week', () => {
  // Week 1 ends 2025-10-30 (it runs Oct 24 to Oct 30), so week 5 is Nov 21 to Nov 27.
  const p = dailyProgressFor(STATUS, '2025-11-25');
  assert.equal(p?.state, 'ready');
  assert.equal(p?.week, 5);
  assert.equal(p?.actual, 10.5);
  assert.equal(p?.variance, -1.75);
  // A date past the current week reads the current week, never a future one.
  assert.equal(dailyProgressFor(STATUS, '2030-01-01')?.week, 36);
  // Before week 1 clamps to week 1.
  assert.equal(dailyProgressFor(STATUS, '2025-01-01')?.week, 1);
});

check('progress: held while the weights do not close, null with no project', () => {
  const held = dailyProgressFor({ ...STATUS, ready: false, weightsTotal: 70.79, byWeek: {} }, '2025-12-01');
  assert.equal(held?.state, 'held');
  assert.equal(held?.weightsTotal, 70.79);
  assert.equal(dailyProgressFor(null, '2025-12-01'), null);
});

// LATER TASKS APPEND CHECKS ABOVE THIS LINE.
if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
