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
import { leafPlanFraction } from '../lib/plan-curve.ts';
import {
  PROCUREMENT_STEPS,
  phaseOfHeading,
  profileRowsOf,
  rungsNamedBy,
  subjectOf,
  suggestWaitsFor,
} from '../lib/forecast-epc.ts';
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

// ---- summary ----
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
