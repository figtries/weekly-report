# Forecast EPC engine (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 4-week-pace completion forecast with an activity-by-activity, schedule-driven forecast (EPC profile), with Earned Schedule as a second opinion and the data checks the app runs by itself.

**Architecture:** Four pure modules: `lib/forecast-epc.ts` (the only EPC-specific file), `lib/forecast.ts` (engine, Earned Schedule, disagreement), `lib/forecast-read.ts` (inputs from the in-memory `Database`), `lib/forecast-checks.ts` (C1–C5). `computeHealth` in `lib/analysis.ts` switches to them; the dashboard card keeps its layout, only its words are corrected. Storage, the write path and the new UI are Plan B, after the user picks rendered variants.

**Tech Stack:** TypeScript, Next.js 16 (cacheComponents), better-sqlite3 via drizzle, node 25 type-stripping for scripts (`node --import ./scripts/ts-resolve.mjs`).

**Spec:** `docs/superpowers/specs/2026-09-27-forecast-epc-design.md`

## Global Constraints

- Percentages come from `lib/progress.ts` only; the new modules never compute a leaf percentage.
- No figure invented: no numeric range, no date the data does not support; assumptions are labelled `basis: 'plan'`.
- Only CONFIRMED `waitsFor` links enter the forecast; EPC suggestions never do on their own.
- Visible copy in English, no em dash (—) in any visible string.
- Scripts import lib files with the `.ts` extension; lib files import each other without one; type-only imports use `import type`.
- Do not touch `/print/*` components; the printed forecast sentence changes only through `lib/analysis.ts`.
- Type-check with a scratchpad tsconfig (see Task 6), never the project one directly (other sessions' `.next*` types break it).
- `next build` output goes to a file and `$?` is echoed; never through a pipe.

---

### Task 1: EPC profile

**Files:**
- Create: `lib/forecast-epc.ts`
- Create: `scripts/verify-forecast.ts`

**Interfaces:**
- Produces:
  - `type Phase = 'engineering' | 'procurement' | 'construction' | 'commissioning'`
  - `const PROCUREMENT_STEPS: string[]` (`['po','fab','rts','onsite']`)
  - `stepIdOf(milestoneId: string): string`
  - `phaseOfHeading(name: string): Phase | null`
  - `rungsNamedBy(name: string, stepIds: string[]): string[]`
  - `subjectOf(name: string, stepIds: string[]): string`
  - `interface ProfileRow { id; parentId; name; order; isLeaf; isReportingUnit; phase: Phase | null; headingPhase: Phase | null; headingName: string | null }`
  - `profileRowsOf(items: WbsItem[]): ProfileRow[]`
  - `suggestWaitsFor(rows: ProfileRow[]): Map<string, string[]>`

- [ ] **Step 1: Write the failing test** — create `scripts/verify-forecast.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: error `Cannot find module ... lib/forecast-epc.ts`

- [ ] **Step 3: Write `lib/forecast-epc.ts`**

```ts
/**
 * The EPC profile: what an experienced EPC planner knows that the forecast
 * needs, and the ONLY file in the app that knows the work is EPC.
 *
 * The engine (`lib/forecast.ts`) and the checks (`lib/forecast-checks.ts`) ask
 * it three things: which phase a HEADING names, which rungs of a ladder a
 * row's NAME names, and what a row waits for by default. Another energy sector
 * answers the same three in a file of its own; the sector will be asked when a
 * project is created (27 Sep 2026, not built yet).
 *
 * Rung ids are the step ids of `BUILT_IN_KINDS` in `lib/work-kind.ts`. A stored
 * milestone id is `${nodeId}:${stepId}`, which is what `stepIdOf` reads.
 */
import { normalizeName } from './work-kind';
import type { WbsItem } from './types';

export type Phase = 'engineering' | 'procurement' | 'construction' | 'commissioning';

export const PROCUREMENT_STEPS = ['po', 'fab', 'rts', 'onsite'];

const PHASES = new Set<string>(['engineering', 'procurement', 'construction', 'commissioning']);

/**
 * Words that make a HEADING one phase. A heading naming two phases
 * ("Engineering, Procurement and Construction") is the contract, not a phase,
 * and names none. "Mechanical" is deliberately not a construction word:
 * "Mechanical Completion & Commissioning" is the commissioning phase.
 */
const HEADING_WORDS: Record<Phase, string[]> = {
  engineering: ['engineering', 'design'],
  procurement: ['procurement', 'purchasing', 'supply'],
  construction: ['construction', 'installation', 'erection', 'instalasi'],
  commissioning: ['commissioning', 'mechanical completion', 'start up', 'startup', 'handover'],
};

/** What each rung is called when a ROW is named after it. */
const RUNG_WORDS: Record<string, string[]> = {
  po: ['po', 'purchase order'],
  fab: ['fabrication', 'fab', 'manufacturing', 'manufacture'],
  rts: ['rts', 'ready to ship'],
  onsite: ['shipment', 'shipping', 'delivery', 'on site', 'arrival', 'mos'],
  ifr: ['ifr'],
  ifa: ['ifa'],
  afc: ['afc', 'ifc'],
  material: ['material on site'],
  install: ['installation', 'install', 'erection'],
  connect: ['connection', 'connections', 'tie in'],
  qc: ['qc', 'inspection'],
  precomm: ['pre commissioning', 'precommissioning'],
  function: ['function test', 'energize', 'energise'],
  startup: ['start up', 'startup'],
  running: ['running test', 'performance test'],
};

/** Words that say nothing about WHAT is being bought or built. */
const FILLER = new Set(['and', 'to', 'of', 'the', 'for', 'site', 'dan', 'ke']);

function hasPhrase(normalized: string, phrase: string): boolean {
  return ` ${normalized} `.includes(` ${phrase} `);
}

export function stepIdOf(milestoneId: string): string {
  const i = milestoneId.lastIndexOf(':');
  return i >= 0 ? milestoneId.slice(i + 1) : milestoneId;
}

export function phaseOfHeading(name: string): Phase | null {
  const n = normalizeName(name);
  const hits = (Object.keys(HEADING_WORDS) as Phase[]).filter((p) =>
    HEADING_WORDS[p].some((w) => hasPhrase(n, w))
  );
  return hits.length === 1 ? hits[0] : null;
}

/** The rungs, of those offered, that a row's name names. In ladder order. */
export function rungsNamedBy(name: string, stepIds: string[]): string[] {
  const n = normalizeName(name);
  return stepIds.filter((id) => (RUNG_WORDS[id] ?? []).some((w) => hasPhrase(n, w)));
}

/**
 * What a row is ABOUT once its rung words are taken out: "Shipment to Site
 * Material Solar" and "PO Material Solar" are both "material solar", which is
 * how the app knows they are one purchase split across rows.
 */
export function subjectOf(name: string, stepIds: string[]): string {
  const phrases = stepIds
    .flatMap((id) => RUNG_WORDS[id] ?? [])
    .map((p) => p.split(' '))
    .sort((a, b) => b.length - a.length);
  const words = normalizeName(name).split(' ');
  for (const p of phrases) {
    for (let i = 0; i + p.length <= words.length; ) {
      if (p.every((w, k) => words[i + k] === w)) words.splice(i, p.length);
      else i += 1;
    }
  }
  return words.filter((w) => w && !FILLER.has(w)).join(' ');
}

export interface ProfileRow {
  id: string;
  parentId: string | null;
  name: string;
  order: number;
  isLeaf: boolean;
  isReportingUnit: boolean;
  /** The nearest heading's phase, else the row's own kind. */
  phase: Phase | null;
  /** The nearest heading that names a phase, for the check against the kind. */
  headingPhase: Phase | null;
  headingName: string | null;
}

/**
 * The heading wins over the row's own kind. On PHSS Samberah the headings were
 * right and three kinds were wrong (Installation tagged Engineering,
 * Commissioning tagged Procurement), and the check in lib/forecast-checks.ts is
 * what tells the person so.
 */
export function profileRowsOf(items: WbsItem[]): ProfileRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const parents = new Set(items.map((i) => i.parentId).filter((p): p is string => !!p));
  return items.map((item) => {
    let heading: { name: string; phase: Phase } | null = null;
    for (
      let p = item.parentId ? byId.get(item.parentId) : undefined;
      p && !heading;
      p = p.parentId ? byId.get(p.parentId) : undefined
    ) {
      const phase = phaseOfHeading(p.deskripsi);
      if (phase) heading = { name: p.deskripsi, phase };
    }
    const own = item.workKind && PHASES.has(item.workKind) ? (item.workKind as Phase) : null;
    return {
      id: item.id,
      parentId: item.parentId,
      name: item.deskripsi,
      order: item.order,
      isLeaf: !parents.has(item.id),
      isReportingUnit: item.isReportingUnit === true,
      phase: heading?.phase ?? own,
      headingPhase: heading?.phase ?? null,
      headingName: heading?.name ?? null,
    };
  });
}

/**
 * What each activity waits for, by EPC order, OFFERED for a person to confirm.
 * Never applied in silence: lib/forecast.ts only reads confirmed links.
 *
 * - construction waits for the procurement rows that bring material ON SITE
 * - commissioning waits for construction
 * - a procurement row holding later rungs waits for the sibling holding the
 *   nearest earlier rungs of the SAME subject (Shipment waits for Fab & RTS)
 *
 * All within one reporting unit when the row sits in one, else the project.
 */
export function suggestWaitsFor(rows: ProfileRow[]): Map<string, string[]> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const unitOf = (r: ProfileRow): string | null => {
    for (let p = r.parentId ? byId.get(r.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
      if (p.isReportingUnit) return p.id;
    }
    return null;
  };
  const leaves = rows.filter((r) => r.isLeaf).sort((a, b) => a.order - b.order);
  const rungIndexes = (r: ProfileRow) =>
    rungsNamedBy(r.name, PROCUREMENT_STEPS).map((s) => PROCUREMENT_STEPS.indexOf(s));

  const out = new Map<string, string[]>();
  for (const b of leaves) {
    const scope = unitOf(b);
    const near = leaves.filter((a) => a.id !== b.id && unitOf(a) === scope);
    let preds: string[] = [];
    if (b.phase === 'construction') {
      preds = near
        .filter((a) => a.phase === 'procurement' && rungsNamedBy(a.name, PROCUREMENT_STEPS).includes('onsite'))
        .map((a) => a.id);
    } else if (b.phase === 'commissioning') {
      preds = near.filter((a) => a.phase === 'construction').map((a) => a.id);
    } else if (b.phase === 'procurement') {
      const mine = rungIndexes(b);
      if (mine.length) {
        const first = Math.min(...mine);
        const subject = subjectOf(b.name, PROCUREMENT_STEPS);
        let best: { id: string; last: number } | null = null;
        for (const a of near) {
          if (a.parentId !== b.parentId || a.phase !== 'procurement') continue;
          if (subjectOf(a.name, PROCUREMENT_STEPS) !== subject) continue;
          const theirs = rungIndexes(a);
          if (!theirs.length) continue;
          const last = Math.max(...theirs);
          if (last < first && (!best || last > best.last)) best = { id: a.id, last };
        }
        if (best) preds = [best.id];
      }
    }
    if (preds.length) out.set(b.id, preds);
  }
  return out;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: 11 PASS lines, `all passed`

- [ ] **Step 5: Commit**

```bash
git add lib/forecast-epc.ts scripts/verify-forecast.ts
git commit -m "The EPC profile: phases from headings, rungs from row names, links offered by EPC order"
```

---

### Task 2: The engine

**Files:**
- Create: `lib/forecast.ts`
- Modify: `scripts/verify-forecast.ts` (imports at the top; block above `// ---- summary ----`)

**Interfaces:**
- Produces:
  - `type ForecastSource = 'vendor' | 'site' | 'client'`
  - `type StepBasis = 'done' | 'typed' | 'measured' | 'plan'`
  - `interface ForecastRung { id: string; weight: number; done: boolean }`
  - `interface ForecastLeafInput { id; order; planStart; planFinish; pct; rungs: ForecastRung[]; qty: {total; done; firstMovedWeekEnd: string | null} | null; finishedAt: string | null; typed: {date; source: ForecastSource; rungId: string | null} | null; waitsFor: string[] }`
  - `interface LeafForecast { id; finish: string; push: number; drivenBy: string | null; basis: StepBasis; source: ForecastSource | null }`
  - `interface ProjectForecast { statusDate; finish; finishLeafId; chain: string[]; leaves: Map<string, LeafForecast> }`
  - `dayOf(iso): number`, `isoOf(day): string`
  - `forecastProject(inputs: ForecastLeafInput[], statusDate: string): ProjectForecast | null`
  - `weekContaining(iso: string, weekEnds: { week: number; end: string }[]): number`

- [ ] **Step 1: Write the failing test** — add to the imports at the top of `scripts/verify-forecast.ts`:

```ts
import { forecastProject, weekContaining, type ForecastLeafInput } from '../lib/forecast.ts';
```

and insert above `// ---- summary ----`:

```ts
/* --------------------------------------------------------- 2. the engine */

const leaf = (id: string, order: number, s: string, f: string, extra: Partial<ForecastLeafInput> = {}): ForecastLeafInput => ({
  id, order, planStart: s, planFinish: f, pct: 0, rungs: [], qty: null, finishedAt: null, typed: null, waitsFor: [], ...extra,
});
{
  const B = leaf('B', 2, '2027-01-20', '2027-01-30', { waitsFor: ['A'] });
  const inGap = forecastProject([leaf('A', 1, '2027-01-01', '2027-01-10', { typed: { date: '2027-01-15', source: 'vendor', rungId: null } }), B], '2026-12-31')!;
  check('a slip inside a planned gap moves nothing', inGap.leaves.get('B')!.finish === '2027-01-30' && inGap.leaves.get('B')!.push === 0, inGap.leaves.get('B')!.finish);
  check('a predecessor with float is not the path', inGap.chain.join() === 'B', inGap.chain.join());
  const past = forecastProject([leaf('A', 1, '2027-01-01', '2027-01-10', { typed: { date: '2027-01-25', source: 'vendor', rungId: null } }), B], '2026-12-31')!;
  check('a slip past the gap pushes by what is left of it', past.leaves.get('B')!.finish === '2027-02-05' && past.leaves.get('B')!.push === 6, past.leaves.get('B')!.finish);
  check('the pushing predecessor is on the path', past.chain.join() === 'A,B', past.chain.join());
  const overlap = forecastProject(
    [leaf('A', 1, '2027-01-01', '2027-01-31', { typed: { date: '2027-02-07', source: 'site', rungId: null } }), leaf('B', 2, '2027-01-20', '2027-02-10', { waitsFor: ['A'] })],
    '2026-12-31'
  )!;
  check('a planned overlap keeps its offset', overlap.leaves.get('B')!.finish === '2027-02-17', overlap.leaves.get('B')!.finish);
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
  const loop = forecastProject([leaf('A', 1, '2027-01-01', '2027-01-10', { waitsFor: ['B'] }), leaf('B', 2, '2027-01-11', '2027-01-20', { waitsFor: ['A'] })], '2026-12-31');
  check('a loop in the links does not hang or throw', loop !== null && loop.leaves.size === 2);
  const late = forecastProject([leaf('S', 1, '2026-01-01', '2026-01-10')], '2026-02-01')!;
  check('a start that should have happened lands today', late.finish === '2026-02-11', late.finish);
}
check('week containing a date', weekContaining('2026-01-05', [{ week: 1, end: '2026-01-04' }, { week: 2, end: '2026-01-11' }]) === 2);
check('past the last week, counted on in whole weeks', weekContaining('2026-01-20', [{ week: 1, end: '2026-01-04' }, { week: 2, end: '2026-01-11' }]) === 4);
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: error `Cannot find module ... lib/forecast.ts`

- [ ] **Step 3: Write `lib/forecast.ts`**

```ts
/**
 * When the project finishes, worked out the way an EPC planner works it out.
 *
 * NOT from the pace of the total. The forecast this replaces divided what was
 * left by the last four weeks' average, and on PHSS Samberah at week 38 it read
 * "week 56, 16 weeks earlier" (27 Sep 2026): the pace was one bulk entry
 * divided by four, and it vanished two weeks later when the window slid past
 * it. The total is weighted by MONEY, too, so 70 points of procurement said
 * nothing about the 2-point commissioning that actually ends the job.
 *
 * So every unfinished activity gets its own finish, counted from the status
 * date; a late predecessor pushes what waits for it; the project finishes when
 * the last one does, and the path that decides it is named. Spec:
 * docs/superpowers/specs/2026-09-27-forecast-epc-design.md.
 *
 * Pure: no database, no React. Percentages arrive already resolved by
 * lib/progress.ts; nothing here computes one.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Within this many days a predecessor still DRIVES what waits for it, so the
 * path runs through it. The weekend-plus-a-day of `MAX_GAP` in lib/chains.ts.
 */
const DRIVING_SLACK_DAYS = 3;

export type ForecastSource = 'vendor' | 'site' | 'client';

/** Where an activity's finish came from. The card counts these along the path. */
export type StepBasis = 'done' | 'typed' | 'measured' | 'plan';

export interface ForecastRung {
  id: string;
  weight: number;
  done: boolean;
}

export interface ForecastLeafInput {
  id: string;
  order: number;
  /** The active baseline's dates, ISO. */
  planStart: string;
  planFinish: string;
  /** 0..100, from lib/progress.ts. */
  pct: number;
  /** The ladder in order, milestone rows only. */
  rungs: ForecastRung[];
  /** Quantity rows only. */
  qty: { total: number; done: number; firstMovedWeekEnd: string | null } | null;
  /** The end of the first week it stood at 100, when it does. */
  finishedAt: string | null;
  /** A date somebody outside the app gave, for one rung or (rungId null) the finish. */
  typed: { date: string; source: ForecastSource; rungId: string | null } | null;
  /** Confirmed links only. */
  waitsFor: string[];
}

export interface LeafForecast {
  id: string;
  /** ISO date. */
  finish: string;
  /** Days its predecessors moved it; 0 or less when nothing did. */
  push: number;
  /** The predecessor holding it, when one is within the driving slack. */
  drivenBy: string | null;
  basis: StepBasis;
  source: ForecastSource | null;
}

export interface ProjectForecast {
  statusDate: string;
  finish: string;
  finishLeafId: string;
  /** The path that sets the finish, first activity to last. */
  chain: string[];
  leaves: Map<string, LeafForecast>;
}

export function dayOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function isoOf(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Share of the ladder's weight still to come after a rung, 0..1. */
function shareAfter(rungs: ForecastRung[], rungId: string | null): number {
  if (rungId === null) return 0;
  const total = rungs.reduce((s, r) => s + r.weight, 0);
  const at = rungs.findIndex((r) => r.id === rungId);
  if (total <= 0 || at < 0) return 0;
  return rungs.slice(at + 1).reduce((s, r) => s + r.weight, 0) / total;
}

/**
 * Quantity per day since the first week anything moved. Averaged over the
 * whole run on purpose: a bulk entry after weeks of silence is still the same
 * quantity over the same weeks. One week is not a rate.
 */
function qtyRatePerDay(qty: NonNullable<ForecastLeafInput['qty']>, statusDay: number): number | null {
  if (!qty.firstMovedWeekEnd || qty.done <= 0 || qty.total <= qty.done) return null;
  const weeks = Math.floor((statusDay - dayOf(qty.firstMovedWeekEnd)) / 7) + 1;
  if (weeks < 2) return null;
  return qty.done / (weeks * 7);
}

export function forecastProject(inputs: ForecastLeafInput[], statusDate: string): ProjectForecast | null {
  if (!inputs.length) return null;
  const byId = new Map(inputs.map((l) => [l.id, l]));
  const D = dayOf(statusDate);
  type Computed = LeafForecast & { day: number };
  const out = new Map<string, Computed>();
  const visiting = new Set<string>();

  const visit = (id: string): Computed | null => {
    const known = out.get(id);
    if (known) return known;
    const leaf = byId.get(id);
    // An unknown id, or a link that closes a loop: that link is ignored.
    if (!leaf || visiting.has(id)) return null;
    visiting.add(id);

    const PS = dayOf(leaf.planStart);
    const PF = dayOf(leaf.planFinish);
    const duration = Math.max(1, PF - PS + 1);

    // How far a predecessor's finish runs past what this activity allowed for:
    // its own planned finish where the two overlap (the offset is kept), the
    // day before this one starts where there is a gap (the gap is float).
    let push = 0;
    let drivenBy: string | null = null;
    let nearest = -Infinity;
    for (const pid of leaf.waitsFor) {
      const pred = visit(pid);
      if (!pred) continue;
      const value = pred.day - Math.max(dayOf(byId.get(pid)!.planFinish), PS - 1);
      push = Math.max(push, value);
      if (value > nearest) {
        nearest = value;
        drivenBy = value >= -DRIVING_SLACK_DAYS ? pid : null;
      }
    }

    const typedRung = leaf.typed?.rungId ? leaf.rungs.find((r) => r.id === leaf.typed!.rungId) : undefined;
    let day: number;
    let basis: StepBasis;
    let source: ForecastSource | null = null;
    if (leaf.pct >= 100) {
      day = leaf.finishedAt ? Math.min(dayOf(leaf.finishedAt), D) : D;
      basis = 'done';
      drivenBy = null;
    } else if (leaf.typed && !typedRung?.done) {
      day = dayOf(leaf.typed.date) + Math.round(shareAfter(leaf.rungs, leaf.typed.rungId) * duration);
      basis = 'typed';
      source = leaf.typed.source;
      drivenBy = null;
    } else if (leaf.pct <= 0) {
      day = Math.max(PS + push, D + 1) + duration - 1;
      basis = 'plan';
    } else {
      const rate = leaf.qty ? qtyRatePerDay(leaf.qty, D) : null;
      if (rate !== null && leaf.qty) {
        day = D + Math.ceil((leaf.qty.total - leaf.qty.done) / rate);
        basis = 'measured';
      } else {
        day = D + Math.round((1 - leaf.pct / 100) * duration);
        basis = 'plan';
      }
      if (push > 0) day = Math.max(day, PF + push);
    }

    visiting.delete(id);
    const result: Computed = { id, finish: isoOf(day), day, push, drivenBy, basis, source };
    out.set(id, result);
    return result;
  };

  for (const l of inputs) visit(l.id);

  // The latest finish; a tie goes to the later row in the plan, which is where
  // an EPC plan puts commissioning and handover.
  let last: Computed | null = null;
  for (const l of [...inputs].sort((a, b) => a.order - b.order)) {
    const f = out.get(l.id)!;
    if (!last || f.day >= last.day) last = f;
  }
  if (!last) return null;

  const chain: string[] = [];
  for (
    let cur: Computed | undefined = last;
    cur && !chain.includes(cur.id);
    cur = cur.drivenBy ? out.get(cur.drivenBy) : undefined
  ) {
    chain.unshift(cur.id);
  }
  return { statusDate, finish: last.finish, finishLeafId: last.id, chain, leaves: out };
}

/**
 * The week a date falls in: the first week whose end is not before it (the
 * rule lib/dashboard-db.ts places a finish by). Past the last week the count
 * goes on in whole weeks, because a forecast late finish has no week row yet.
 */
export function weekContaining(iso: string, weekEnds: { week: number; end: string }[]): number {
  for (const w of weekEnds) if (w.end >= iso) return w.week;
  const last = weekEnds[weekEnds.length - 1];
  return last.week + Math.ceil((dayOf(iso) - dayOf(last.end)) / 7);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: all PASS, `all passed`

- [ ] **Step 5: Commit**

```bash
git add lib/forecast.ts scripts/verify-forecast.ts
git commit -m "The forecast engine: each activity from the status date, late predecessors push, the path is named"
```

---

### Task 3: Earned Schedule and why it disagrees

**Files:**
- Modify: `lib/forecast.ts` (append)
- Modify: `scripts/verify-forecast.ts`

**Interfaces:**
- Produces:
  - `interface EarnedSchedule { es: number; spiT: number; finishWeek: number }`
  - `earnedSchedule(planPct: number[], actualPct: number, week: number): EarnedSchedule | null` (`planPct[i]` = cumulative plan % at the end of week i + 1)
  - `interface ShareItem { id: string; name: string; share: number }`
  - `interface Disagreement { direction: 'lead' | 'lag'; items: ShareItem[]; mostly: boolean }`
  - `disagreement(shares: ShareItem[], chain: string[], deviationPct: number): Disagreement | null`

- [ ] **Step 1: Write the failing test** — extend the forecast import at the top:

```ts
import { disagreement, earnedSchedule, forecastProject, weekContaining, type ForecastLeafInput } from '../lib/forecast.ts';
```

and insert above `// ---- summary ----`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: `SyntaxError ... does not provide an export named 'disagreement'`

- [ ] **Step 3: Append to `lib/forecast.ts`**

```ts
export interface EarnedSchedule {
  /** The week, fractional, at which the plan stood where the actual stands now. */
  es: number;
  /** es / week. Above 1 is ahead. */
  spiT: number;
  /** The contract length divided by spiT: where this performance lands the finish. */
  finishWeek: number;
}

/**
 * Earned Schedule (Lipke), the top-down second opinion. It reads the S-curve's
 * SHAPE, which the old pace forecast did not, but it still assumes the lead or
 * lag carries on into every phase, which is why it is never the forecast.
 * `planPct[i]` is the cumulative plan at the end of week i + 1.
 */
export function earnedSchedule(planPct: number[], actualPct: number, week: number): EarnedSchedule | null {
  if (week <= 0 || actualPct <= 0 || !planPct.length) return null;
  const lastWeek = planPct.length;
  let es = lastWeek;
  for (let i = 0; i < planPct.length; i++) {
    if (planPct[i] >= actualPct) {
      const before = i === 0 ? 0 : planPct[i - 1];
      const step = planPct[i] - before;
      es = i + (step > 0 ? (actualPct - before) / step : 1);
      break;
    }
  }
  if (es <= 0) return null;
  const spiT = es / week;
  return { es, spiT, finishWeek: lastWeek / spiT };
}

export interface ShareItem {
  id: string;
  name: string;
  /** This activity's part of the deviation, in project points (apportioned). */
  share: number;
}

export interface Disagreement {
  direction: 'lead' | 'lag';
  /** The two biggest parts of the deviation that are NOT on the path. */
  items: ShareItem[];
  /** Whether the off-path part is at least half the deviation. */
  mostly: boolean;
}

/**
 * Why Earned Schedule and the schedule disagree: the deviation sits in
 * activities that do not decide the finish. On PHSS Samberah the 15-point lead
 * is Engineering by Solar and the Solar fabrication, and the finish waits on
 * the consumable retrofit and commissioning. Null when nothing off the path
 * explains it.
 */
export function disagreement(shares: ShareItem[], chain: string[], deviationPct: number): Disagreement | null {
  if (Math.abs(deviationPct) < 0.005) return null;
  const ahead = deviationPct > 0;
  const onPath = new Set(chain);
  const off = shares
    .filter((s) => !onPath.has(s.id) && (ahead ? s.share > 0 : s.share < 0))
    .sort((a, b) => Math.abs(b.share) - Math.abs(a.share));
  if (!off.length) return null;
  const offSum = off.reduce((s, x) => s + Math.abs(x.share), 0);
  return {
    direction: ahead ? 'lead' : 'lag',
    items: off.slice(0, 2),
    mostly: offSum >= Math.abs(deviationPct) / 2,
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add lib/forecast.ts scripts/verify-forecast.ts
git commit -m "Earned Schedule as the forecast's second opinion, and the reason when it disagrees"
```

---

### Task 4: The dashboard, Summary and print read the new forecast

**Files:**
- Modify: `lib/types.ts` (`WbsItem`, `LeafSnapshot`, `ScheduleItem`)
- Modify: `lib/dashboard-db.ts:305-310` (schedule carries the dates)
- Create: `lib/forecast-read.ts`
- Modify: `lib/analysis.ts` (`ProjectHealth`, `computeHealth`, `forecastSentence`, imports)
- Modify: `scripts/verify-forecast.ts`

**Interfaces:**
- Consumes: `forecastProject`, `weekContaining`, `earnedSchedule`, `disagreement` (Tasks 2–3); `suggestWaitsFor`, `profileRowsOf` (Task 1)
- Produces:
  - `WbsItem.waitsFor?: string[]`
  - `LeafSnapshot.forecast?: { date: string; source: 'vendor' | 'site' | 'client'; rungId: string | null }`
  - `ScheduleItem.startDate?: string; ScheduleItem.finishDate?: string`
  - `forecastFromDb(db: Database, week: number): { forecast: ProjectForecast; finishWeek: number } | null` in `lib/forecast-read.ts`
  - `ProjectHealth.forecast: ForecastSummary | null` where `ForecastSummary = { finishDate: string; path: { id; wbsCode; name; basis: StepBasis }[]; earnedSchedule: EarnedSchedule | null; disagreement: Disagreement | null }`

- [ ] **Step 1: Write the failing test** — add to the imports at the top:

```ts
import { computeHealth, narrativeParts } from '../lib/analysis.ts';
import { forecastFromDb } from '../lib/forecast-read.ts';
```

and insert above `// ---- summary ----`:

```ts
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
  db.weeks[37].leafData[nid('2.4')].forecast = { date: '2027-04-11', source: 'vendor', rungId: null };
  const late = forecastFromDb(db, 38)!;
  check('a vendor date 4 weeks late moves the finish to week 76', late.finishWeek === 76 && late.forecast.finish === '2027-06-11', `${late.finishWeek} ${late.forecast.finish}`);
  check('and says it is the vendor', late.forecast.leaves.get(nid('2.4'))!.basis === 'typed' && late.forecast.leaves.get(nid('2.4'))!.source === 'vendor');
}
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: error `Cannot find module ... lib/forecast-read.ts`

- [ ] **Step 3: Extend the types** in `lib/types.ts`.

In `interface WbsItem`, after the `isMilestone?: boolean;` member:

```ts
  /**
   * Activities this one waits for, CONFIRMED by a person. The forecast pushes it
   * when one of them runs late (lib/forecast.ts). Links the EPC profile offers
   * never land here on their own.
   */
  waitsFor?: string[];
```

In `interface LeafSnapshot`, after `source?: ...;`:

```ts
  /**
   * When the next rung (or, rungId null, the finish) will happen according to
   * someone outside the app: a vendor's promised date, the site, the client's
   * shutdown or review. Read by lib/forecast.ts, where it beats the plan.
   */
  forecast?: { date: string; source: 'vendor' | 'site' | 'client'; rungId: string | null };
```

In `interface ScheduleItem`, after `pattern: DistributionPattern;`:

```ts
  /** The active baseline's own dates, for the forecast, which works in days. */
  startDate?: string;
  finishDate?: string;
```

- [ ] **Step 4: Carry the dates** in `lib/dashboard-db.ts`, the `schedule.push({...})` inside the loop after `// Start and finish as week numbers`:

```ts
    schedule.push({
      leafId: node.id,
      startWeek: weekOf(d.startDate, 1),
      finishWeek: weekOf(d.finishDate, lastWeekNo),
      pattern: 'linear',
      startDate: d.startDate,
      finishDate: d.finishDate,
    });
```

- [ ] **Step 5: Write `lib/forecast-read.ts`**

```ts
/**
 * The forecast's inputs, read off the same `Database` every other figure reads,
 * so the forecast cannot disagree with the report about what is done: each
 * percentage through lib/progress.ts, each date from the active baseline via
 * `schedule` (lib/dashboard-db.ts carries the ISO dates since 27 Sep 2026).
 */
import { forecastProject, weekContaining, type ForecastLeafInput, type ProjectForecast } from './forecast';
import { resolveLeafProgress, totalQty } from './progress';
import type { Database } from './types';

export interface ForecastRead {
  forecast: ProjectForecast;
  finishWeek: number;
}

export function forecastFromDb(db: Database, week: number): ForecastRead | null {
  const weeks = [...db.weeks].sort((a, b) => a.week - b.week);
  const meta = weeks.find((w) => w.week === week);
  if (!meta) return null;
  const parents = new Set(db.wbsItems.map((i) => i.parentId).filter((p): p is string => !!p));
  const dates = new Map((db.schedule ?? []).map((s) => [s.leafId, s]));
  const upTo = weeks.filter((w) => w.week <= week);

  const inputs: ForecastLeafInput[] = [];
  for (const item of db.wbsItems) {
    if (parents.has(item.id)) continue;
    const s = dates.get(item.id);
    if (!s?.startDate || !s.finishDate) continue;
    const snap = meta.leafData[item.id];
    const pct = resolveLeafProgress(item, snap);
    let finishedAt: string | null = null;
    let firstMoved: string | null = null;
    for (const w of upTo) {
      const sn = w.leafData[item.id];
      if (finishedAt === null && resolveLeafProgress(item, sn) >= 100) finishedAt = w.periodEnd;
      if (firstMoved === null && (sn?.qtyDone ?? 0) > 0) firstMoved = w.periodEnd;
    }
    const done = new Set(snap?.milestonesDone ?? []);
    inputs.push({
      id: item.id,
      order: item.order,
      planStart: s.startDate,
      planFinish: s.finishDate,
      pct,
      rungs:
        item.progressMethod === 'milestone'
          ? (item.milestones ?? []).map((m) => ({ id: m.id, weight: m.weight, done: done.has(m.id) }))
          : [],
      qty:
        item.progressMethod === 'qty'
          ? { total: totalQty(item), done: snap?.qtyDone ?? 0, firstMovedWeekEnd: firstMoved }
          : null,
      finishedAt: pct >= 100 ? finishedAt : null,
      typed: snap?.forecast ?? null,
      waitsFor: item.waitsFor ?? [],
    });
  }

  const forecast = forecastProject(inputs, meta.periodEnd);
  if (!forecast) return null;
  const weekEnds = weeks.map((w) => ({ week: w.week, end: w.periodEnd }));
  return { forecast, finishWeek: weekContaining(forecast.finish, weekEnds) };
}
```

- [ ] **Step 6: Switch `computeHealth`** in `lib/analysis.ts`.

Add imports under the existing `import { weightGate } from './weight-gate';`:

```ts
import {
  disagreement,
  earnedSchedule,
  type Disagreement,
  type EarnedSchedule,
  type StepBasis,
} from './forecast';
import { forecastFromDb } from './forecast-read';
```

Change `import { weekOfDate } from './weeks';` to:

```ts
import { formatDateLong, weekOfDate } from './weeks';
```

In `interface ProjectHealth`, replace:

```ts
  /** null when velocity is zero or negative — no honest forecast exists. */
  forecastFinishWeek: number | null;
  /** Positive = finishing early. */
  weeksAgainstContract: number | null;
}
```

with:

```ts
  /**
   * The week the last activity finishes, from the schedule activity by activity
   * (lib/forecast.ts). Null only when there is no schedule to forecast from.
   */
  forecastFinishWeek: number | null;
  /** Positive = finishing early. */
  weeksAgainstContract: number | null;
  /** What stands behind the forecast week. Null when there is none. */
  forecast: ForecastSummary | null;
}

export interface ForecastSummary {
  /** ISO date the last activity finishes. */
  finishDate: string;
  /** The activities that set it, first to last. */
  path: { id: string; wbsCode: string; name: string; basis: StepBasis }[];
  /** The top-down second opinion. */
  earnedSchedule: EarnedSchedule | null;
  /** Why the two disagree, when they are two weeks or more apart. */
  disagreement: Disagreement | null;
}
```

In `computeHealth`, replace:

```ts
  let forecastFinishWeek: number | null = null;
  if (velocityPerWeek > 0.01 && actualPct < 100) {
    forecastFinishWeek = week + (100 - actualPct) / velocityPerWeek;
  } else if (actualPct >= 100) {
    forecastFinishWeek = week;
  }
```

with:

```ts
  // THE SCHEDULE'S FORECAST, activity by activity (27 Sep 2026). The pace above
  // stays a figure people read; it no longer decides a date, because on PHSS
  // Samberah at week 38 it was one bulk entry divided by four and read "week 56,
  // 16 weeks earlier" for a job whose commissioning is planned for week 72.
  let forecastFinishWeek: number | null = null;
  let forecast: ForecastSummary | null = null;
  if (actualPct >= 100) {
    forecastFinishWeek = week;
  } else {
    const read = forecastFromDb(db, week);
    if (read) {
      forecastFinishWeek = read.finishWeek;
      const plan = [...db.weeks]
        .sort((a, b) => a.week - b.week)
        .map((w) => totalAt(w.week)?.planPct ?? 0);
      const es = earnedSchedule(plan, actualPct, week);
      const roots = promoteNestedSpkContracts(
        computeRollup(db.wbsItems, meta.leafData, weekMap.get(week - 1)?.leafData ?? null)
      );
      const shares = contributions(roots, deviationPct).map((c) => ({
        id: c.id,
        name: c.deskripsi,
        share: c.share,
      }));
      const byId = new Map(db.wbsItems.map((i) => [i.id, i]));
      forecast = {
        finishDate: read.forecast.finish,
        path: read.forecast.chain.map((id) => ({
          id,
          wbsCode: byId.get(id)?.wbsCode ?? '',
          name: byId.get(id)?.deskripsi ?? '',
          basis: read.forecast.leaves.get(id)?.basis ?? 'plan',
        })),
        earnedSchedule: es,
        disagreement:
          es && Math.abs(es.finishWeek - read.finishWeek) >= 2
            ? disagreement(shares, read.forecast.chain, deviationPct)
            : null,
      };
    }
  }
```

In the returned object, after `weeksAgainstContract: ...,` add:

```ts
    forecast,
```

In `interface NarrativeParts`, change the comment `/** Where the current pace lands it. */` to `/** Where the schedule lands it, and what that rests on. */`.

Replace the whole `function forecastSentence(health: ProjectHealth): string { ... }` with:

```ts
function forecastSentence(health: ProjectHealth): string {
  const f = health.forecast;
  if (health.forecastFinishWeek === null || health.weeksAgainstContract === null) {
    return 'There is no schedule to forecast a completion date from yet.';
  }
  const gap = Math.round(health.weeksAgainstContract);
  const against =
    gap === 0
      ? 'on the contract end'
      : `${Math.abs(gap)} weeks ${gap > 0 ? 'before' : 'after'} the contract end`;
  const date = f ? ` (${formatDateLong(new Date(`${f.finishDate}T00:00:00Z`))})` : '';
  const parts = [
    `Working through the schedule activity by activity, completion lands in week ${Math.round(
      health.forecastFinishWeek
    )}${date}, ${against}.`,
  ];
  if (!f || !f.path.length) return parts[0];
  parts.push(
    f.path.length === 1
      ? ` It is set by ${f.path[0].name}.`
      : ` The path that sets it: ${f.path.map((p) => p.name).join(' → ')}.`
  );
  const assumed = f.path.filter((p) => p.basis === 'plan').length;
  if (assumed > 0) {
    parts.push(
      ` ${assumed} of ${f.path.length} on that path ${assumed === 1 ? 'follows' : 'follow'} the plan dates; no vendor, site or client date has been given for ${assumed === 1 ? 'it' : 'them'}.`
    );
  }
  if (f.earnedSchedule && f.disagreement) {
    const items = f.disagreement.items.map((i) => `${i.name} (${fmtNum(Math.abs(i.share), 2)} points)`);
    parts.push(
      ` Earned Schedule puts it at week ${Math.round(f.earnedSchedule.finishWeek)}, because the ${fmtNum(
        Math.abs(health.deviationPct),
        2
      )} point ${f.disagreement.direction} sits ${f.disagreement.mostly ? 'mostly' : 'partly'} in ${items.join(
        ' and '
      )}, which ${items.length > 1 ? 'are' : 'is'} not on that path.`
    );
  }
  return parts.join('');
}
```

- [ ] **Step 7: Run it to see it pass**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: all PASS. If `fixture reproduces the deployed week 38` fails, stop: the fixture is wrong, not the engine.

- [ ] **Step 8: Run the neighbouring proofs, which read `computeHealth` too**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-dashboard-figures.ts` and `node --import ./scripts/ts-resolve.mjs scripts/verify-priority-actions.ts`
Expected: both end with no FAIL line.

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts lib/dashboard-db.ts lib/forecast-read.ts lib/analysis.ts scripts/verify-forecast.ts
git commit -m "The forecast is the schedule's, activity by activity, with Earned Schedule beside it"
```

---

### Task 5: The checks the app runs by itself

**Files:**
- Create: `lib/forecast-checks.ts`
- Modify: `scripts/verify-forecast.ts`

**Interfaces:**
- Consumes: `profileRowsOf`, `rungsNamedBy`, `subjectOf`, `stepIdOf`, `Phase` (Task 1); `LeafForecast` (Task 2)
- Produces:
  - `type ForecastCheck = { kind: 'kind-vs-heading'; leafId; current: string | null; suggested: Phase; heading: string } | { kind: 'ladder-repeats'; leafId; keep: string[]; siblings: string[] } | { kind: 'typed-vs-ladder'; leafId; typedPct: number; ladderPct: number } | { kind: 'bulk-entry'; week: number; addedPct: number; quietWeeks: number } | { kind: 'needs-date'; leafId: string }`
  - `forecastChecks(input: { items: WbsItem[]; leafData: WeeklyLeafData; actualByWeek: number[]; chain: string[]; leaves: Map<string, LeafForecast> }): ForecastCheck[]` (`actualByWeek[i]` = cumulative actual % at the end of week i + 1, up to the viewed week)

- [ ] **Step 1: Write the failing test** — add to the imports at the top:

```ts
import { forecastChecks } from '../lib/forecast-checks.ts';
```

and insert above `// ---- summary ----`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: error `Cannot find module ... lib/forecast-checks.ts`

- [ ] **Step 3: Write `lib/forecast-checks.ts`**

```ts
/**
 * What the app finds in a project's data by itself, so nobody has to read the
 * data by hand to see it (27 Sep 2026). Every one of these was first found on
 * PHSS Samberah by pulling the deployment apart; this module is that reading,
 * run on every project.
 *
 *   C1 a work kind that disagrees with the WBS heading above it, or is empty
 *   C2 a row carrying a whole ladder its siblings have already split between
 *      them (PO / Fab & RTS / Shipment each holding PO, Fab, RTS and On site)
 *   C3 a typed percent that is not what its own ticked ladder says
 *   C4 progress entered in bulk after weeks of nothing
 *   C5 activities on the path that sets the finish with no outside date
 *
 * Data only. What they say on screen is Plan B's.
 */
import { milestoneProgress } from './progress';
import { profileRowsOf, rungsNamedBy, stepIdOf, subjectOf, type Phase } from './forecast-epc';
import { BUILT_IN_KINDS } from './work-kind';
import type { LeafForecast } from './forecast';
import type { WbsItem, WeeklyLeafData } from './types';

export type ForecastCheck =
  | { kind: 'kind-vs-heading'; leafId: string; current: string | null; suggested: Phase; heading: string }
  | { kind: 'ladder-repeats'; leafId: string; keep: string[]; siblings: string[] }
  | { kind: 'typed-vs-ladder'; leafId: string; typedPct: number; ladderPct: number }
  | { kind: 'bulk-entry'; week: number; addedPct: number; quietWeeks: number }
  | { kind: 'needs-date'; leafId: string };

/** A week this big after this many silent ones reads as catching up, not as work. */
const BULK_POINTS = 5;
const BULK_QUIET_WEEKS = 3;

export function forecastChecks(input: {
  items: WbsItem[];
  leafData: WeeklyLeafData;
  actualByWeek: number[];
  chain: string[];
  leaves: Map<string, LeafForecast>;
}): ForecastCheck[] {
  const { items, leafData, actualByWeek, chain, leaves } = input;
  const out: ForecastCheck[] = [];
  const rows = profileRowsOf(items);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const leafRows = rows.filter((r) => r.isLeaf).sort((a, b) => a.order - b.order);

  // C1
  for (const r of leafRows) {
    if (!r.headingPhase || !r.headingName) continue;
    const current = itemById.get(r.id)?.workKind ?? null;
    if (current !== r.headingPhase) {
      out.push({ kind: 'kind-vs-heading', leafId: r.id, current, suggested: r.headingPhase, heading: r.headingName });
    }
  }

  // C2
  for (const r of leafRows) {
    const item = itemById.get(r.id);
    const kind = BUILT_IN_KINDS.find((k) => k.id === r.phase);
    if (!item || !kind || (item.milestones?.length ?? 0) < 2) continue;
    const stepIds = kind.steps.map((s) => s.id);
    const named = rungsNamedBy(r.name, stepIds);
    if (!named.length) continue;
    const subject = subjectOf(r.name, stepIds);
    const siblings = leafRows.filter(
      (s) =>
        s.id !== r.id &&
        s.parentId === r.parentId &&
        s.phase === r.phase &&
        subjectOf(s.name, stepIds) === subject &&
        rungsNamedBy(s.name, stepIds).length > 0
    );
    const covered = new Set(siblings.flatMap((s) => rungsNamedBy(s.name, stepIds)));
    const carried = (item.milestones ?? []).map((m) => stepIdOf(m.id));
    if (carried.some((id) => !named.includes(id) && covered.has(id))) {
      out.push({ kind: 'ladder-repeats', leafId: r.id, keep: named, siblings: siblings.map((s) => s.id) });
    }
  }

  // C3
  for (const r of leafRows) {
    const item = itemById.get(r.id);
    const snap = leafData[r.id];
    if (!item || !snap || snap.source !== 'manual' || item.progressMethod !== 'milestone') continue;
    if (!item.milestones?.length) continue;
    const ladderPct = milestoneProgress(item.milestones, snap.milestonesDone ?? []);
    if (Math.abs(snap.cumProgressPct - ladderPct) >= 0.5) {
      out.push({ kind: 'typed-vs-ladder', leafId: r.id, typedPct: snap.cumProgressPct, ladderPct });
    }
  }

  // C4
  let quiet = 0;
  for (let i = 0; i < actualByWeek.length; i++) {
    const added = actualByWeek[i] - (i === 0 ? 0 : actualByWeek[i - 1]);
    if (added >= BULK_POINTS && quiet >= BULK_QUIET_WEEKS) {
      out.push({ kind: 'bulk-entry', week: i + 1, addedPct: Math.round(added * 100) / 100, quietWeeks: quiet });
    }
    quiet = Math.abs(added) < 0.005 ? quiet + 1 : 0;
  }

  // C5
  for (const id of chain) {
    if (leaves.get(id)?.basis === 'plan') out.push({ kind: 'needs-date', leafId: id });
  }

  return out;
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`
Expected: all PASS, `all passed`

- [ ] **Step 5: Commit**

```bash
git add lib/forecast-checks.ts scripts/verify-forecast.ts
git commit -m "The checks the forecast needs, run by the app on every project"
```

---

### Task 6: The card's words, the build, the deployment

**Files:**
- Modify: `app/page.tsx` (the Forecast card, ~lines 589-640)

**Interfaces:**
- Consumes: `ProjectHealth.forecastFinishWeek`, `weeksAgainstContract` (unchanged meaning)

- [ ] **Step 1: Correct the card's words** in `app/page.tsx`.

Replace `When this finishes at the current pace` with `When the last activity finishes, from the schedule`.

Replace `<p className="text-sm text-muted-foreground">Not enough to forecast yet.</p>` with `<p className="text-sm text-muted-foreground">No schedule to forecast from yet.</p>`.

Replace the badge's text:

```tsx
                      {Math.abs(Math.round(health.weeksAgainstContract))} weeks{' '}
                      {health.weeksAgainstContract >= 0 ? 'earlier' : 'later'}
```

with:

```tsx
                      {Math.round(health.weeksAgainstContract) === 0
                        ? 'On the contract end'
                        : `${Math.abs(Math.round(health.weeksAgainstContract))} weeks ${
                            health.weeksAgainstContract > 0 ? 'earlier' : 'later'
                          }`}
```

- [ ] **Step 2: Type-check** with a scratchpad tsconfig. Write `<scratchpad>/tsconfig.check.json`:

```json
{
  "extends": "E:/Figtries/Prototype/Report/tsconfig.json",
  "include": [
    "E:/Figtries/Prototype/Report/next-env.d.ts",
    "E:/Figtries/Prototype/Report/app/**/*.ts",
    "E:/Figtries/Prototype/Report/app/**/*.tsx",
    "E:/Figtries/Prototype/Report/components/**/*.ts",
    "E:/Figtries/Prototype/Report/components/**/*.tsx",
    "E:/Figtries/Prototype/Report/lib/**/*.ts"
  ]
}
```

Run: `npx tsc --noEmit -p <scratchpad>/tsconfig.check.json`
Expected: no errors in `lib/forecast*.ts`, `lib/analysis.ts`, `lib/types.ts`, `lib/dashboard-db.ts`, `app/page.tsx`.

- [ ] **Step 3: Build**

Run: `npx next build > <scratchpad>/build.log 2>&1; echo $?`
Expected: `0`

- [ ] **Step 4: Commit and push**

```bash
git add app/page.tsx
git commit -m "The Forecast card says what it now is: the schedule, not the pace"
git push
```

- [ ] **Step 5: Check the deployment** (a build takes ~3 minutes). Read the deployed dashboard for the open project and confirm the card reads Week 72 and "On the contract end", and `/weekly/38/summary` carries the new sentence:

Run: `curl -s -b "figtries_open_project=pmty5z1jp3c86" https://report-chi-six.vercel.app/weekly/38/summary -o <scratchpad>/summary38.html` and search the text for `completion lands in week 72` and `Earned Schedule puts it at week 65`.
Then screenshot the dashboard at desktop and 390px with `node scripts/shoot.mjs` and look at both.
