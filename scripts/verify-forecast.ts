/**
 * Proves the completion forecast reads like an EPC planner's, on the project
 * that showed the old one was wrong (27 Sep 2026).
 *
 * The fixture is PHSS Samberah as deployed at week 38: its 11 activities with
 * their exact weights and dates, work kinds as they were tagged (wrongly in
 * three places), and the progress history that made the old forecast read
 * "week 56": nothing until W26, +40.08 at W26 (PO and fabrication typed 100),
 * +2.00 at W30, +10.74 at W36, and PO 2.1 typed down from 100 to 99 at W37.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts
 */
import { computeHealth, narrativeParts } from '../lib/analysis.ts';
import { forecastChecks } from '../lib/forecast-checks.ts';
import { forecastFromDb } from '../lib/forecast-read.ts';
import { buildForecastView } from '../lib/forecast-view.ts';
import { leafPlanFraction } from '../lib/plan-curve.ts';
import {
  PROCUREMENT_STEPS,
  phaseOfHeading,
  profileRowsOf,
  rungsNamedBy,
  subjectOf,
  suggestWaitsFor,
  unansweredLinks,
} from '../lib/forecast-epc.ts';
import { disagreement, earnedSchedule, forecastProject, weekContaining, type ForecastLeafInput } from '../lib/forecast.ts';
import type { Database, LeafSnapshot, WbsItem, WeeklyMeta } from '../lib/types.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

/* ------------------------------------------------------------- the fixture */

const PROC = ['po', 'fab', 'rts', 'onsite'];
const ENG = ['ifr', 'ifa', 'afc'];
const CON = ['material', 'install', 'connect', 'qc'];
const STEP_WEIGHT: Record<string, number> = {
  po: 20, fab: 40, rts: 15, onsite: 25, ifr: 50, ifa: 30, afc: 20, material: 15, install: 50, connect: 25, qc: 10,
};
const nid = (code: string) => `n${code}`;
const codeOf = (id: string) => id.slice(1);
const ladder = (code: string, steps: string[]) =>
  steps.map((s) => ({ id: `${nid(code)}:${s}`, label: s, weight: STEP_WEIGHT[s] }));

const HEADINGS: Array<[string, string]> = [
  ['1', 'Engineering'],
  ['2', 'Procurement'],
  ['3', 'CONSTRUCTION & INSTALLATION'],
  ['4', 'MECHANICAL COMPLETION & COMMISSIONING'],
];
type Row = [string, string, number, string, string, string | null, string[] | null];
const ROWS: Row[] = [
  ['1.1', 'Engineering by Solar', 10.737227899977771, '2026-09-28', '2026-10-25', 'engineering', ENG],
  ['1.2', 'Engineering by PTI', 10.737227899977771, '2026-10-12', '2026-11-08', 'engineering', null],
  ['2.1', 'PO Material Solar', 16.034094082911064, '2025-12-29', '2026-01-04', 'procurement', PROC],
  ['2.2', 'Fabrication and RTS Material Solar', 24.051390495950205, '2025-12-29', '2026-10-25', null, null],
  ['2.3', 'Shipment to Site Material Solar', 19.614856276469013, '2026-10-19', '2026-11-29', 'procurement', PROC],
  ['2.4', 'Fabrication and RTS Consumable Retrofit', 5.010658853973701, '2026-11-09', '2027-03-14', null, null],
  ['2.5', 'Shipment to Site Consumable Retrofit', 5.010801352021478, '2027-02-01', '2027-05-14', null, null],
  ['3.1', 'Preparation Work', 4.001487679618789, '2027-02-01', '2027-03-07', 'engineering', ENG],
  ['3.2', 'Dismantling Retrofit', 0.8002690363142025, '2027-04-12', '2027-04-18', 'construction', CON],
  ['3.3', 'Installation Retrofit', 2.0007438398093944, '2027-04-12', '2027-05-02', 'engineering', ENG],
  ['4.1', 'Pre-commissioning, Commissioning & Startup', 2.001242582976613, '2027-04-26', '2027-05-14', 'procurement', PROC],
];

function buildItems(): WbsItem[] {
  const items: WbsItem[] = HEADINGS.map(([code, name]) => ({
    id: nid(code), parentId: null, wbsCode: code, deskripsi: name, bobot: 0, vol: null, satuan: null, order: Number(code) * 100,
  }));
  ROWS.forEach(([code, name, weight, , , kind, steps], i) => {
    items.push({
      id: nid(code),
      parentId: nid(code.split('.')[0]),
      wbsCode: code,
      deskripsi: name,
      bobot: weight,
      vol: 1,
      satuan: 'Ls',
      order: Number(code.split('.')[0]) * 100 + i + 1,
      progressMethod: steps ? 'milestone' : 'lumpsum',
      milestones: steps ? ladder(code, steps) : undefined,
      workKind: kind,
    });
  });
  return items;
}

const DAY = 86_400_000;
const START = Date.UTC(2025, 11, 29);
const FINISH = '2027-05-14';
const WEEKS = 72;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const weekEnd = (n: number) => {
  const e = iso(START + (7 * n - 1) * DAY);
  return e > FINISH ? FINISH : e;
};

function snapFor(code: string, week: number): Omit<LeafSnapshot, 'targetWF'> {
  const id = nid(code);
  if (code === '2.1' && week >= 26)
    return { cumProgressPct: week >= 37 ? 99 : 100, source: 'manual', milestonesDone: ['po', 'fab', 'rts'].map((s) => `${id}:${s}`) };
  if (code === '2.2' && week >= 26) return { cumProgressPct: 100 };
  if (code === '3.1' && week >= 30) return { cumProgressPct: 50, source: 'steps', milestonesDone: [`${id}:ifr`] };
  if (code === '1.1' && week >= 36)
    return { cumProgressPct: 100, source: 'steps', milestonesDone: ENG.map((s) => `${id}:${s}`) };
  return { cumProgressPct: 0 };
}

function buildFixture(): Database {
  const weeks: WeeklyMeta[] = [];
  for (let n = 1; n <= WEEKS; n++) {
    const end = weekEnd(n);
    const leafData: Record<string, LeafSnapshot> = {};
    for (const [code, , weight, start, finish] of ROWS) {
      leafData[nid(code)] = { ...snapFor(code, n), targetWF: weight * leafPlanFraction(start, finish, end) };
    }
    weeks.push({ week: n, periodStart: iso(START + 7 * (n - 1) * DAY), periodEnd: end, documentation: [], leafData });
  }
  const weekOf = (d: string) => weeks.find((w) => w.periodEnd >= d)?.week ?? WEEKS;
  return {
    project: { projectBudget: 100 },
    wbsItems: buildItems(),
    weeks,
    scurvePlan: [],
    scurveActual: [],
    daily: [],
    schedule: ROWS.map(([code, , , start, finish]) => ({
      leafId: nid(code), startWeek: weekOf(start), finishWeek: weekOf(finish), pattern: 'linear', startDate: start, finishDate: finish,
    })),
  } as unknown as Database;
}

const mapByCode = (m: Map<string, string[]>) =>
  [...m].map(([k, v]) => `${codeOf(k)}<-${v.map(codeOf).join('+')}`).sort().join(' ');

/* ------------------------------------------------------ 1. the EPC profile */

check('heading: construction', phaseOfHeading('CONSTRUCTION & INSTALLATION') === 'construction');
check('heading: commissioning', phaseOfHeading('MECHANICAL COMPLETION & COMMISSIONING') === 'commissioning');
check('heading: procurement', phaseOfHeading('Procurement') === 'procurement');
check('heading: engineering', phaseOfHeading('Engineering') === 'engineering');
check('heading naming the whole contract is no phase', phaseOfHeading('Engineering, Procurement and Construction') === null);
check('rungs: PO row', rungsNamedBy('PO Material Solar', PROCUREMENT_STEPS).join() === 'po');
check('rungs: fab + RTS row', rungsNamedBy('Fabrication and RTS Material Solar', PROCUREMENT_STEPS).join() === 'fab,rts');
check('rungs: shipment row', rungsNamedBy('Shipment to Site Material Solar', PROCUREMENT_STEPS).join() === 'onsite');
check(
  'subject: the three Solar rows share one',
  ['PO Material Solar', 'Fabrication and RTS Material Solar', 'Shipment to Site Material Solar']
    .map((n) => subjectOf(n, PROCUREMENT_STEPS))
    .every((s) => s === 'material solar')
);
check(
  'subject: the consumable pair shares one',
  subjectOf('Fabrication and RTS Consumable Retrofit', PROCUREMENT_STEPS) === 'consumable retrofit' &&
    subjectOf('Shipment to Site Consumable Retrofit', PROCUREMENT_STEPS) === 'consumable retrofit'
);
{
  const got = mapByCode(suggestWaitsFor(profileRowsOf(buildItems())));
  const want = '2.2<-2.1 2.3<-2.2 2.5<-2.4 3.1<-2.3+2.5 3.2<-2.3+2.5 3.3<-2.3+2.5 4.1<-3.1+3.2+3.3';
  check('suggested links follow EPC order', got === want, got);
}

/* --------------------------------------------------------- 2. the engine */

const leaf = (id: string, order: number, s: string, f: string, extra: Partial<ForecastLeafInput> = {}): ForecastLeafInput => ({
  id, order, planStart: s, planFinish: f, pct: 0, rungs: [], qty: null, finishedAt: null, typed: null, waitsFor: [], ...extra,
});
{
  const B = leaf('B', 2, '2027-01-20', '2027-01-30', { waitsFor: [{ id: 'A', type: 'FS', wait: 0 }] });
  const inGap = forecastProject([leaf('A', 1, '2027-01-01', '2027-01-10', { typed: { date: '2027-01-15', source: 'vendor', rungId: null } }), B], '2026-12-31')!;
  check('a slip inside a planned gap moves nothing', inGap.leaves.get('B')!.finish === '2027-01-30' && inGap.leaves.get('B')!.push === 0, inGap.leaves.get('B')!.finish);
  check('a predecessor with float is not the path', inGap.chain.join() === 'B', inGap.chain.join());
  const past = forecastProject([leaf('A', 1, '2027-01-01', '2027-01-10', { typed: { date: '2027-01-25', source: 'vendor', rungId: null } }), B], '2026-12-31')!;
  check('a slip past the gap pushes by what is left of it', past.leaves.get('B')!.finish === '2027-02-05' && past.leaves.get('B')!.push === 6, past.leaves.get('B')!.finish);
  check('the pushing predecessor is on the path', past.chain.join() === 'A,B', past.chain.join());
  const overlap = forecastProject(
    [leaf('A', 1, '2027-01-01', '2027-01-31', { typed: { date: '2027-02-07', source: 'site', rungId: null } }), leaf('B', 2, '2027-01-20', '2027-02-10', { waitsFor: [{ id: 'A', type: 'FS', wait: 0 }] })],
    '2026-12-31'
  )!;
  check('a planned overlap keeps its offset', overlap.leaves.get('B')!.finish === '2027-02-17', overlap.leaves.get('B')!.finish);
}
{
  // After it starts + 3: A has not started and is pushed 10 days by P, so B moves too.
  const P = leaf('P', 0, '2026-12-01', '2026-12-31', { typed: { date: '2027-01-10', source: 'site', rungId: null } });
  const A = leaf('A', 1, '2027-01-01', '2027-01-20', { waitsFor: [{ id: 'P', type: 'FS', wait: 0 }] });
  const B = leaf('B', 2, '2027-01-04', '2027-01-30', { waitsFor: [{ id: 'A', type: 'SS', wait: 3 }] });
  const f = forecastProject([P, A, B], '2026-12-20')!;
  check('after it starts: a predecessor that starts late pushes the follower', f.leaves.get('B')!.push === 10, JSON.stringify(f.leaves.get('B')));
}
{
  // Finishes after it finishes + 2: A finishes 5 days late.
  const A = leaf('A', 1, '2027-01-01', '2027-01-20', { typed: { date: '2027-01-25', source: 'vendor', rungId: null } });
  const B = leaf('B', 2, '2027-01-05', '2027-01-22', { waitsFor: [{ id: 'A', type: 'FF', wait: 2 }] });
  const f = forecastProject([A, B], '2026-12-31')!;
  check('finishes after it finishes + wait: no earlier than A + wait', f.leaves.get('B')!.finish === '2027-01-27', f.leaves.get('B')!.finish);
}
{
  // After it finishes + 5: two days late against a five-day wait still pushes two days.
  const A = leaf('A', 1, '2027-01-01', '2027-01-10', { typed: { date: '2027-01-12', source: 'vendor', rungId: null } });
  const B = leaf('B', 2, '2027-01-16', '2027-01-25', { waitsFor: [{ id: 'A', type: 'FS', wait: 5 }] });
  const f = forecastProject([A, B], '2026-12-31')!;
  check('after it finishes + wait: the wait is not room', f.leaves.get('B')!.push === 2, String(f.leaves.get('B')!.push));
}
{
  const q = forecastProject([leaf('Q', 1, '2026-01-01', '2026-12-31', { pct: 40, qty: { total: 100, done: 40, firstMovedWeekEnd: '2026-06-07' } })], '2026-07-05')!;
  check('quantity rows finish at their measured rate', q.finish === '2026-08-27' && q.leaves.get('Q')!.basis === 'measured', q.finish);
  const l = forecastProject([leaf('L', 1, '2026-01-01', '2026-01-10', { pct: 50 })], '2026-01-05')!;
  check('an opinion row keeps its planned rate', l.finish === '2026-01-10' && l.leaves.get('L')!.basis === 'plan', l.finish);
  const rungs = [{ id: 'r1', weight: 50, done: true }, { id: 'r2', weight: 30, done: false }, { id: 'r3', weight: 20, done: false }];
  const t = forecastProject([leaf('M', 1, '2027-01-01', '2027-04-10', { pct: 50, rungs, typed: { date: '2027-03-01', source: 'vendor', rungId: 'r2' } })], '2027-01-15')!;
  check('a typed rung carries the rungs after it at their planned share', t.finish === '2027-03-21' && t.leaves.get('M')!.source === 'vendor', t.finish);
  const stale = forecastProject([leaf('M', 1, '2027-01-01', '2027-04-10', { pct: 50, rungs, typed: { date: '2027-03-01', source: 'vendor', rungId: 'r1' } })], '2027-01-15')!;
  check('a typed date on a rung already ticked is ignored', stale.leaves.get('M')!.basis === 'plan', stale.leaves.get('M')!.basis);
  const done = forecastProject([leaf('X', 1, '2026-01-01', '2026-06-30', { pct: 100, finishedAt: '2026-03-01' })], '2026-07-05')!;
  check('a finished activity finished when it did', done.finish === '2026-03-01' && done.leaves.get('X')!.basis === 'done');
  const loop = forecastProject([leaf('A', 1, '2027-01-01', '2027-01-10', { waitsFor: [{ id: 'B', type: 'FS', wait: 0 }] }), leaf('B', 2, '2027-01-11', '2027-01-20', { waitsFor: [{ id: 'A', type: 'FS', wait: 0 }] })], '2026-12-31');
  check('a loop in the links does not hang or throw', loop !== null && loop.leaves.size === 2);
  const late = forecastProject([leaf('S', 1, '2026-01-01', '2026-01-10')], '2026-02-01')!;
  check('a start that should have happened lands today', late.finish === '2026-02-11', late.finish);
  // The three cases of the 27 Sep 2026 brainstorm, status 17 Sep 26.
  const early = forecastProject([leaf('E', 1, '2027-02-09', '2027-03-02', { pct: 15 })], '2026-09-17')!;
  check('a rung ticked early does not pull the finish before the plan', early.finish === '2027-03-02' && early.leaves.get('E')!.basis === 'plan', early.finish);
  const ahead = forecastProject([leaf('W', 1, '2026-09-04', '2026-10-29', { pct: 65 })], '2026-09-17')!;
  check('ahead inside its window, still the plan without a date', ahead.finish === '2026-10-29', ahead.finish);
  const over = forecastProject([leaf('O', 1, '2026-07-31', '2026-09-17', { pct: 65 })], '2026-09-17')!;
  check('past its plan, the rest is counted from the status date', over.finish === '2026-10-04', over.finish);
}
check('week containing a date', weekContaining('2026-01-05', [{ week: 1, end: '2026-01-04' }, { week: 2, end: '2026-01-11' }]) === 2);
check('past the last week, counted on in whole weeks', weekContaining('2026-01-20', [{ week: 1, end: '2026-01-04' }, { week: 2, end: '2026-01-11' }]) === 4);

/* --------------------------------------------- 3. Earned Schedule, and why */

{
  const es = earnedSchedule([10, 20, 30, 40], 25, 2)!;
  check('earned schedule interpolates inside a week', Math.abs(es.es - 2.5) < 1e-9 && Math.abs(es.spiT - 1.25) < 1e-9 && Math.abs(es.finishWeek - 3.2) < 1e-9, JSON.stringify(es));
  check('nothing earned, no earned schedule', earnedSchedule([10, 20], 0, 2) === null);
  const d = disagreement(
    [{ id: 'a', name: 'A', share: 10 }, { id: 'b', name: 'B', share: 3 }, { id: 'c', name: 'C', share: -1 }],
    ['b'],
    12
  )!;
  check('the lead off the path is named', d.direction === 'lead' && d.items.map((i) => i.id).join() === 'a' && d.mostly, JSON.stringify(d));
  const lag = disagreement([{ id: 'a', name: 'A', share: -1 }, { id: 'b', name: 'B', share: -5 }], ['b'], -6)!;
  check('a lag mostly on the path is only partly off it', lag.direction === 'lag' && lag.items.map((i) => i.id).join() === 'a' && !lag.mostly, JSON.stringify(lag));
  check('everything on the path, nothing to explain', disagreement([{ id: 'b', name: 'B', share: 4 }], ['b'], 4) === null);
}

/* ------------------------------------- 4. Samberah at week 38, end to end */

{
  const db = buildFixture();
  const h = computeHealth(db, 38)!;
  check('fixture reproduces the deployed week 38', h.actualPct === 52.66 && h.planPct === 37.29, `${h.actualPct} / ${h.planPct}`);
  check('forecast is week 72, not 56', h.forecastFinishWeek === 72 && h.weeksAgainstContract === 0, String(h.forecastFinishWeek));
  check('with no links confirmed it is set by commissioning', h.forecast?.path.map((p) => p.wbsCode).join() === '4.1', h.forecast?.path.map((p) => p.wbsCode).join());
  const es = h.forecast?.earnedSchedule;
  check('Earned Schedule says week 65', !!es && es.es > 42.2 && es.es < 42.35 && Math.round(es.finishWeek) === 65, JSON.stringify(es));
  const why = h.forecast?.disagreement;
  check(
    'and the lead it rests on is off the path',
    why?.direction === 'lead' && why.mostly && why.items.map((i) => i.name).join('|') === 'Engineering by Solar|Fabrication and RTS Material Solar',
    JSON.stringify(why)
  );
  const sentence = narrativeParts(h, []).forecast;
  check('the sentence says week 72 and why ES differs', sentence.includes('week 72') && sentence.includes('Earned Schedule puts it at week 65') && !sentence.includes('—'), sentence);
  check('the card never goes blank at week 40', computeHealth(db, 40)?.forecastFinishWeek === 72, String(computeHealth(db, 40)?.forecastFinishWeek));
}
{
  const db = buildFixture();
  const links = suggestWaitsFor(profileRowsOf(db.wbsItems));
  for (const item of db.wbsItems) item.waitsFor = links.get(item.id);
  const read = forecastFromDb(db, 38)!;
  check('with the offered links confirmed, still week 72', read.finishWeek === 72 && read.forecast.finish === '2027-05-14', `${read.finishWeek} ${read.forecast.finish}`);
  check('and the path runs through the consumable retrofit', read.forecast.chain.map(codeOf).join() === '2.4,2.5,3.3,4.1', read.forecast.chain.map(codeOf).join());
  db.wbsItems.find((i) => i.id === nid('2.4'))!.forecast = { date: '2027-04-11', source: 'vendor', rungId: null, week: 38 };
  const late = forecastFromDb(db, 38)!;
  check('a vendor date 4 weeks late moves the finish to week 76', late.finishWeek === 76 && late.forecast.finish === '2027-06-11', `${late.finishWeek} ${late.forecast.finish}`);
  check('and says it is the vendor', late.forecast.leaves.get(nid('2.4'))!.basis === 'typed' && late.forecast.leaves.get(nid('2.4'))!.source === 'vendor');
  const before = forecastFromDb(db, 30)!;
  check('a week before the date was given does not read it', before.forecast.leaves.get(nid('2.4'))!.basis === 'plan', before.forecast.leaves.get(nid('2.4'))!.basis);

  // What Priority Actions is handed (28 Sep 2026): who slips, on evidence.
  const slips = computeHealth(db, 38)!.forecast!.slipping;
  const slipCodes = Object.keys(slips).map(codeOf).sort().join(' ');
  check('the late vendor date slips its own row and what waits for it', slips[nid('2.4')] >= 1 && slips[nid('4.1')] >= 1, JSON.stringify(Object.fromEntries(Object.entries(slips).map(([k, v]) => [codeOf(k), v]))));
  check('rows on plan dates alone never slip', !Object.keys(slips).some((id) => forecastFromDb(db, 38)!.forecast.leaves.get(id)!.basis === 'plan' && forecastFromDb(db, 38)!.forecast.leaves.get(id)!.push <= 0), slipCodes);
  check('the finish moves by what the last row slips', slips[nid('4.1')] === 76 - 72, String(slips[nid('4.1')]));
}
{
  // C6: "Material on site" ticked on a construction row whose delivery is not in.
  const db = buildFixture();
  const row = db.wbsItems.find((i) => i.id === nid('3.3'))!;
  row.progressMethod = 'milestone';
  row.milestones = ['material', 'install', 'connect', 'qc'].map((s, i) => ({ id: `${row.id}:${s}`, label: ['Material on site', 'Installation', 'Connections', 'QC inspection'][i], weight: [15, 50, 25, 10][i] }));
  const w38 = db.weeks.find((w) => w.week === 38)!;
  w38.leafData[row.id] = { ...w38.leafData[row.id], milestonesDone: [`${row.id}:material`] };
  const v = buildForecastView(db, 38)!;
  const said = v.toCheck.find((t) => t.leaf.id === row.id)?.reasons ?? [];
  check('C6: material ticked before the delivery is listed to check, with why', said.some((r) => r.startsWith('Material on site ticked, but 2.3') && r.endsWith('and 1 more')), JSON.stringify(said));
  w38.leafData[row.id] = { ...w38.leafData[row.id], milestonesDone: [] };
  check('C6: nothing ticked, nothing flagged', !(buildForecastView(db, 38)!.toCheck.find((t) => t.leaf.id === row.id)?.reasons ?? []).some((r) => r.startsWith('Material on site')));
}

/* ------------------------------------------ 5. what the app finds by itself */

{
  const db = buildFixture();
  const links = suggestWaitsFor(profileRowsOf(db.wbsItems));
  for (const item of db.wbsItems) item.waitsFor = links.get(item.id);
  const read = forecastFromDb(db, 38)!;
  const actualByWeek = Array.from({ length: 38 }, (_, i) => computeHealth(db, i + 1)!.actualPct);
  const found = forecastChecks({
    items: db.wbsItems,
    leafData: db.weeks[37].leafData,
    actualByWeek,
    chain: read.forecast.chain,
    leaves: read.forecast.leaves,
  });
  const of = (kind: string) => found.filter((c) => c.kind === kind);
  const kinds = of('kind-vs-heading').map((c) => (c.kind === 'kind-vs-heading' ? `${codeOf(c.leafId)}:${c.current ?? '-'}>${c.suggested}` : '')).join(' ');
  check(
    'C1: kinds that disagree with their heading',
    kinds === '2.2:->procurement 2.4:->procurement 2.5:->procurement 3.1:engineering>construction 3.3:engineering>construction 4.1:procurement>commissioning',
    kinds
  );
  const ladders = of('ladder-repeats').map((c) => (c.kind === 'ladder-repeats' ? `${codeOf(c.leafId)}:${c.keep.join('+')}` : '')).join(' ');
  check('C2: rows repeating a ladder their siblings split', ladders === '2.1:po 2.3:onsite', ladders);
  const typed = of('typed-vs-ladder').map((c) => (c.kind === 'typed-vs-ladder' ? `${codeOf(c.leafId)}:${c.typedPct}/${c.ladderPct}` : '')).join(' ');
  check('C3: a typed percent against its own ladder', typed === '2.1:99/75', typed);
  const bulk = of('bulk-entry').map((c) => (c.kind === 'bulk-entry' ? `W${c.week}` : '')).join(' ');
  check('C4: progress entered in bulk', bulk === 'W26 W36', bulk);
  const needs = of('needs-date').map((c) => (c.kind === 'needs-date' ? codeOf(c.leafId) : '')).join(' ');
  check('C5: the path still running on plan dates', needs === '2.4 2.5 3.3 4.1', needs);
}

/* ---------------------------------------- 6. what Data Overall is handed */

{
  const v = buildForecastView(buildFixture(), 38)!;
  const listed = v.toCheck.map((t) => t.leaf.code).join(' ');
  // Only what the panel can answer: C2 (2.1, 2.3) and C3 (2.1) are found but not listed.
  check('to check lists what somebody can answer', listed === '2.2 2.4 2.5 3.1 3.3 4.1', listed);
  const r41 = v.toCheck.find((t) => t.leaf.code === '4.1')?.reasons ?? [];
  check('4.1 carries both of its findings, a kind and a date', r41.length === 2, JSON.stringify(r41));
  const n24 = v.leaves[nid('2.4')].next;
  check('a typed-percent row is asked for its finish', n24?.rungId === null && n24?.label === 'Finish' && n24?.planDate === '2027-03-14', JSON.stringify(n24));
  check('a ladder row is asked for its next stage', v.leaves[nid('2.3')].next?.rungId === `${nid('2.3')}:po`, JSON.stringify(v.leaves[nid('2.3')].next));
  check('a finished row is asked nothing', v.leaves[nid('2.2')].next === null);
  const l33v = v.leaves[nid('3.3')];
  check('links are suggested, not applied', l33v.suggested.map((l) => l.code).join() === '2.3,2.5' && l33v.waitsFor.length === 0 && !l33v.answered, JSON.stringify(l33v.suggested));
  check('the path and the finish ride along', v.path.map((p) => p.code).join() === '4.1' && v.finishWeek === 72 && v.lastWeek === 72);
  check('bulk weeks ride along', v.bulkWeeks.join() === '26,36', v.bulkWeeks.join());
  check('it is plain data', JSON.parse(JSON.stringify(v)).leaves[nid('3.1')].reason.kind === v.leaves[nid('3.1')].reason.kind);
  check('nothing slips on plan dates alone', v.slipping.length === 0, JSON.stringify(v.slipping));

  // The one-card panel (27 Sep 2026); links are the planner's, per activity (28 Sep 2026).
  check('every scheduled activity is offered in the picker', v.options.length === Object.keys(v.leaves).length && v.options.length > 0, String(v.options.length));
  const l33 = v.leaves[nid('3.3')];
  check('an unstarted row on plan says it follows the plan', l33.reason.kind === 'plan' && l33.finishWeek === l33.planFinishWeek, JSON.stringify(l33.reason));
  check('the bars get the plan start', l33.planStartWeek <= l33.planFinishWeek && !!l33.planStart, `${l33.planStartWeek} ${l33.planStart}`);
  check('a finished row says so', v.leaves[nid('2.2')].reason.kind === 'done');
}
{
  // A row answered "nothing" is answered: its suggestion stays for the picker, but is no longer offered.
  const db = buildFixture();
  const offers = unansweredLinks(db.wbsItems);
  const [first] = [...offers.keys()];
  db.wbsItems.find((i) => i.id === first)!.waitsFor = [];
  const nothing = buildForecastView(db, 38)!.leaves[first];
  check('a row answered "nothing" reads as answered, with no links', nothing.answered && nothing.waitsFor.length === 0 && nothing.suggested.length > 0, JSON.stringify({ a: nothing.answered, s: nothing.suggested.length }));
  // The planner takes every suggestion, one activity at a time.
  for (const [id, ids] of offers) if (id !== first) db.wbsItems.find((i) => i.id === id)!.waitsFor = ids;
  // With the links in, a late shipment names itself on what waits for it.
  db.wbsItems.find((i) => i.id === nid('2.5'))!.forecast = { date: '2027-07-31', source: 'vendor', rungId: null, week: 38 };
  const v = buildForecastView(db, 38)!;
  const l33 = v.leaves[nid('3.3')];
  const w25 = l33.waitsFor.find((l) => l.code === '2.5');
  check('the late link carries its weeks', w25?.state === 'late' && w25.lateWeeks > 0 && l33.answered, JSON.stringify(l33.waitsFor));
  check('and what waits for it says it was pushed by it', l33.reason.kind === 'pushed' && l33.reason.by.code === '2.5' && l33.reason.weeks === l33.finishWeek - l33.planFinishWeek, JSON.stringify(l33.reason));
  // "Will slip" over the map names exactly the rows Priority Actions calls "Slips N wk".
  const health = computeHealth(db, 38)!.forecast!.slipping;
  const viewed = Object.fromEntries(v.slipping.map((s) => [s.leaf.id, s.weeks]));
  check('will slip names the same rows as the dashboard', JSON.stringify(viewed, Object.keys(viewed).sort()) === JSON.stringify(health, Object.keys(health).sort()) && v.slipping.length > 0, `${JSON.stringify(viewed)} vs ${JSON.stringify(health)}`);
  const s33 = v.slipping.find((s) => s.leaf.id === nid('3.3'));
  check('and its line recomputes: forecast less plan is the weeks late', !!s33 && s33.line === `Plan ends W${l33.planFinishWeek} · Forecast W${l33.finishWeek} · ${s33.weeks} ${s33.weeks === 1 ? 'week' : 'weeks'} late` && s33.weeks === l33.finishWeek - l33.planFinishWeek, s33?.line);
  check('most weeks first', v.slipping.every((s, i, a) => i === 0 || a[i - 1].weeks >= s.weeks), v.slipping.map((s) => s.weeks).join());
}

// ---- summary ----
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
