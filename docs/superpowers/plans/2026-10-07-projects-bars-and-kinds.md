# Projects: bars and kinds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The planner's bars show the plan's own facts (stages, done, forecast, contract, slack) through a simple Bars menu, the kind of work is set while planning (heading or row), and Data Overall only reads it.

**Architecture:** A pure `lib/bar-view.ts` (colours, defaults, segments) replaces the rule engine in `lib/bar-styles.ts`. A server builder `lib/bar-facts.ts` reads done %, rungs and forecast from the SAME `Database` Data Overall reads, and travels to the planner as its own prop. Kind writes go through `setWorkKindSqlite` (unchanged), with one new heading-apply path. Bars settings live in one JSON column `projects.bar_view`.

**Tech Stack:** Next.js (cacheComponents, React Compiler), better-sqlite3 + drizzle, framer-motion, Tailwind/shadcn tokens.

**Spec:** `docs/superpowers/specs/2026-10-07-projects-bars-and-kinds-design.md`

## Global Constraints

- App copy is English, no em dash in any visible string, capital-first labels.
- Colours only from existing tokens: `--plan-1`…`--plan-6`, `--foreground`, `--muted-foreground`. Red (`--bad`/`--destructive`) and amber (`--warn`) are never offered as bar colours.
- Touch targets ≥ 44px (`min-h-11`), 10px rounded rects, no hover-only information.
- Refs never read during render (React Compiler); overlays lazy through `next/dynamic` with their own `<Suspense>`, warmed when idle.
- No searchParams on `/projects/[id]`; deep link is a hash.
- Every figure comes from `lib/progress.ts` / the forecast; the planner computes nothing of its own.
- New column: migration + `EXPECTED_COLUMNS` + `REPORT_DB_PATH=data/seed.db npm run db:migrate` + `wal_checkpoint(TRUNCATE)`. Copy `data/report.db` first and count child rows after.
- Never commit `data/db.json` (demo Merbau). Never push without asking.
- Verify scripts run as `node --import ./scripts/ts-resolve.mjs scripts/<name>.ts`.

---

### Task 1: `lib/bar-view.ts`, the pure bar model

**Files:**
- Create: `lib/bar-view.ts`
- Create: `scripts/verify-bar-view.ts`

**Interfaces:**
- Produces:
  - `type ColourBy = 'kind' | 'package' | 'one'`
  - `type MarkKey = 'done' | 'forecast' | 'contract' | 'slip'`
  - `interface BarView { colourBy: ColourBy; marks: Record<MarkKey, boolean>; colours: { kind: Record<string, BarPaint>; package: Record<string, BarPaint>; one: BarPaint } }`
  - `DEFAULT_BAR_VIEW: BarView`, `PALETTE: { key: BarPaint; label: string }[]` (8), `KIND_KEYS`, `DEFAULT_KIND_PAINT`
  - `parseBarView(json: string | null): BarView`
  - `packagePaint(colorGroup: number): BarPaint`
  - `canColourByPackage(rows: { colorGroup: number }[]): boolean`
  - `effectiveColourBy(view: BarView, rows: { colorGroup: number }[]): ColourBy`
  - `paintOf(row: { colorGroup: number; unitId: string | null }, kindId: string | null, view: BarView, colourBy: ColourBy): BarPaint`
  - `paintCss(p: BarPaint): string`
  - `interface Rung { label: string; weight: number; done: boolean }`
  - `interface Segment { label: string; from: number; to: number; done: boolean }` (fractions of the bar)
  - `segmentsOf(rungs: Rung[], donePct: number): Segment[]`

- [ ] **Step 1: Write the failing test** `scripts/verify-bar-view.ts`

```ts
/**
 * Guards the bar model: colours per mode, defaults, overrides, and that the
 * solid part of a bar IS its done percentage for every shape.
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-bar-view.ts
 */
import {
  DEFAULT_BAR_VIEW, PALETTE, canColourByPackage, effectiveColourBy, paintOf, parseBarView, segmentsOf,
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
check('palette has 8, no red or amber', PALETTE.length === 8 && !PALETTE.some((p) => ['danger', 'warn'].includes(p.key)));
check('garbage json reads as defaults', JSON.stringify(parseBarView('{nope')) === JSON.stringify(DEFAULT_BAR_VIEW));
check('unknown paint dropped', parseBarView(JSON.stringify({ colours: { kind: { engineering: 'danger' } } })).colours.kind.engineering === undefined);

const row = { colorGroup: 1, unitId: 'u2' };
check('kind default', paintOf(row, 'engineering', v, 'kind') === 'plan-1');
check('no kind is grey', paintOf(row, null, v, 'kind') === 'muted');
const custom = parseBarView(JSON.stringify({ colours: { kind: { engineering: 'plan-6' }, package: { u2: 'plan-4' }, one: 'foreground' } }));
check('kind override', paintOf(row, 'engineering', custom, 'kind') === 'plan-6');
check('package default from group', paintOf(row, null, v, 'package') === 'plan-2');
check('package override', paintOf(row, null, custom, 'package') === 'plan-4');
check('one colour', paintOf(row, 'engineering', custom, 'one') === 'foreground');
check('package needs two groups', !canColourByPackage([{ colorGroup: 0 }, { colorGroup: -1 }]) && canColourByPackage([{ colorGroup: 0 }, { colorGroup: 1 }]));
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

if (failed) { console.error(`${failed} failed`); process.exit(1); }
console.log('all passed');
```

- [ ] **Step 2:** Run `node --import ./scripts/ts-resolve.mjs scripts/verify-bar-view.ts`; expect FAIL (module missing).
- [ ] **Step 3: Write `lib/bar-view.ts`**

```ts
/**
 * What a bar on the planner looks like, and why. Replaces the ordered rule
 * list of lib/bar-styles.ts (7 Oct 2026): a planner picks what colour SAYS
 * (kind of work, package, or nothing) and which marks to show, and never
 * writes a rule. Pure: no database, no React.
 */
import type { BarPaint } from './schema';

export type ColourBy = 'kind' | 'package' | 'one';
export type MarkKey = 'done' | 'forecast' | 'contract' | 'slip';

export interface BarView {
  colourBy: ColourBy;
  marks: Record<MarkKey, boolean>;
  colours: { kind: Record<string, BarPaint>; package: Record<string, BarPaint>; one: BarPaint };
}

/** The planner's own tokens. Red is the forecast's and amber the target's, so neither is a bar colour. */
export const PALETTE: { key: BarPaint; label: string }[] = [
  { key: 'plan-1', label: 'Indigo' },
  { key: 'plan-2', label: 'Teal' },
  { key: 'plan-3', label: 'Fuchsia' },
  { key: 'plan-4', label: 'Orange' },
  { key: 'plan-5', label: 'Sky' },
  { key: 'plan-6', label: 'Lime' },
  { key: 'foreground', label: 'Black' },
  { key: 'muted', label: 'Grey' },
];
const ALLOWED = new Set(PALETTE.map((p) => p.key));

/** `none` is a row nobody has given a kind yet. */
export const KIND_KEYS = ['engineering', 'procurement', 'construction', 'commissioning', 'none'] as const;
export const DEFAULT_KIND_PAINT: Record<string, BarPaint> = {
  engineering: 'plan-1',
  procurement: 'plan-3',
  construction: 'plan-2',
  commissioning: 'plan-5',
  none: 'muted',
};

export const DEFAULT_BAR_VIEW: BarView = {
  colourBy: 'kind',
  marks: { done: true, forecast: true, contract: true, slip: false },
  colours: { kind: {}, package: {}, one: 'plan-5' },
};

function paints(v: unknown): Record<string, BarPaint> {
  const out: Record<string, BarPaint> = {};
  if (v && typeof v === 'object') {
    for (const [k, p] of Object.entries(v)) if (ALLOWED.has(p as BarPaint)) out[k] = p as BarPaint;
  }
  return out;
}

/** Whatever is stored, read as a whole view: a missing or broken field is its default. */
export function parseBarView(json: string | null): BarView {
  let raw: { colourBy?: unknown; marks?: Record<string, unknown>; colours?: { kind?: unknown; package?: unknown; one?: unknown } } = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {
    raw = {};
  }
  const d = DEFAULT_BAR_VIEW;
  const marks = { ...d.marks };
  for (const k of Object.keys(marks) as MarkKey[]) {
    if (typeof raw.marks?.[k] === 'boolean') marks[k] = raw.marks[k] as boolean;
  }
  const by = raw.colourBy;
  return {
    colourBy: by === 'package' || by === 'one' || by === 'kind' ? by : d.colourBy,
    marks,
    colours: {
      kind: paints(raw.colours?.kind),
      package: paints(raw.colours?.package),
      one: ALLOWED.has(raw.colours?.one as BarPaint) ? (raw.colours!.one as BarPaint) : d.colours.one,
    },
  };
}

export function packagePaint(colorGroup: number): BarPaint {
  return colorGroup >= 0 && colorGroup < 6 ? (`plan-${colorGroup + 1}` as BarPaint) : 'muted';
}

/** Two packages or more: a colour that cannot tell rows apart says nothing. */
export function canColourByPackage(rows: { colorGroup: number }[]): boolean {
  return new Set(rows.map((r) => r.colorGroup).filter((g) => g >= 0)).size >= 2;
}

export function effectiveColourBy(view: BarView, rows: { colorGroup: number }[]): ColourBy {
  return view.colourBy === 'package' && !canColourByPackage(rows) ? 'kind' : view.colourBy;
}

export function paintOf(
  row: { colorGroup: number; unitId: string | null },
  kindId: string | null,
  view: BarView,
  colourBy: ColourBy
): BarPaint {
  if (colourBy === 'one') return view.colours.one;
  if (colourBy === 'package') return (row.unitId && view.colours.package[row.unitId]) || packagePaint(row.colorGroup);
  const k = kindId ?? 'none';
  return view.colours.kind[k] ?? DEFAULT_KIND_PAINT[k] ?? 'muted';
}

export function paintCss(p: BarPaint): string {
  if (p === 'foreground') return 'var(--foreground)';
  if (p === 'muted') return 'var(--muted-foreground)';
  return `var(--${p})`;
}

export interface Rung {
  label: string;
  weight: number;
  done: boolean;
}
export interface Segment {
  label: string;
  from: number;
  to: number;
  done: boolean;
}

/**
 * A bar cut into its rungs, each as wide as its weight, so the solid length is
 * the done percentage. A row with no rungs (quantity, typed percent) is one
 * solid part up to its percent and one tint part after it.
 */
export function segmentsOf(rungs: Rung[], donePct: number): Segment[] {
  if (rungs.length > 0) {
    const total = rungs.reduce((a, r) => a + r.weight, 0) || 1;
    let at = 0;
    return rungs.map((r) => {
      const from = at;
      at += r.weight / total;
      return { label: r.label, from, to: at, done: r.done };
    });
  }
  const f = Math.max(0, Math.min(100, donePct)) / 100;
  if (f <= 0) return [{ label: '', from: 0, to: 1, done: false }];
  if (f >= 1) return [{ label: '', from: 0, to: 1, done: true }];
  return [
    { label: '', from: 0, to: f, done: true },
    { label: '', from: f, to: 1, done: false },
  ];
}
```

- [ ] **Step 4:** Run; expect `all passed`.
- [ ] **Step 5: Commit** `lib/bar-view.ts scripts/verify-bar-view.ts` — "Bar model: colour by kind/package/one, four marks, a bar cut into its stages".

---

### Task 2: `projects.bar_view` column, its reader and its action

**Files:**
- Modify: `lib/schema.ts` (projects, after `barPreset`)
- Create: `data/migrations/<generated>.sql` (`npm run db:generate`)
- Modify: `lib/db-snapshot.ts` (`EXPECTED_COLUMNS`)
- Create: `lib/bar-view-read.ts`, `lib/bar-view-actions.ts`
- Test: append to `scripts/verify-bar-view.ts`

**Interfaces:**
- Consumes: `parseBarView`, `BarView` (Task 1)
- Produces: `getBarView(projectId: string): BarView`; `setBarViewAction(projectId: string, view: BarView): Promise<{ ok: boolean; error?: string }>`

- [ ] **Step 1:** `cp data/report.db data/report.db.pre-barview`; record counts of `wbs_nodes`, `milestones`, `leaf_progress`.
- [ ] **Step 2:** `lib/schema.ts` projects: `barView: text('bar_view'),` with `/** The Bars panel's choices as JSON, read by lib/bar-view.ts. Null = defaults. */`.
- [ ] **Step 3:** `npm run db:generate`; the SQL must be one `ALTER TABLE \`projects\` ADD \`bar_view\` text;`. A table rebuild = STOP, hand-write the ALTER.
- [ ] **Step 4:** `npm run db:migrate`; `REPORT_DB_PATH=data/seed.db npm run db:migrate`; checkpoint seed (`new Database('data/seed.db').pragma('wal_checkpoint(TRUNCATE)')`). Recount; equal to Step 1.
- [ ] **Step 5:** `EXPECTED_COLUMNS` += `{ table: 'projects', column: 'bar_view', decl: 'text' },`
- [ ] **Step 6:** `lib/bar-view-read.ts`

```ts
import { eq } from 'drizzle-orm';
import { db, schema } from './sqlite';
import { parseBarView, type BarView } from './bar-view';

/** A project's Bars choices. Sync like every read here. */
export function getBarView(projectId: string): BarView {
  const row = db.select({ v: schema.projects.barView }).from(schema.projects).where(eq(schema.projects.id, projectId)).all()[0];
  return parseBarView(row?.v ?? null);
}
```

- [ ] **Step 7:** `lib/bar-view-actions.ts` — `'use server'`, same write wrapper `lib/bar-style-actions.ts` uses today (copy its imports and the `beforeWrite`/awaited push exactly):

```ts
export async function setBarViewAction(projectId: string, view: BarView): Promise<{ ok: boolean; error?: string }> {
  // Round-tripped through the parser: a client payload never stores a paint the palette does not offer.
  const clean = parseBarView(JSON.stringify(view));
  db.update(schema.projects).set({ barView: JSON.stringify(clean) }).where(eq(schema.projects.id, projectId)).run();
  return { ok: true };
}
```

- [ ] **Step 8:** Append a fixture round trip (`copyDbFixture` from `scripts/db-fixture.ts`): store `{ colourBy: 'one', colours: { one: 'plan-6' } }`, read with `parseBarView`, assert both. Run; `all passed`.
- [ ] **Step 9: Commit** schema, migration, `data/seed.db`, snapshot list, reader, action, script — "Bars settings stored per project in one JSON column".

---

### Task 3: `lib/bar-facts.ts`, the plan's facts for each bar

**Files:**
- Create: `lib/bar-facts.ts`, `scripts/verify-bar-facts.ts`

**Interfaces:**
- Consumes: `buildProjectDashboardData`, `currentWeekOf`, `resolveLeafProgress`, `buildForecastView`, `disciplineOf`, `stepIdOf`, `Rung`, `Shape`
- Produces:

```ts
export interface BarFact {
  kindId: string | null;
  /** Leaves only; null on a heading or a row nobody has given a kind. */
  shape: Shape | null;
  disciplineId: string | null;
  donePct: number;
  rungs: Rung[];
  /** Step ids of the rungs, for the picker's `currentLadder`. */
  ladder: string[];
  forecastFinish: string | null;
  planFinish: string | null;
  /** The forecast's own reason in words, or null when on plan. */
  reason: string | null;
}
export interface BarFacts { week: number | null; facts: Record<string, BarFact> }
export function getBarFacts(projectId: string, today?: Date): BarFacts
```

- [ ] **Step 1: Failing test** `scripts/verify-bar-facts.ts` on `copyDbFixture`: the project with most `wbs_nodes`; for every leaf assert `facts[id].donePct === resolveLeafProgress(item, weekRow.leafData[id])` at `currentWeekOf(db)`, and `facts[id].forecastFinish === buildForecastView(db, week).leaves[id]?.finish ?? null`; every key is a `wbs_nodes.id` of that project; headings carry no rungs.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: Implement**

```ts
/**
 * What each bar on the planner has to say, read off the SAME Database Data
 * Overall reads, as of the project's current week. Computes nothing of its
 * own: done from lib/progress.ts, finish and reason from the forecast.
 * Reads the clock (currentWeekOf), so call it after a request read.
 */
import { buildProjectDashboardData } from './dashboard-db';
import { currentWeekOf } from './current-week';
import { resolveLeafProgress } from './progress';
import { buildForecastView, type ForecastReason } from './forecast-view';
import { disciplineOf } from './disciplines';
import { stepIdOf } from './forecast-epc';
import type { Rung } from './bar-view';
import type { Shape } from './work-kind';

function reasonText(r: ForecastReason): string | null {
  switch (r.kind) {
    case 'pushed': return `it waits for ${r.by.name}`;
    case 'behind': return `it is ${r.weeks} ${r.weeks === 1 ? 'week' : 'weeks'} behind its plan`;
    case 'typed': return 'of the date that was given';
    case 'measured': return 'of the rate measured so far';
    default: return null;
  }
}

export function getBarFacts(projectId: string, today: Date = new Date()): BarFacts {
  const db = buildProjectDashboardData(projectId)?.db;
  if (!db) return { week: null, facts: {} };
  const week = db.weeks.length ? currentWeekOf(db, today) : null;
  const meta = week != null ? db.weeks.find((w) => w.week === week) : undefined;
  const parents = new Set(db.wbsItems.map((i) => i.parentId).filter(Boolean) as string[]);
  const view = week != null ? buildForecastView(db, week) : null;
  const facts: Record<string, BarFact> = {};
  for (const item of db.wbsItems) {
    const leaf = !parents.has(item.id);
    const snap = meta?.leafData[item.id];
    const done = new Set(snap?.milestonesDone ?? []);
    const ms = leaf && item.progressMethod === 'milestone' ? item.milestones ?? [] : [];
    const shape: Shape | null = !leaf || !item.workKind ? null
      : item.progressMethod === 'qty' ? 'qty'
      : item.progressMethod === 'milestone' ? (ms.length === 1 ? 'gate' : 'steps')
      : 'manual';
    const f = leaf ? view?.leaves[item.id] : undefined;
    const late = !!f && f.finish > f.planFinish;
    facts[item.id] = {
      kindId: item.workKind ?? null,
      shape,
      disciplineId: item.workKind === 'construction' ? disciplineOf(ms)?.id ?? null : null,
      donePct: leaf ? resolveLeafProgress(item, snap) : 0,
      rungs: ms.map((m) => ({ label: m.label, weight: m.weight, done: done.has(m.id) })),
      ladder: ms.map((m) => stepIdOf(m.id)),
      forecastFinish: f?.finish ?? null,
      planFinish: f?.planFinish ?? null,
      reason: late ? reasonText(f!.reason) : null,
    };
  }
  return { week, facts };
}
```

(Confirm during implementation: `stepIdOf`'s module, `disciplineOf` accepting stored `node:step` ids, and that `db.wbsItems` ids are `wbs_nodes.id`.)

- [ ] **Step 4:** Run; `all passed`.
- [ ] **Step 5: Commit** — "Bar facts: done, stages and forecast for the planner, from Data Overall's own readers".

---

### Task 4: Kind in the plan: row, heading, and add row

**Files:**
- Create: `lib/kind-plan.ts`, `lib/kind-plan-actions.ts`, `scripts/verify-kind-plan.ts`
- Modify: `lib/sheet-structure.ts` (`addRowAction`, after the insert transaction)

**Interfaces:**
- Consumes: `setWorkKindSqlite`, `ladderFor`, `shapeOf`, `BUILT_IN_KINDS`, `findDiscipline`, `disciplineOf`, `getSheet`, `getBarFacts`
- Produces:
  - `applyKindInPlan(projectId: string, nodeId: string, kindId: string, shape: Shape, steps: Milestone[]): string[]`
  - `inheritKind(projectId: string, nodeId: string): void`
  - `setKindInPlanAction(projectId, nodeId, kindId, shape, steps): Promise<{ ok: boolean; error?: string; sheet?: Sheet; facts?: Record<string, BarFact> }>`

Rules (spec decision 6): a leaf is written through `setWorkKindSqlite` exactly as `setWorkKindAction` does. A heading stores `work_kind` and walks its subtree: a descendant is written when its `work_kind` is null or equals the heading's PREVIOUS kind and is not already `kindId`; a nested heading with its own different kind is skipped WITH its subtree. Each leaf's shape is `shapeOf(leaf.name, discipline ?? kind)`, its ladder `ladderFor(kindId, shape, leaf.name, BUILT_IN_KINDS, disciplineId)` with `disciplineId = disciplineOf(steps)?.id ?? null`. `qty` on a heading is refused ("Set quantities row by row: each one needs its own total.").

- [ ] **Step 1: Failing test** on `copyDbFixture` with a hand-built subtree (heading H; leaves A "Pipe stress analysis", B "IFR", C with kind procurement; nested heading N kind construction with leaf D): apply engineering to H → H, A, B engineering; A 3 rungs, B 1 rung "IFR"; C, N, D untouched. Apply commissioning to H → A, B follow; C untouched. `addRowAction(p, { afterNodeId: A })` → new row is commissioning with rungs. A leaf with recorded progress keeps a figure `<=` its old one, never zeroed.
- [ ] **Step 2:** Run; FAIL.
- [ ] **Step 3: `lib/kind-plan.ts`**

```ts
/**
 * The kind of work, set in the plan (7 Oct 2026). A row is written exactly as
 * Data Overall used to write it; a heading hands its kind down to the rows that
 * have none of their own or still carry its previous one.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from './sqlite';
import { setWorkKindSqlite } from './progress-sqlite';
import { ladderFor } from './work-kind-apply';
import { BUILT_IN_KINDS, shapeOf, type Shape } from './work-kind';
import { disciplineOf, findDiscipline } from './disciplines';
import type { Milestone, ProgressMethod } from './types';

const methodFor = (s: Shape): ProgressMethod => (s === 'qty' ? 'qty' : s === 'manual' ? 'lumpsum' : 'milestone');

function writeLeaf(id: string, name: string, kindId: string, shape: Shape, disciplineId: string | null, steps?: Milestone[]) {
  const milestones = steps ?? ladderFor(kindId, shape, name, BUILT_IN_KINDS, disciplineId);
  setWorkKindSqlite(id, kindId, methodFor(shape), shape === 'qty' ? {} : { milestones });
}

function nodesOf(projectId: string) {
  return db
    .select({ id: schema.wbsNodes.id, parentId: schema.wbsNodes.parentId, name: schema.wbsNodes.deskripsi, kind: schema.wbsNodes.workKind })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .all();
}

export function applyKindInPlan(projectId: string, nodeId: string, kindId: string, shape: Shape, steps: Milestone[]): string[] {
  const nodes = nodesOf(projectId);
  const target = nodes.find((n) => n.id === nodeId);
  if (!target) throw new Error('Row not found');
  const kids = new Map<string, typeof nodes>();
  for (const n of nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);

  if (!kids.has(nodeId)) {
    writeLeaf(nodeId, target.name, kindId, shape, null, steps);
    return [nodeId];
  }
  if (shape === 'qty') throw new Error('Set quantities row by row: each one needs its own total.');
  const kind = BUILT_IN_KINDS.find((k) => k.id === kindId);
  if (!kind) throw new Error('Unknown kind of work');
  const disciplineId = kindId === 'construction' ? disciplineOf(steps)?.id ?? null : null;
  const pattern = findDiscipline(disciplineId) ?? kind;
  const prev = target.kind;
  const written: string[] = [nodeId];
  db.update(schema.wbsNodes).set({ workKind: kindId }).where(eq(schema.wbsNodes.id, nodeId)).run();

  const walk = (id: string) => {
    for (const c of kids.get(id) ?? []) {
      const follows = c.kind == null || c.kind === prev;
      const isHeading = kids.has(c.id);
      if (isHeading && !follows) continue; // a heading with its own kind governs its subtree
      if (follows && c.kind !== kindId) {
        if (isHeading) db.update(schema.wbsNodes).set({ workKind: kindId }).where(eq(schema.wbsNodes.id, c.id)).run();
        else writeLeaf(c.id, c.name, kindId, shapeOf(c.name, pattern), disciplineId);
        written.push(c.id);
      }
      if (isHeading) walk(c.id);
    }
  };
  walk(nodeId);
  return written;
}

/** A new row under a heading takes the nearest heading's kind (and, for construction, a sibling's discipline). */
export function inheritKind(projectId: string, nodeId: string): void {
  const all = nodesOf(projectId);
  const byId = new Map(all.map((n) => [n.id, n]));
  const me = byId.get(nodeId);
  let p = me?.parentId ? byId.get(me.parentId) : undefined;
  while (p && !p.kind) p = p.parentId ? byId.get(p.parentId) : undefined;
  if (!me || !p?.kind) return;
  const kind = BUILT_IN_KINDS.find((k) => k.id === p!.kind);
  if (!kind) return;
  let disciplineId: string | null = null;
  if (kind.id === 'construction') {
    for (const s of all) {
      if (s.parentId !== me.parentId || s.id === nodeId || s.kind !== 'construction') continue;
      const ms = db.select({ id: schema.milestones.id }).from(schema.milestones).where(eq(schema.milestones.nodeId, s.id)).all();
      disciplineId = disciplineOf(ms)?.id ?? null;
      if (disciplineId) break;
    }
  }
  writeLeaf(nodeId, me.name, kind.id, shapeOf(me.name, findDiscipline(disciplineId) ?? kind), disciplineId);
}
```

- [ ] **Step 4:** `lib/kind-plan-actions.ts`: `'use server'`; `setKindInPlanAction` wraps `applyKindInPlan` in the write wrapper `lib/sheet-structure.ts` uses (`beforeWrite`, awaited push), catches to `{ ok: false, error }`, `await connection()` before reading facts, returns `{ ok: true, sheet: getSheet(projectId), facts: getBarFacts(projectId).facts }`.
- [ ] **Step 5:** `addRowAction`: after the insert transaction, `inheritKind(projectId, id);`
- [ ] **Step 6:** Run `verify-kind-plan`, `verify-bar-view`, `verify-bar-facts`; all pass.
- [ ] **Step 7: Commit** — "Kind of work set in the plan: a heading hands it to its rows, a new row takes it".

---

### Task 5: The Gantt draws the plan's bar

**Files:**
- Modify: `components/projects/GanttChart.tsx` (props; bars ~585-731; `extras`; `GanttLegend`; delete `BarStylesButton`, `Swatch`, `paintColor`, `paintSwatch`, the `lib/bar-styles` import)
- Modify: `components/projects/ScheduleSheet.tsx` (`paintOf`, props to Gantt/legend)

**Interfaces:**
- Consumes: Task 1 (`BarView`, `paintOf`, `paintCss`, `segmentsOf`, `effectiveColourBy`), Task 3 (`BarFact`)
- Produces: `GanttChart` props `view: BarView; facts: Record<string, BarFact>; colourBy: ColourBy` (replace `styles`); `GanttLegend({ rows, view, facts, colourBy, network, contract })`; ScheduleSheet `paintOf(row) = paintCss(paintOf(row, facts[row.id]?.kindId ?? null, view, colourBy))`.

Drawing rules:
- Task bar: the 12px bar is a flex row of `segmentsOf(fact.rungs, fact.donePct)` (when `marks.done` is OFF: one full segment, solid). Done segment `background: color`; not done `background: color; opacity: .28`. `gap-px` between rung segments. Label (`text-[10px] font-medium`, white on done, foreground on tint) only when the segment is ≥ 28px.
- Procurement flag: `fact.kindId === 'procurement'` and the last rung is "On site" → lucide `Flag` `size-3`, bar colour, at the finish above the bar.
- Forecast (`marks.forecast` and `fact.forecastFinish > r.finishDate`): from `xOf(r.finishDate)+scale` to `xOf(fact.forecastFinish)+scale`, 12px, `border: 1px solid var(--bad)`, `background: repeating-linear-gradient(135deg, var(--bad) 0 2px, transparent 2px 5px)`, right corners rounded; then `+N d` (`text-[10px] font-semibold text-[var(--bad)]`).
- Contract only when `marks.contract`; Can slip tail only when `marks.slip`. Red outline and target hatch always (target hatch whenever `r.daysLate != null`).
- Bracket and diamond: `var(--foreground)`.
- Legend: kind mode → a swatch per kind present ("Not set" for none); package mode → package swatches in `paintOf` colours; one → none. Then each ON mark present in the plan (Done: half-solid swatch "Done"; Forecast: red hatch "Late, days past the plan"; Contract; Can slip), then Target date, Sets the project finish, conflicts, Today. No edit button.

- [ ] **Step 1:** GanttChart changes; handles, arrows, drag layer, virtualisation untouched.
- [ ] **Step 2:** ScheduleSheet: props `barView: BarView`, `barFacts: Record<string, BarFact>` replace the four `barStyle*`; `view`/`facts` in state seeded from props; `colourBy = effectiveColourBy(view, rows)`; rewrite `paintOf`; pass to Gantt and legend; remove `BarStylesButton` from the selected strip.
- [ ] **Step 3:** Type-check (the repo's filtered tsconfig) and `npx eslint` on both files; zero errors.
- [ ] **Step 4: Commit** — "Gantt: a bar is its plan, cut into stages, with forecast, contract and slack as marks".

---

### Task 6: Bars panel, Links and Bars in the toolbar, old editor out

**Files:**
- Create: `components/projects/BarsPanel.tsx`
- Modify: `components/projects/links-panel-loader.ts`, `components/projects/SheetToolbar.tsx`, `components/projects/ScheduleSheet.tsx`, `app/projects/[id]/page.tsx`
- Delete: `components/projects/BarStyleEditor.tsx`, `lib/bar-style-actions.ts`, `lib/bar-styles-read.ts`, `scripts/verify-bar-styles.mjs`, then `lib/bar-styles.ts` once `lib/sheet.ts`/`lib/schema.ts` no longer import from it (move any type still needed into `lib/bar-view.ts`)

**Interfaces:**
- Consumes: Task 1, `setBarViewAction` (Task 2)
- Produces: `BarsPanel({ view, rows, contract, onChange, onClose })`; `onChange(next)` on every press (sheet sets state at once, fires `setBarViewAction`; failure → sheet error line + revert).

Panel: `RowMenu`'s overlay shell. "Bars" / "What every bar in this plan shows." · "Colour bars by": Kind of work · Package (only if `canColourByPackage(rows)`) · One colour · "Colours": one 44px row per thing coloured (kinds + "Not set"; packages by `groupLabel`; or one) with a swatch button; a press expands an inline row of the 8 `PALETTE` swatches (no nested popover) · "Show on the timeline": Done, Forecast, Contract (only if `contract`), Can slip; each its mark drawn small, its sentence, a `role="switch"` button · Footer: "Back to standard" (`DEFAULT_BAR_VIEW`) and "Done".

Toolbar: after Undo, a divider, `Links` (`Link2`; disabled with no selection or a summary selected; opens `menuRow=selected, menuMode='links'`) and `Bars` (`ChartNoAxesGantt`; always). Both `compact`, not `desktopOnly`.

- [ ] **Step 1:** BarsPanel, lazy (`dynamic(..., { ssr: false })` inside its own `<Suspense fallback={null}>`), warmed in the existing idle warm-up.
- [ ] **Step 2:** Toolbar actions + props `onLinks`, `onBars`, `canLink`.
- [ ] **Step 3:** Page: `getBarView(id)`, `getBarFacts(id)` after `await params`; pass `barView`, `barFacts`; drop `getBarStyles`.
- [ ] **Step 4:** Delete old files; `grep -rn "bar-styles\|BarStyleEditor\|bar-style-actions\|getBarStyles" app components lib scripts` empty.
- [ ] **Step 5:** Type-check + eslint; `verify-bar-view` passes.
- [ ] **Step 6: Commit** — "Bars is its own menu; Links and Bars in the toolbar; the rule editor is gone".

---

### Task 7: Kind view in the row panel, the bar sentence, the deep link

**Files:**
- Modify: `components/projects/RowMenu.tsx`, `components/projects/ScheduleSheet.tsx`
- Create: `lib/bar-sentence.ts` (+ checks in `scripts/verify-bar-view.ts`)

**Interfaces:**
- Consumes: `WorkKindPicker`, `WorkKindPickerHandle`, `WorkKindPeer`; `setKindInPlanAction`; `changeFor`, `impactOf`, `ladderFor`; `BarFact`; `segmentsOf`, `paintCss`
- Produces:
  - `barSentence(row: SheetRow, fact: BarFact | undefined, opts: { setsFinish: boolean }): string`
  - RowMenu props `facts`, `peers: WorkKindPeer[]`, `onKindSaved(sheet: Sheet, facts: Record<string, BarFact>)`; `initialMode` gains `'kind'`

Kind view: entry "Kind of work: Engineering" / "Kind of work: not set" for every row. Holds `WorkKindPicker` (`node={{ id, name }}`, `peers`, `current={fact?.kindId ?? null}`, `context` = ancestor names nearest first, `currentLadder={fact?.ladder}`, `onPick` → pending choice, `ref`). Under it a preview bar of the pending ladder in the pending kind's colour, and, when progress exists, ONE sentence from `changeFor`/`impactOf`: row "Its 57.5% becomes 15.0%, the last stage it has fully reached."; heading "3 of the 12 rows have progress. Each moves to the last stage it has fully reached." Heading line above the picker: "Applies to the N rows under it that have no kind of their own." Footer Cancel / Save (`ref.choice()`: `'same'`/null closes; else `setKindInPlanAction` → `onKindSaved`).

Sentence, clauses joined by " · ", each only when it has something: `Plan 23 Mar → 17 May` · `Done 60% (IFR, IFA)` · `Finishes 24 May, 7 days late because it waits for X` or `Finishes on plan` · `Sets the project finish` · `Contract 18 Mar → 12 May`. Milestone: `On 30 Jun`. Heading: `Plan …` only. Three fixtures in the script give exact strings.

Deep link: an effect reads `location.hash`; `#row=<id>&open=kind` selects the row, uncollapses its ancestors, scrolls it into the window, opens `RowMenu` with `'kind'`, then `history.replaceState` drops the hash.

- [ ] **Step 1:** `lib/bar-sentence.ts` + checks; pass.
- [ ] **Step 2:** RowMenu kind mode.
- [ ] **Step 3:** ScheduleSheet: peers memo from facts, `onKindSaved` (rows through the existing server-sheet path, facts state), sentence in the selected strip (wraps on phone), hash effect.
- [ ] **Step 4:** Type-check + eslint.
- [ ] **Step 5: Commit** — "Kind of work is set in the planner; a pressed bar says what it shows".

---

### Task 8: Data Overall reads the kind and the links

**Files:**
- Modify: `components/weekly/ActivityPanel.tsx`, `components/weekly/ForecastBlock.tsx:265-305`, `components/weekly/OverallMap.tsx` (drop picker-only `peers` if unused)

Rules: the panel never shows `WorkKindPicker`. Kind set → the "Kind of work" row shows the label ("Construction · Piping" for construction) and its button becomes a `Link` "Change in plan" to `${projectHref}#row=${node.id}&open=kind`, same pill. Kind not set → "Kind of work" / "Not set in the plan" with a "Set in plan" link; `ProgressEntry` shows for its stored method. Remove `kindOverride`, `picking`, `applyKind`, the kind branch of `footerSave`, unused imports. ForecastBlock: links section only when `view.waitsFor.length > 0`; no empty sentences, no button.

- [ ] **Step 1:** ActivityPanel; `grep -n "WorkKindPicker\|kindOverride\|setWorkKindAction" components/weekly/ActivityPanel.tsx` empty.
- [ ] **Step 2:** ForecastBlock.
- [ ] **Step 3:** Type-check + eslint.
- [ ] **Step 4: Commit** — "Data Overall reads the kind of work and the links; both are changed in the plan".

---

### Task 9: Prove it, measure it, write it down

- [ ] **Step 1:** Run every `scripts/verify-*` that touches sheet, links, kinds, weights; all pass.
- [ ] **Step 2:** `npx next build > build.log 2>&1; echo $?` → `0`.
- [ ] **Step 3:** Perf A/B with `scripts/verify-projects-perf.mjs`: baseline build at `7f52b0b` vs this one, same session; report both.
- [ ] **Step 4:** Press tests on `next start` (Merbau): toolbar Links; every Bars switch/swatch changes the Gantt and survives reload; Package hidden on a one-package plan; Engineering on the Engineering heading recolours its rows and shows IFR/IFA/AFC; a new row under it is Engineering; Data Overall "Change in plan" opens the planner on that row's kind view. Assert before/after.
- [ ] **Step 5:** `scripts/shoot.mjs` at 390 and 1440: Bars open, a pressed bar's sentence, the kind view on a heading, Data Overall panel. Look at each.
- [ ] **Step 6:** AGENTS.md (Projects + Data Overall paragraphs) and memory; commit "AGENTS: bars read the plan, the kind of work is the plan's". Do NOT push; ask.
