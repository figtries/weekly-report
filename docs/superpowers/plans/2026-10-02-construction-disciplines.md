# Construction by Discipline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construction rows choose one of nine EPC disciplines, each with its own ladder and "ticked when" definitions; the panel reads the plan back as a stage; a rung ticked before what its row waits for is listed in "to check".

**Architecture:** A pure taxonomy module (`lib/disciplines.ts`) beside `lib/work-kind.ts`; the discipline is NOT stored, it is read back from the row's own rung ids (`${nodeId}:${stepId}`), so `work_kind` stays `'construction'` and no reader of it changes. A pure `lib/stage-sentence.ts` makes the plan sentence. The picker, the rung list and the panel only render what those two modules say.

**Tech Stack:** Next.js (cacheComponents), React, framer-motion (`m`, `AnimatePresence`), lucide-react, better-sqlite3. Proof scripts run with `node --import ./scripts/ts-resolve.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-02-construction-disciplines-design.md`

## Global Constraints

- The typed percent stays: the 40px percent figure under every form is an input and the typed figure wins until a rung is touched (`ProgressEntry` `onManualOff`). Nothing in this plan removes or gates it. The user asked for this explicitly: the app helps, a person can always type their own percent.
- App copy is English, sentence case, no em dash (—) in any visible string.
- No new database column or table. `work_kind` keeps `'construction'`.
- Rows already filled in keep their figures: today's ladder (`material`/`install`/`connect`/`qc`) reads as Other.
- Data Overall shows no warning boxes in the panel; findings go to "to check".
- Do NOT push. Do not commit (the user reviews locally with `npm run build && npm run start` first).
- Never `next build` into `.next` while a dev server uses it: verify with `NEXT_DIST_DIR=.next-verify`.
- Verify UI with `scripts/shoot.mjs`, at 390px and desktop, by pressing, on a COPY of the database (`REPORT_DB_PATH`), never the live `data/report.db`.

---

### Task 1: The taxonomy

**Files:**
- Create: `lib/disciplines.ts`
- Modify: `lib/work-kind.ts` (construction `kindHints` only)
- Modify: `lib/work-kind-apply.ts:37-48` (`ladderFor` takes a discipline)
- Test: `scripts/verify-construction-disciplines.ts` (new)

**Interfaces:**
- Produces:
  - `interface Discipline extends WorkKind { short: string; needs: string; tickedWhen: Record<string, string>; firstWords: string[] }`
  - `CONSTRUCTION_DISCIPLINES: Discipline[]` (order = grid order: civil, steel, mechanical, piping, pipeline, ei, painting, testing, other)
  - `findDiscipline(id: string | null | undefined): Discipline | null`
  - `OTHER: Discipline`
  - `guessDiscipline(name: string, context?: string[]): Discipline` (never null, falls back to OTHER)
  - `disciplineOf(milestones: ReadonlyArray<{ id: string }> | undefined): Discipline | null`
  - `tickedWhenOf(milestoneId: string): string | null`
  - `ladderFor(kindId, shape, rowName, kinds, disciplineId?: string | null): Milestone[]`

- [ ] **Step 1: Write the failing proof**

`scripts/verify-construction-disciplines.ts`:

```ts
/**
 * Proves the construction disciplines (spec 2026-10-02): every ladder closes,
 * step ids never collide, the guesses a project control engineer would make,
 * today's ladder reading as Other, and the gate rule per discipline.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-construction-disciplines.ts
 */
import { CONSTRUCTION_DISCIPLINES, OTHER, disciplineOf, guessDiscipline, tickedWhenOf } from '../lib/disciplines.ts';
import { BUILT_IN_KINDS, guessWorkKind, shapeOf } from '../lib/work-kind.ts';
import { ladderFor } from '../lib/work-kind-apply.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

check('nine disciplines', CONSTRUCTION_DISCIPLINES.length === 9);
const allIds = CONSTRUCTION_DISCIPLINES.flatMap((d) => d.steps.map((s) => s.id));
check('step ids unique across disciplines', new Set(allIds).size === allIds.length);
for (const d of CONSTRUCTION_DISCIPLINES) {
  const total = d.steps.reduce((s, m) => s + m.weight, 0);
  check(`${d.short} closes at 100`, Math.abs(total - 100) < 1e-9, `got ${total}`);
  check(`${d.short} guards one of its own rungs`, d.steps.some((s) => s.id === d.needs));
  if (d.id !== 'other') check(`${d.short} says when every rung is ticked`, d.steps.every((s) => !!d.tickedWhen[s.id]));
}
const construction = BUILT_IN_KINDS.find((k) => k.id === 'construction')!;
check('Other is today\'s construction ladder', JSON.stringify(OTHER.steps) === JSON.stringify(construction.steps));

const guesses: Array<[string, string, string[]?]> = [
  ['Hydrotest Pipeline (4 Sections)', 'testing'],
  ['Painting Tank T-201', 'painting'],
  ['Painting Pipe Rack', 'painting'],
  ['Pipe Rack Erection', 'steel'],
  ['Piping Erection', 'piping'],
  ['Cable Tray & Cable Laying', 'ei'],
  ['Termination & Insulation Test', 'ei'],
  ['Field Joint Coating', 'pipeline'],
  ['Pondasi Kompresor', 'civil'],
  ['Tie-in Works', 'piping'],
  ['Separator & Vessel Installation', 'mechanical'],
  ['F&G Detector Installation', 'ei'],
  ['Pipe Rack Foundations', 'civil'],
  ['Mobilization and Demobilization', 'other'],
  ['Section 3', 'pipeline', ['Pipeline 6 inch', 'SPK-002 Pipeline and Flowline']],
];
for (const [name, want, ctx] of guesses) {
  const got = guessDiscipline(name, ctx).id;
  check(`"${name}" is ${want}`, got === want, `got ${got}`);
}

check('"Hydrotest" is guessed as Construction', guessWorkKind('Hydrotest', BUILT_IN_KINDS)?.kindId === 'construction');

const pipeline = CONSTRUCTION_DISCIPLINES.find((d) => d.id === 'pipeline')!;
check('"Welding" on the pipeline ladder is a gate', shapeOf('Welding', pipeline) === 'gate');
check('"Lowering & Backfilling" is a gate', shapeOf('Lowering & Backfilling', pipeline) === 'gate');
check('"Pipeline 6 inch KP 0 to KP 4" takes the ladder', shapeOf('Pipeline 6 inch KP 0 to KP 4', pipeline) === 'steps');

const testingLadder = ladderFor('construction', 'steps', 'Hydrotest', BUILT_IN_KINDS, 'testing');
check('ladderFor gives the discipline ladder', testingLadder.map((m) => m.id).join() === 'test-pack,test-fill,test-hold,test-drain');
check('ladderFor without a discipline is unchanged', ladderFor('construction', 'steps', 'X', BUILT_IN_KINDS).map((m) => m.id).join() === 'material,install,connect,qc');
check('ladderFor gate stays a gate', ladderFor('construction', 'gate', 'Welding', BUILT_IN_KINDS, 'pipeline').length === 1);

const stored = (ids: string[]) => ids.map((s) => ({ id: `node-1:${s}` }));
check('disciplineOf reads stored ids', disciplineOf(stored(['test-pack', 'test-fill', 'test-hold', 'test-drain']))?.id === 'testing');
check('today\'s ladder reads as Other', disciplineOf(stored(['material', 'install', 'connect', 'qc']))?.id === 'other');
check('a gate has no discipline', disciplineOf(stored(['done'])) === null);
check('engineering rungs have no discipline', disciplineOf(stored(['ifr', 'ifa', 'afc'])) === null);
check('tickedWhenOf reads a stored id', tickedWhenOf('node-1:test-pack') === 'Client signs the test pack');
check('tickedWhenOf is silent for Other', tickedWhenOf('node-1:material') === null);

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it, expect failure**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-construction-disciplines.ts`
Expected: fails to import `../lib/disciplines.ts`.

- [ ] **Step 3: Write `lib/disciplines.ts`**

Header comment says why (one ladder for every construction row was an interpretation, not a measurement; discipline read from rung ids so nothing stores it). Body:

```ts
import { stepIdOf } from './forecast-epc';
import { BUILT_IN_KINDS, normalizeName, type WorkKind } from './work-kind';

export interface Discipline extends WorkKind {
  /** The word on the tile and after "Construction ·". */
  short: string;
  /** The rung `ticked-early` guards (lib/forecast-checks.ts). */
  needs: string;
  /** What ticking each rung means, by step id. Empty for Other. */
  tickedWhen: Record<string, string>;
  /** Work words: when one is in the name it wins over any object word. */
  firstWords: string[];
}

const construction = BUILT_IN_KINDS.find((k) => k.id === 'construction')!;

function d(
  id: string, short: string, label: string, needs: string,
  rungs: Array<[string, string, number, string]>,
  kindHints: string[], stageHints: string[], firstWords: string[] = []
): Discipline {
  return {
    id, short, label, needs,
    steps: rungs.map(([sid, l, w]) => ({ id: sid, label: l, weight: w })),
    tickedWhen: Object.fromEntries(rungs.filter((r) => r[3]).map(([sid, , , t]) => [sid, t])),
    kindHints, stageHints, firstWords,
  };
}

export const OTHER: Discipline = {
  ...construction,
  id: 'other', short: 'Other', label: 'Other', needs: 'material',
  steps: construction.steps.map((s) => ({ ...s })),
  tickedWhen: {}, kindHints: [], firstWords: [],
};

export const CONSTRUCTION_DISCIPLINES: Discipline[] = [
  d('civil', 'Civil', 'Civil', 'civil-excavate', [
    ['civil-excavate', 'Excavated', 10, 'Dug to design level and checked'],
    ['civil-rebar', 'Rebar and formwork', 30, 'Rebar and formwork inspected, ready to pour'],
    ['civil-pour', 'Concrete poured', 40, 'Pour complete, cubes sampled'],
    ['civil-finish', 'Backfilled and finished', 20, 'Formwork stripped, backfilled, area clean'],
  ], ['civil', 'foundation', 'foundations', 'pondasi', 'fondasi', 'concrete', 'beton', 'piling', 'pile', 'tiang pancang',
      'drainage', 'drainase', 'sewer', 'road', 'jalan', 'paving', 'fence', 'pagar', 'earthwork', 'galian', 'urugan',
      'land clearing', 'bund wall', 'building', 'gedung', 'bangunan', 'warehouse', 'gudang', 'guard house', 'pos jaga',
      'tie beam', 'landscaping', 'parking'],
     ['excavation', 'galian', 'rebar', 'formwork', 'bekisting', 'concrete pouring', 'pengecoran', 'backfill'],
     // A foundation is civil work whatever sits on it: "Pondasi Kompresor", "Pipe Rack Foundations".
     ['foundation', 'foundations', 'pondasi', 'fondasi', 'excavation', 'galian', 'piling', 'concrete', 'beton']),
  d('steel', 'Steel', 'Steel structure', 'steel-erect', [
    ['steel-erect', 'Erected', 50, 'Members set and temporarily bolted'],
    ['steel-bolt', 'Bolted and aligned', 30, 'Final bolts torqued, plumb and level checked'],
    ['steel-touchup', 'Touched up and inspected', 20, 'Touch-up paint done, QC accepted'],
  ], ['steel', 'structure', 'structural', 'struktur', 'baja', 'pipe rack', 'piperack', 'shelter', 'canopy', 'platform',
      'stair', 'stairs', 'tangga', 'ladder', 'handrail'],
     ['erection', 'bolting', 'touch up']),
  d('mechanical', 'Mechanical', 'Mechanical equipment', 'mech-set', [
    ['mech-set', 'Set in place', 50, 'On its foundation, anchor bolts in'],
    ['mech-align', 'Aligned and grouted', 30, 'Levelled, aligned, grout cured'],
    ['mech-fit', 'Accessories fitted', 10, 'Ladders, platforms, internals fitted'],
    ['mech-boxup', 'Boxed up', 10, 'Internal inspection signed, manways closed'],
  ], ['equipment', 'vessel', 'tank', 'tangki', 'pump', 'pompa', 'compressor', 'kompresor', 'skid', 'separator', 'scrubber',
      'heater', 'exchanger', 'air cooler', 'generator', 'genset', 'turbine', 'teg', 'boiler', 'hvac'],
     ['setting', 'alignment', 'grouting', 'box up']),
  d('piping', 'Piping', 'Piping', 'piping-erect', [
    ['piping-erect', 'Spools erected', 40, 'Spools on supports in position'],
    ['piping-joint', 'Welded or bolted', 30, 'Field joints welded, flanges bolted'],
    ['piping-support', 'Supports complete', 15, 'Permanent supports, shoes, guides fitted'],
    ['piping-ndt', 'NDT and punch cleared', 15, 'NDT accepted, punch A cleared'],
  ], ['piping', 'pipe', 'pipa', 'spool', 'header', 'manifold', 'valve', 'hydrant', 'fire water', 'tie in', 'hot tap',
      'cut in', 'interkoneksi'],
     ['spool erection', 'bolt up', 'supports', 'punch']),
  d('pipeline', 'Pipeline', 'Pipeline', 'pipeline-string', [
    ['pipeline-string', 'Strung', 10, 'Right of way ready, pipe strung along it'],
    ['pipeline-weld', 'Welded', 30, 'Joints welded'],
    ['pipeline-coat', 'NDT and coated', 15, 'NDT accepted, field joints coated and holiday tested'],
    ['pipeline-lower', 'Lowered in', 25, 'Trenched, lowered in, padded'],
    ['pipeline-reinstate', 'Backfilled and reinstated', 20, 'Backfilled, markers set, right of way reinstated'],
  ], ['pipeline', 'flowline', 'flow line', 'trunkline', 'trunk line', 'jalur pipa', 'row', 'right of way', 'stringing',
      'trenching', 'lowering', 'crossing', 'boring', 'hdd', 'field joint coating', 'marker', 'cathodic', 'anode', 'cp'],
     ['stringing', 'welding', 'ndt', 'ndt radiography', 'radiography', 'field joint coating', 'trenching', 'lowering',
      'lowering in', 'lowering backfilling', 'backfilling', 'row clearing grading', 'row reinstatement']),
  d('ei', 'E&I', 'Electrical and instrument', 'ei-install', [
    ['ei-install', 'Installed', 30, 'Tray and conduit run, or instrument mounted'],
    ['ei-cable', 'Cabled or tubed', 35, 'Cables pulled and tagged, or impulse tubing run'],
    ['ei-term', 'Terminated', 20, 'Both ends glanded and terminated'],
    ['ei-test', 'Tested', 15, 'Megger, continuity or calibration recorded'],
  ], ['electrical', 'listrik', 'elektrikal', 'cable', 'kabel', 'tray', 'conduit', 'panel', 'mcc', 'switchgear',
      'transformer', 'trafo', 'lighting', 'penerangan', 'small power', 'earthing', 'grounding', 'instrument', 'instrumen',
      'instrumentation', 'transmitter', 'tubing', 'hook up', 'junction box', 'analyzer', 'f g', 'fire and gas',
      'detector', 'dcs', 'esd', 'plc', 'scada', 'telecom', 'cctv', 'termination', 'megger'],
     ['cable pulling', 'cable laying', 'termination', 'megger']),
  d('painting', 'Painting', 'Painting and insulation', 'paint-prep', [
    ['paint-prep', 'Surface prepared', 30, 'Blasted or cleaned, profile checked'],
    ['paint-prime', 'Primed', 30, 'Primer applied, thickness checked'],
    ['paint-finish', 'Finished', 40, 'Final coat or insulation done, inspected'],
  ], ['painting', 'paint', 'pengecatan', 'cat', 'coating', 'insulation', 'insulasi', 'blasting', 'fireproofing'],
     ['blasting', 'priming', 'primer'],
     ['painting', 'paint', 'pengecatan', 'blasting', 'fireproofing']),
  d('testing', 'Testing', 'Testing', 'test-fill', [
    ['test-pack', 'Test pack approved', 20, 'Client signs the test pack'],
    ['test-fill', 'Filled and pressurized', 30, 'Filled, test pressure reached'],
    ['test-hold', 'Held and witnessed', 30, 'Hold time passed, witnessed, report signed'],
    ['test-drain', 'Drained and reinstated', 20, 'Drained, dried, reinstated'],
  ], ['hydrotest', 'hydro test', 'hydrostatic', 'pressure test', 'leak test', 'pneumatic test', 'uji tekan', 'test pack',
      'pigging', 'pig run', 'caliper', 'gauging', 'dewatering', 'drying'],
     ['dewatering drying', 'dewatering', 'drying'],
     ['hydrotest', 'hydro test', 'hydrostatic', 'pressure test', 'leak test', 'pneumatic test', 'uji tekan', 'test pack']),
  OTHER,
];

export function findDiscipline(id: string | null | undefined): Discipline | null {
  return CONSTRUCTION_DISCIPLINES.find((x) => x.id === id) ?? null;
}

const has = (n: string, phrase: string) => ` ${n} `.includes(` ${phrase} `);

function bestIn(n: string, pick: (x: Discipline) => string[]): Discipline | null {
  let best: { d: Discipline; len: number } | null = null;
  for (const x of CONSTRUCTION_DISCIPLINES) {
    for (const w of pick(x)) if (has(n, w) && (!best || w.length > best.len)) best = { d: x, len: w.length };
  }
  return best?.d ?? null;
}

/**
 * The discipline the app offers, from the row's name and then its headings,
 * nearest first. Whole words only ("row" is a right of way, not "arrow"). A
 * WORK word (hydrotest, painting) beats an OBJECT word (pipeline, tank), so
 * "Hydrotest Pipeline" is Testing; otherwise the longest match wins.
 */
export function guessDiscipline(name: string, context: string[] = []): Discipline {
  for (const text of [name, ...context]) {
    const n = normalizeName(text);
    const hit = bestIn(n, (x) => x.firstWords) ?? bestIn(n, (x) => x.kindHints);
    if (hit) return hit;
  }
  return OTHER;
}

/** The discipline a row is on, read from its own rungs. Null for a gate or a ladder that is not a discipline's. */
export function disciplineOf(milestones: ReadonlyArray<{ id: string }> | undefined): Discipline | null {
  if (!milestones || milestones.length < 2) return null;
  const steps = milestones.map((m) => stepIdOf(m.id));
  return CONSTRUCTION_DISCIPLINES.find((x) => steps.every((s) => x.steps.some((st) => st.id === s))) ?? null;
}

/** "Ticked when" for one stored rung, or null when its discipline says nothing more than its label. */
export function tickedWhenOf(milestoneId: string): string | null {
  const s = stepIdOf(milestoneId);
  for (const x of CONSTRUCTION_DISCIPLINES) if (x.tickedWhen[s]) return x.tickedWhen[s];
  return null;
}
```

- [ ] **Step 4: Construction kind words** — in `lib/work-kind.ts` append WORK words only (object words like `instrument`, `cable`, `pump` also name engineering and procurement rows, so they stay discipline-level): `'hydrotest', 'hydro test', 'pressure test', 'leak test', 'painting', 'coating', 'excavation', 'foundation', 'pondasi', 'concrete', 'pengecoran', 'welding', 'stringing', 'lowering', 'backfill', 'trenching', 'piling', 'spool', 'termination', 'cable pulling', 'cable laying'`.

- [ ] **Step 5: `ladderFor` takes a discipline** — in `lib/work-kind-apply.ts`:

```ts
import { findDiscipline } from './disciplines';

export function ladderFor(
  kindId: string,
  shape: Shape,
  rowName: string,
  kinds: WorkKind[],
  disciplineId: string | null = null
): Milestone[] {
  if (shape === 'gate') return gateLadder(rowName);
  if (shape !== 'steps') return [];
  const discipline = kindId === 'construction' ? findDiscipline(disciplineId) : null;
  if (discipline) return discipline.steps.map((s) => ({ ...s }));
  const kind = kinds.find((k) => k.id === kindId);
  return kind ? kind.steps.map((s) => ({ ...s })) : [];
}
```

- [ ] **Step 6: Run the proof and the old ones**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-construction-disciplines.ts` → ALL PASS
Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind.ts` → ALL PASS
Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind-apply.ts` → ALL PASS
Fix hints (not the expectations) until they pass.

---

### Task 2: The plan, read as a stage

**Files:**
- Create: `lib/stage-sentence.ts`
- Test: append to `scripts/verify-construction-disciplines.ts`

**Interfaces:**
- Produces: `stageAt(steps: { weight: number }[], pct: number): number` (index of the rung being worked on; `steps.length` = finished) and `stageSentence(input: { steps: { label: string; weight: number }[]; actualPct: number; planPct: number; week: number }): string | null`

- [ ] **Step 1: Failing proof** (append before the final `console.log`):

```ts
import { stageSentence } from '../lib/stage-sentence.ts';
const T = [
  { label: 'Test pack approved', weight: 20 }, { label: 'Filled and pressurized', weight: 30 },
  { label: 'Held and witnessed', weight: 30 }, { label: 'Drained and reinstated', weight: 20 },
];
const s = (actualPct: number, planPct: number) => stageSentence({ steps: T, actualPct, planPct, week: 30 });
check('behind', s(50, 85) === 'Plan has it at Drained and reinstated by week 30. It is at Held and witnessed, one stage behind.', String(s(50, 85)));
check('ahead', s(85, 50) === 'Plan has it at Held and witnessed by week 30. It is already at Drained and reinstated, one stage ahead.', String(s(85, 50)));
check('same stage says nothing', s(55, 70) === null);
check('plan finished', s(50, 100) === 'Plan has it finished by week 30. It is at Held and witnessed, two stages behind.', String(s(50, 100)));
check('not started', s(0, 85) === 'Plan has it at Drained and reinstated by week 30. It has not started, three stages behind.', String(s(0, 85)));
check('plan not started, work ahead', s(25, 0) === 'Plan has not started it by week 30. It is already at Filled and pressurized, one stage ahead.', String(s(25, 0)));
check('finished ahead', s(100, 85) === 'Plan has it at Drained and reinstated by week 30. It is already finished, one stage ahead.', String(s(100, 85)));
check('one rung says nothing', stageSentence({ steps: [T[0]], actualPct: 0, planPct: 100, week: 30 }) === null);
```

- [ ] **Step 2: Run, expect import failure.**

- [ ] **Step 3: Write `lib/stage-sentence.ts`**

```ts
/**
 * The plan read as a STAGE (spec 2026-10-02 §5). "−35.0" says how far; this
 * says which rung is late, which is what a project control engineer reports.
 * Pure: the caller decides whether a plan figure may be shown at all.
 */
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function stageAt(steps: { weight: number }[], pct: number): number {
  const total = steps.reduce((s, m) => s + m.weight, 0) || 1;
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    acc += (steps[i].weight / total) * 100;
    if (acc > pct + 1e-9) return i;
  }
  return steps.length;
}

export function stageSentence(input: {
  steps: { label: string; weight: number }[];
  actualPct: number;
  planPct: number;
  week: number;
}): string | null {
  const { steps, actualPct, planPct, week } = input;
  if (steps.length < 2) return null;
  const a = stageAt(steps, actualPct);
  const p = stageAt(steps, planPct);
  if (a === p) return null;
  const k = Math.abs(p - a);
  const count = `${WORDS[k - 1] ?? k} ${k === 1 ? 'stage' : 'stages'}`;
  const plan =
    planPct <= 0.004
      ? `Plan has not started it by week ${week}.`
      : p === steps.length
        ? `Plan has it finished by week ${week}.`
        : `Plan has it at ${steps[p].label} by week ${week}.`;
  if (p > a) {
    return actualPct <= 0.004
      ? `${plan} It has not started, ${count} behind.`
      : `${plan} It is at ${steps[a].label}, ${count} behind.`;
  }
  return a === steps.length
    ? `${plan} It is already finished, ${count} ahead.`
    : `${plan} It is already at ${steps[a].label}, ${count} ahead.`;
}
```

- [ ] **Step 4: Run the proof** → ALL PASS.

---

### Task 3: Ticked before what it waits for

**Files:**
- Modify: `lib/forecast-checks.ts` (header comment C6, type union, C6 loop at 109-125)
- Modify: `lib/forecast-view.ts:232` (`'material-early'` → `'ticked-early'`)
- Test: append to `scripts/verify-construction-disciplines.ts`

**Interfaces:**
- Consumes: `disciplineOf` (Task 1)
- Produces: `ForecastCheck` member `{ kind: 'ticked-early'; leafId: string; rungLabel: string; waiting: { id: string; pct: number }[] }` (replaces `'material-early'`)

- [ ] **Step 1: Failing proof** (append):

```ts
import { forecastChecks } from '../lib/forecast-checks.ts';
import type { WbsItem, WeeklyLeafData } from '../lib/types.ts';
const item = (id: string, parentId: string | null, name: string, extra: Partial<WbsItem> = {}): WbsItem => ({
  id, parentId, wbsCode: id, deskripsi: name, bobot: parentId ? 10 : 0, vol: null, satuan: null, order: Number(id.replace(/\D/g, '')) || 0, ...extra,
});
const rungs = (node: string, ids: string[], w: number[]) => ids.map((s, i) => ({ id: `${node}:${s}`, label: s, weight: w[i] }));
const items: WbsItem[] = [
  item('h1', null, 'Construction'),
  item('n2', 'h1', 'Piping Area A', { workKind: 'construction', progressMethod: 'milestone',
    milestones: rungs('n2', ['piping-erect', 'piping-joint', 'piping-support', 'piping-ndt'], [40, 30, 15, 15]) }),
  item('n3', 'h1', 'Hydrotest Area A', { workKind: 'construction', progressMethod: 'milestone', waitsFor: ['n2'],
    milestones: rungs('n3', ['test-pack', 'test-fill', 'test-hold', 'test-drain'], [20, 30, 30, 20]) }),
];
const run = (pipingDone: string[]) => {
  const leafData: WeeklyLeafData = {
    n2: { cumProgressPct: 0, targetWF: 0, milestonesDone: pipingDone.map((s) => `n2:${s}`) },
    n3: { cumProgressPct: 0, targetWF: 0, milestonesDone: ['n3:test-pack', 'n3:test-fill'] },
  };
  return forecastChecks({ items, leafData, actualByWeek: [], chain: [], leaves: new Map() })
    .filter((c) => c.kind === 'ticked-early');
};
const early = run(['piping-erect']);
check('hydrotest filled while its piping is at 40% is listed', early.length === 1 && early[0].kind === 'ticked-early' && early[0].leafId === 'n3' && early[0].rungLabel === 'test-fill', JSON.stringify(early));
check('not listed once the piping is done', run(['piping-erect', 'piping-joint', 'piping-support', 'piping-ndt']).length === 0);
```

- [ ] **Step 2: Run, expect the first check to FAIL** (C6 only fires on a `material` rung waiting for procurement).

- [ ] **Step 3: Replace C6** in `lib/forecast-checks.ts`. Header line for C6 becomes: "C6 a construction rung ticked before the work its row waits for is done: the rung each discipline marks as needing it (lib/disciplines.ts), so a hydrotest filled before its piping is finished is found as well as material ticked before delivery". Union member renamed to `'ticked-early'`. Loop:

```ts
  // C6. The links a person confirmed, or EPC order's offer while nobody has
  // answered, so the check works before anyone has linked anything. Any row
  // it waits for counts, not only procurement: a test waits for what it tests.
  const offered = suggestWaitsFor(rows);
  for (const r of leafRows) {
    const item = itemById.get(r.id);
    if (!item || r.phase !== 'construction' || item.progressMethod !== 'milestone') continue;
    const discipline = disciplineOf(item.milestones);
    if (!discipline) continue;
    const guarded = (item.milestones ?? []).find((m) => stepIdOf(m.id) === discipline.needs);
    if (!guarded || !(leafData[r.id]?.milestonesDone ?? []).includes(guarded.id)) continue;
    const preds = item.waitsFor ?? offered.get(r.id) ?? [];
    const waiting = preds
      .flatMap((id) => {
        const p = itemById.get(id);
        return p ? [{ id, pct: resolveLeafProgress(p, leafData[id]) }] : [];
      })
      .filter((p) => p.pct < 100);
    if (waiting.length) out.push({ kind: 'ticked-early', leafId: r.id, rungLabel: guarded.label, waiting });
  }
```

Import `disciplineOf` from `./disciplines`. In `lib/forecast-view.ts` rename the branch's kind to `'ticked-early'`; its sentence is unchanged ("{rung} ticked, but {code} {name} is at {pct}%").

- [ ] **Step 4: Run the proof** → ALL PASS. Also `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts` if it runs on the local database (it reads Samberah figures; record its result either way).

---

### Task 4: The picker

**Files:**
- Create: `components/weekly/DisciplineIcon.tsx`
- Modify: `components/daily/Panel.tsx` (optional `innerClassName`, default unchanged)
- Modify: `components/weekly/WorkKindPicker.tsx`
- Modify: `components/weekly/OverallMap.tsx:237` (peers carry the discipline)
- Modify: `components/weekly/ActivityPanel.tsx:611-617` (context, current ladder) and `:362-363` (kind label)

**Interfaces:**
- Consumes: `CONSTRUCTION_DISCIPLINES`, `findDiscipline`, `guessDiscipline`, `disciplineOf`, `OTHER`, `ladderFor(..., disciplineId)` (Task 1); `stepIdOf` (`lib/forecast-epc`)
- Produces: `WorkKindPeer.disciplineId?: string | null`; `WorkKindPicker` props `context?: string[]`, `currentLadder?: string[]`; `DisciplineIcon({ id, className })`

- [ ] **Step 1: `DisciplineIcon.tsx`**

```tsx
import { BrickWall, Cog, Ellipsis, Frame, Gauge, PaintRoller, Route, Zap, type LucideIcon } from 'lucide-react';

/** Lucide has no pipe, so Piping's elbow is drawn on lucide's own grid and stroke. */
function PipeElbow({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5h7a9 9 0 0 1 9 9v6" />
      <path d="M4 11h7a3 3 0 0 1 3 3v6" />
      <path d="M4 3v10" />
      <path d="M12 20h10" />
    </svg>
  );
}

const ICONS: Record<string, LucideIcon> = {
  civil: BrickWall, steel: Frame, mechanical: Cog, pipeline: Route, ei: Zap, painting: PaintRoller, testing: Gauge, other: Ellipsis,
};

export default function DisciplineIcon({ id, className }: { id: string; className?: string }) {
  if (id === 'piping') return <PipeElbow className={className} />;
  const Icon = ICONS[id] ?? Ellipsis;
  return <Icon className={className} strokeWidth={2} aria-hidden="true" />;
}
```

- [ ] **Step 2: `Panel` takes the inner padding** — add `innerClassName = 'px-4 pb-4 pt-1 sm:pl-[50px] sm:pr-5'` to the props and use it on the inner `m.div`. Daily callers pass nothing and are unchanged.

- [ ] **Step 3: Peers** — `WorkKindPeer` gains `disciplineId?: string | null`; `OverallMap.tsx:237` pushes `disciplineId: n.workKind === 'construction' ? disciplineOf(n.milestones)?.id ?? null : null`.

- [ ] **Step 4: Picker state and save** in `WorkKindPicker.tsx`:
  - `Suggestion` gains `disciplineId: string | null` (peer's, else `guessDiscipline(node.name, context).id`, only when the kind is construction).
  - `sentenceFor`: construction reads "Looks like Construction, Testing." using the discipline's `short`.
  - Initial kind: `current ?? (suggestion?.kindId === 'construction' ? null : suggestion?.kindId ?? null)`. A construction guess is said in the sentence but does not select the tile, so the disciplines open only on a press. A row whose answer IS construction (Change) opens with them shown.
  - Initial discipline: `disciplineOf((currentLadder ?? []).map((id) => ({ id })))?.id` (`stepIdOf` leaves an id with no colon whole) ?? suggestion's ?? `guessDiscipline(node.name, context).id`.
  - `save()`:

```ts
function save() {
  if (!kindId) return;
  const kind = BUILT_IN_KINDS.find((k) => k.id === kindId);
  if (!kind) return;
  const discipline = kindId === 'construction' ? findDiscipline(disciplineId) ?? OTHER : null;
  const shapeSource = discipline ?? kind;
  const shape =
    suggestion && suggestion.kindId === kindId && (!discipline || suggestion.disciplineId === discipline.id)
      ? suggestion.shape
      : shapeOf(node.name, shapeSource);
  const ladder = ladderFor(kindId, shape, node.name, BUILT_IN_KINDS, discipline?.id ?? null);
  // Save on the same answer writes nothing: a pick rebuilds the ladder and would
  // overwrite one somebody adjusted. For Construction "the same answer" is the
  // same rungs, so moving a row from Other to Testing is a change.
  const sameLadder =
    !discipline || (currentLadder ?? []).join() === ladder.map((m) => m.id).join();
  if (current && kindId === current && sameLadder) {
    onCancel?.();
    return;
  }
  onPick(kindId, shape, ladder);
}
```

- [ ] **Step 5: Picker markup** — after the 2 × 2 grid, before Save:

```tsx
<Panel id="discipline-grid" open={kindId === 'construction'} innerClassName="pt-3">
  <div className="rounded-2xl border border-input bg-card p-3">
    <p className="text-[13px] text-foreground">Which part of construction?</p>
    <div className="mt-2 grid grid-cols-3 gap-1.5">
      {CONSTRUCTION_DISCIPLINES.map((d) => (
        <m.button
          key={d.id}
          {...pressMotion}
          type="button"
          onClick={() => setDisciplineId(d.id)}
          aria-pressed={d.id === disciplineId}
          className={cn(
            'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[12.5px] font-medium transition-colors duration-200 ease-ios',
            d.id === disciplineId
              ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
              : 'border-input bg-card text-foreground hover:bg-muted/50'
          )}
        >
          <DisciplineIcon id={d.id} className={cn('h-5 w-5', d.id === disciplineId ? 'text-chart-1' : 'text-muted-foreground')} />
          {d.short}
        </m.button>
      ))}
    </div>
    <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
      {chosen.steps.map((s) => s.label).join(' · ')}
    </p>
  </div>
</Panel>
```

(`chosen = findDiscipline(disciplineId) ?? OTHER`.) Save keeps `mt-3`.

- [ ] **Step 6: Panel wiring** in `ActivityPanel.tsx`:
  - `<WorkKindPicker … context={trail.map((n) => n.name).reverse()} currentLadder={answered ? (effectiveNode.milestones ?? []).map((m) => stepIdOf(m.id)) : undefined} />`
  - Kind label: `const discipline = effectiveNode.workKind === 'construction' ? disciplineOf(effectiveNode.milestones) : null;` then `kindLabel = discipline ? \`Construction · ${discipline.short}\` : (BUILT_IN_KINDS…label ?? SHAPE_LABEL[shape])`.

- [ ] **Step 7: Type-check** with the scratchpad tsconfig (see memory: verification quirks) → no new errors.

---

### Task 5: "Ticked when" under each rung, and the stage sentence

**Files:**
- Modify: `components/weekly/ProgressEntry.tsx:248` (MilestoneEntry rung label)
- Modify: `app/weekly/[week]/overall/page.tsx:295-306` (`figuresReady={gate.ok}`)
- Modify: `components/weekly/OverallMap.tsx` (prop through to `ActivityPanel` as `planReady`)
- Modify: `components/weekly/ActivityPanel.tsx` (prop; sentence after `<ProgressEntry />`)

**Interfaces:**
- Consumes: `tickedWhenOf`, `disciplineOf` (Task 1), `stageSentence` (Task 2)

- [ ] **Step 1: Rung definition** — replace the label span in `MilestoneEntry` with:

```tsx
<span className="min-w-0 flex-1 py-2">
  <span className="block">{step.label}</span>
  {tickedWhenOf(step.id) && (
    <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">{tickedWhenOf(step.id)}</span>
  )}
</span>
```

(The button keeps `min-h-12`; the `py-2` keeps two-line rungs off the border.)

- [ ] **Step 2: Gate plumbing** — page passes `figuresReady={gate.ok}`; `OverallMap` adds `figuresReady = false` to its props and passes `planReady={figuresReady}`; `ActivityPanel` and `PanelBody` add `planReady?: boolean` (default false) and hand it through.

- [ ] **Step 3: The sentence** — in `PanelBody`, after `<ProgressEntry … />` inside the answered branch:

```tsx
{planLine && <p className="mt-3 text-[13.5px] leading-relaxed text-foreground">{planLine}</p>}
```

with, above the return:

```ts
// The plan read as a stage (lib/stage-sentence.ts). Held by the weight gate
// like every plan figure, and never for a row weighing 0, whose planPct is 0
// by construction. Reads the figure ON SCREEN, so it follows a tick or a typed
// percent before Save.
const ladderDiscipline =
  effectiveNode.workKind === 'construction' && shape === 'steps' ? disciplineOf(effectiveNode.milestones) : null;
const planLine =
  planReady && ladderDiscipline && node.weight > 0
    ? stageSentence({ steps: effectiveNode.milestones ?? [], actualPct: pct, planPct: node.planPct, week })
    : null;
```

- [ ] **Step 3b: Check field names** — `node.weight`, `node.planPct`, `pct`, `week` exist in `PanelBody` (verified while planning: `node.weight` at line 286, `pct` at 430, `MapNode.planPct`). If `pct` is declared after the return's dependencies, move `planLine` below it.

- [ ] **Step 4: Type-check** → no new errors.

---

### Task 6: Prove it in a running app, then hand over

- [ ] **Step 1:** All proof scripts: `verify-construction-disciplines`, `verify-work-kind`, `verify-work-kind-apply` → ALL PASS.
- [ ] **Step 2:** `NEXT_DIST_DIR=.next-verify npx next build > <scratchpad>/build.log 2>&1; echo $?` → 0.
- [ ] **Step 3:** Fixture: copy `data/report.db` with `copyDbFixture` (scripts/db-fixture.ts) to `data/verify.db`; start `REPORT_DB_PATH=data/verify.db NEXT_DIST_DIR=.next-verify npx next start -p 3107` in the background.
- [ ] **Step 4:** On the demo project (pdemo-merbau) Data Overall, by pressing (CDP script in the scratchpad): open "Hydrotest Pipeline (4 Sections)", press Change, assert the discipline grid is NOT shown before Construction is pressed on a fresh row and IS shown on press, choose Testing, Save, assert the kind row reads "Construction · Testing", the rungs show their "ticked when" lines, tick two rungs and read the stage sentence, type a percent in the figure and assert it is kept (manual still works). Screenshots at 390 and 1440 with `scripts/shoot.mjs`, and look at them.
- [ ] **Step 5:** Stop the server, delete `data/verify.db*`, leave `data/report.db` and `data/db.json` untouched. No commit, no push. Tell the user: `npm run build` then `npm run start` (stop a running `npm run dev` on `.next` first).
