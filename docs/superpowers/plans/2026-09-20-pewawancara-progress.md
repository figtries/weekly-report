# Pewawancara Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop asking "what percent is it?" and ask a question whose answer is a fact, so a weekly figure is arrived at rather than invented.

**Architecture:** A leaf gets a *work kind* (Engineering, Procurement, Construction, Commissioning, or one the project adds). The kind supplies a default ladder. A row whose NAME is itself one rung of that ladder ("Material on site", "IFR") is a **gate** — a one-step ladder answered with a single tap. A row that covers the whole ladder is answered by ticking how far it got. A row whose number belongs to somebody else is a **quote** — a figure with a date and a source. Typing a percent by hand is never removed. No new progress method is needed: a gate is a one-rung `milestone`, a ladder is an n-rung `milestone`, and quote and manual are both `lumpsum` distinguished by a stored source.

**Tech Stack:** Next 16 (App Router, `cacheComponents`), React 19, drizzle-orm over better-sqlite3 (SYNCHRONOUS driver), Tailwind v4, shadcn `radix-nova`, framer-motion. No test runner: correctness is proved by `scripts/verify-*.ts` executables run under `node --import ./scripts/ts-resolve.mjs`.

**Spec:** `docs/superpowers/specs/2026-09-20-pewawancara-progress-design.md`

## Global Constraints

Every task's requirements implicitly include all of these.

- **The app is in English.** Every label, button, error and hint added by this plan is English, `en-GB` dates, decimal POINT. Only `/print/*` is not, and `/print/*` is not touched by this plan.
- **No em dash (`—`) in any user-visible string.** Use a comma, a colon, or two sentences.
- **Tap targets are `min-h-11` (44px), never `h-11`,** so text that wraps grows the control instead of clipping it.
- **Radix per screen, never per row.** Nothing added inside a `.map()` that can exceed ~20 rows may mount a Radix Select / Popover / DropdownMenu / Tooltip. Use native `<button>` / `<input>` / `<select>` styled with shadcn classes.
- **Entry animation on page load is a CSS keyframe** (`.animate-fade-in-up`, `.animate-enter`), never framer-motion. framer-motion is only for motion triggered by state after the page is alive.
- **The SQLite driver stays synchronous.** Never introduce an async database read; it forces `<Suspense>` around every read in the app.
- **`lib/progress.ts` is the only origin of a leaf percentage.** Nothing added here computes a percentage of its own. `lib/rollup.ts` and `lib/overall-map.ts` stay computation-free.
- **A new COLUMN reaches the deployment through `EXPECTED_COLUMNS` in `lib/db-snapshot.ts`**, appended one line per column. A new TABLE would be a deployment question; this plan adds none.
- **Never `fs.copyFileSync` a WAL database.** Test fixtures use `copyDbFixture` from `scripts/db-fixture.ts`.
- **Verify UI by looking at an image:** `node scripts/shoot.mjs <url> <out.png> [w] [h]`, at desktop and at 390px. The Browser pane cannot composite in this environment, so `computer{action:"screenshot"}` always fails.
- **Never verify a build through a pipe.** `npx next build > /tmp/build.log 2>&1; echo $?`.
- Run `npx tsc --noEmit -p tsconfig.json` before each commit.

---

## File Structure

**Create**

| file | responsibility |
|---|---|
| `lib/work-kind.ts` | The taxonomy. Built-in kinds, their ladders, `shapeOf`, `guessWorkKind`, `suggestFromPeers`. Pure, no database, no React. |
| `lib/work-kind-apply.ts` | Turning a kind into stored milestones, and measuring what that would move before it is done. Pure functions over plain data; the callers supply the rows. |
| `components/weekly/ProgressEntry.tsx` | The four question forms (gate, steps, quote, manual) plus the sentence that translates an answer into plan terms. |
| `components/weekly/WorkKindPicker.tsx` | The one-time "what kind of work is this?" question, with the guess and the peer suggestion shown for correction. |
| `scripts/verify-work-kind.ts` | Proves the taxonomy: weights close at 100, guesses land, peers win over guesses. |
| `scripts/verify-work-kind-apply.ts` | Proves conversion never invents progress and the impact preview equals what applying actually does. |

**Modify**

| file | change |
|---|---|
| `lib/schema.ts:218` | `wbsNodes.workKind`; `leafProgress.source` |
| `lib/db-snapshot.ts:202` | two lines appended to `EXPECTED_COLUMNS` |
| `lib/types.ts:29,42` | `WbsItem.workKind`, `LeafSnapshot.note`, `LeafSnapshot.source` |
| `lib/progress-sqlite.ts:259` | write `workKind`; write `note` / `source` on save |
| `lib/mutations.ts:321,372` | the db.json half of the same |
| `lib/actions.ts:271` | `setWorkKindAction` |
| `lib/overall-map.ts:245` | carry `workKind`, `note`, `source` onto `MapNode` |
| `components/weekly/ActivityPanel.tsx:317` | render `ProgressEntry` instead of the three inline forms |
| `components/weekly/WeekChecks.tsx` | a line for rows whose figure was typed by hand |

---

## Task 1: The taxonomy

**Files:**
- Create: `lib/work-kind.ts`
- Test: `scripts/verify-work-kind.ts`

**Interfaces:**
- Consumes: `Milestone` from `lib/types.ts` (`{ id: string; label: string; weight: number }`)
- Produces:
  - `type Shape = 'gate' | 'steps' | 'quote'`
  - `interface WorkKind { id: string; label: string; steps: Milestone[]; stageHints: string[]; kindHints: string[] }`
  - `const BUILT_IN_KINDS: WorkKind[]`
  - `function normalizeName(name: string): string`
  - `function shapeOf(name: string, kind: WorkKind): Shape`
  - `function guessWorkKind(name: string, kinds: WorkKind[]): { kindId: string; shape: Shape } | null`
  - `function suggestFromPeers(name: string, peers: Array<{ name: string; kindId: string; shape: Shape }>): { kindId: string; shape: Shape } | null`
  - `function gateLadder(label: string): Milestone[]`

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-work-kind.ts`:

```ts
/**
 * Proves the four claims the taxonomy makes.
 *
 * One: every built-in ladder closes at 100, because a ladder that does not is a
 * row that can never reach its own finish. Two: a row NAMED after one rung of a
 * ladder is a gate, which is the whole reason 110 of Gundih's 218 rows only ever
 * held 0 or 100. Three: a row named after a system takes the whole ladder. Four:
 * a peer the user has already answered for beats any guess, because the user's
 * own correction is the strongest evidence in the project.
 *
 * No database. Everything is built by hand so a failure here is a failure in
 * `lib/work-kind.ts` and nowhere else.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind.ts
 */
import {
  BUILT_IN_KINDS,
  gateLadder,
  guessWorkKind,
  normalizeName,
  shapeOf,
  suggestFromPeers,
} from '../lib/work-kind.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

/* 1 — every ladder closes at 100 */
for (const k of BUILT_IN_KINDS) {
  const total = k.steps.reduce((s, m) => s + m.weight, 0);
  check(`${k.label} ladder closes at 100`, Math.abs(total - 100) < 1e-9, `got ${total}`);
  const ids = new Set(k.steps.map((s) => s.id));
  check(`${k.label} step ids are unique`, ids.size === k.steps.length);
}

/* 2 — a row named after a rung is a gate */
const gates: Array<[string, string]> = [
  ['IFR', 'engineering'],
  ['AFC', 'engineering'],
  ['Material On Site', 'procurement'],
  ['Process PO', 'procurement'],
  ['RTS', 'procurement'],
  ['QC Inspection', 'construction'],
];
for (const [name, kindId] of gates) {
  const g = guessWorkKind(name, BUILT_IN_KINDS);
  check(`"${name}" guesses ${kindId}/gate`, g?.kindId === kindId && g?.shape === 'gate', JSON.stringify(g));
}

/* 3 — a row named after a system takes the whole ladder */
const ladders: Array<[string, string]> = [
  ['Turbine Air Inlet System Installation', 'construction'],
  ['Dismantle Exhaust System', 'construction'],
  ['Pre-Commissioning TG-100 (G-1201E)', 'commissioning'],
  ['Start Up & Running Test', 'commissioning'],
];
for (const [name, kindId] of ladders) {
  const g = guessWorkKind(name, BUILT_IN_KINDS);
  check(`"${name}" guesses ${kindId}/steps`, g?.kindId === kindId && g?.shape === 'steps', JSON.stringify(g));
}

/* a name the taxonomy has never seen stays unguessed rather than guessing wrong */
check('unknown name yields null', guessWorkKind('Zebra', BUILT_IN_KINDS) === null);

/* 4 — a peer beats a guess */
const peers = [{ name: 'PO Unprice', kindId: 'construction', shape: 'steps' as const }];
const fromPeer = suggestFromPeers('PO Unprice', peers);
check('exact peer wins', fromPeer?.kindId === 'construction' && fromPeer?.shape === 'steps');
check('peer match ignores case and spacing', suggestFromPeers('po  unprice', peers)?.kindId === 'construction');
check('no peer yields null', suggestFromPeers('Something Else', peers) === null);

/* normalize is what makes 18 identical rows one decision */
check('normalize folds case, spaces and punctuation', normalizeName(' PO  Unprice. ') === 'po unprice');

/* a gate ladder is one rung worth everything */
const gl = gateLadder('Material on site');
check('gate ladder is one rung of 100', gl.length === 1 && gl[0].weight === 100 && gl[0].label === 'Material on site');

/* shapeOf is the piece guessWorkKind leans on, checked directly */
const procurement = BUILT_IN_KINDS.find((k) => k.id === 'procurement')!;
check('shapeOf: rung name is a gate', shapeOf('Material On Site', procurement) === 'gate');
check('shapeOf: system name is steps', shapeOf('Compressor Package', procurement) === 'steps');

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind.ts
```

Expected: fails to resolve `../lib/work-kind.ts`.

- [ ] **Step 3: Write `lib/work-kind.ts`**

```ts
import type { Milestone } from './types';

/**
 * What kind of work a row is, and therefore what question it deserves.
 *
 * The app used to ask every row the same thing: "what percent?". That is a
 * question about an opinion, and Gundih shows what people do when an opinion is
 * demanded of them. Of 218 leaves at week 60, 85 sat at 0 and 108 sat at 100.
 * Only 25 were ever anywhere in between. Nobody was estimating; they were
 * flipping a switch, because for most rows a switch is the honest instrument and
 * the app had not offered one.
 *
 * So a row is asked once what KIND of work it is. In EPC the answer is a short
 * list, which is exactly why it can be answered by anyone without training. The
 * kind then supplies the ladder, and the row's own NAME decides whether it
 * carries that whole ladder or IS one rung of it.
 *
 * THIS MODULE COMPUTES NO PERCENTAGE. It produces `Milestone[]`, and
 * `lib/progress.ts` remains the single origin of every figure.
 */

export type Shape = 'gate' | 'steps' | 'quote';

export interface WorkKind {
  id: string;
  label: string;
  /** The ladder this kind offers. Always closes at 100. */
  steps: Milestone[];
  /**
   * Names that mean the row IS one rung rather than the whole climb. Matched
   * against the normalized row name, whole string or leading word.
   */
  stageHints: string[];
  /** Words anywhere in the name that put the row in this kind. */
  kindHints: string[];
}

/**
 * The four that repeat on every EPC contract.
 *
 * Engineering's 50/30/20 is not invented: `doc_stage_weights` already stores
 * exactly that for the VDRL register, so a project's documents and its WBS
 * agree without anyone reconciling them. Construction's 15/50/25/10 was chosen
 * by this app's own user. The other two are starting points, and every one of
 * them is editable per row and per project, because a default that cannot be
 * argued with is a rule, and these are not rules.
 */
export const BUILT_IN_KINDS: WorkKind[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    steps: [
      { id: 'ifr', label: 'IFR', weight: 50 },
      { id: 'ifa', label: 'IFA', weight: 30 },
      { id: 'afc', label: 'AFC', weight: 20 },
    ],
    stageHints: ['ifr', 'ifa', 'afc', 're ifr', 're ifa', 're afc'],
    kindHints: ['ifr', 'ifa', 'afc', 'drawing', 'design', 'engineering', 'document', 'calculation'],
  },
  {
    id: 'procurement',
    label: 'Procurement',
    steps: [
      { id: 'po', label: 'PO issued', weight: 20 },
      { id: 'fab', label: 'Fabrication', weight: 40 },
      { id: 'rts', label: 'Ready to ship', weight: 15 },
      { id: 'onsite', label: 'On site', weight: 25 },
    ],
    stageHints: [
      'po', 'process po', 'po unprice', 'final po', 'rts', 'ready to ship',
      'material on site', 'fat', 'manufacturing process', 'delivery',
    ],
    kindHints: ['po', 'purchase', 'procurement', 'material', 'supply', 'fabrication', 'manufacturing', 'delivery', 'vendor'],
  },
  {
    id: 'construction',
    label: 'Construction',
    steps: [
      { id: 'material', label: 'Material on site', weight: 15 },
      { id: 'install', label: 'Installation', weight: 50 },
      { id: 'connect', label: 'Connections', weight: 25 },
      { id: 'qc', label: 'QC inspection', weight: 10 },
    ],
    stageHints: ['material on site', 'qc inspection', 'inspection', 'connections'],
    kindHints: ['installation', 'install', 'instalasi', 'dismantle', 'erection', 'civil', 'piping', 'structure', 'tie in', 'tie-in', 'cabling', 'electrical', 'mechanical'],
  },
  {
    id: 'commissioning',
    label: 'Commissioning',
    steps: [
      { id: 'precomm', label: 'Pre-commissioning', weight: 25 },
      { id: 'function', label: 'Energize & function test', weight: 35 },
      { id: 'startup', label: 'Start up', weight: 20 },
      { id: 'running', label: 'Running test', weight: 20 },
    ],
    stageHints: ['pre commissioning', 'start up', 'running test', 'function test', 'energize'],
    kindHints: ['commissioning', 'pre commissioning', 'start up', 'startup', 'running test', 'function test', 'performance test', 'energize'],
  },
];

/**
 * One spelling for a name, so eighteen rows called "PO Unprice" are one decision.
 *
 * Lowercased, punctuation dropped, runs of whitespace collapsed. Deliberately
 * NOT stemmed: two different words that happen to share a stem are two different
 * rows, and a wrong merge here silently retypes somebody else's work.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether this row carries the whole ladder or is one rung of it.
 *
 * A row NAMED after a rung is that rung: "Material On Site" is not 40% done, it
 * has either happened or it has not. A row named after a system climbs. Quote is
 * never guessed, only chosen: an app cannot tell from a name whose number it is.
 */
export function shapeOf(name: string, kind: WorkKind): Shape {
  const n = normalizeName(name);
  for (const hint of kind.stageHints) {
    if (n === hint || n.startsWith(hint + ' ')) return 'gate';
  }
  for (const step of kind.steps) {
    if (n === normalizeName(step.label)) return 'gate';
  }
  return 'steps';
}

/**
 * The app's opening offer, shown for correction and never applied in silence.
 *
 * Returns null rather than guessing when nothing matches. A wrong guess costs
 * more than no guess: no guess asks a question, a wrong guess writes an answer.
 */
export function guessWorkKind(
  name: string,
  kinds: WorkKind[]
): { kindId: string; shape: Shape } | null {
  const n = normalizeName(name);
  let best: { kindId: string; shape: Shape; score: number } | null = null;

  for (const kind of kinds) {
    let score = 0;
    for (const hint of kind.stageHints) {
      if (n === hint) score = Math.max(score, 100);
      else if (n.startsWith(hint + ' ')) score = Math.max(score, 80);
    }
    for (const hint of kind.kindHints) {
      if (n === hint) score = Math.max(score, 70);
      else if (n.includes(hint)) score = Math.max(score, 40 + hint.length);
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { kindId: kind.id, shape: shapeOf(name, kind), score };
    }
  }

  return best ? { kindId: best.kindId, shape: best.shape } : null;
}

/**
 * What the user already decided for a row spelled the same way.
 *
 * This beats any built-in guess, and it is what makes setting a project up stop
 * feeling like setting a project up: correcting "PO Unprice" once answers the
 * other seventeen.
 */
export function suggestFromPeers(
  name: string,
  peers: Array<{ name: string; kindId: string; shape: Shape }>
): { kindId: string; shape: Shape } | null {
  const n = normalizeName(name);
  const hit = peers.find((p) => normalizeName(p.name) === n);
  return hit ? { kindId: hit.kindId, shape: hit.shape } : null;
}

/**
 * A gate is a ladder with one rung.
 *
 * Which is why this feature needs no new progress method: `milestone` already
 * stores a ladder, `lib/progress.ts` already computes one, and a single rung
 * worth 100 lands on exactly 0 or exactly 100. The only thing that differs is
 * what the screen draws.
 */
export function gateLadder(label: string): Milestone[] {
  return [{ id: 'done', label, weight: 100 }];
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind.ts
```

Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add lib/work-kind.ts scripts/verify-work-kind.ts
git commit -m "A row is asked what kind of work it is, once"
```

---

## Task 2: The two columns

**Files:**
- Modify: `lib/schema.ts:218` (`wbsNodes`), `lib/schema.ts` (`leafProgress`)
- Modify: `lib/db-snapshot.ts:202` (`EXPECTED_COLUMNS`)
- Modify: `scripts/verify-ensure-schema.ts`
- Create: `data/migrations/<generated>.sql`

**Interfaces:**
- Produces: `wbs_nodes.work_kind` (text, nullable), `leaf_progress.source` (text, nullable)

Nothing else in the plan may add a column without appending it to `EXPECTED_COLUMNS` in the same task, because a deployment restores its schema from the blob snapshot and never runs a migration.

- [ ] **Step 1: Extend the schema-repair test first**

In `scripts/verify-ensure-schema.ts`, find the list of columns it asserts are restored and add the two new ones alongside `projects.alias`. It already proves that a file arriving from the store is repaired; this only widens what it expects. Run it and watch it fail:

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-ensure-schema.ts
```

Expected: FAIL naming `wbs_nodes.work_kind`.

- [ ] **Step 2: Add the columns to `lib/schema.ts`**

In `wbsNodes`, directly after `linkedStage`:

```ts
  /**
   * Which kind of work this row is, and therefore which question it is asked.
   * Null means nobody has answered yet, which is what makes the panel ask.
   * See `lib/work-kind.ts`.
   */
  workKind: text('work_kind'),
```

In `leafProgress`, after `note`:

```ts
  /**
   * How this week's figure was arrived at: 'gate' | 'steps' | 'quote' | 'manual'.
   *
   * Gate and steps are also readable from the method, but quote and manual are
   * both lumpsum and are not the same claim at all: one is somebody else's
   * measurement, the other is this person's judgement. A report cannot say how
   * much of it was judged unless the two are told apart here.
   */
  source: text('source'),
```

- [ ] **Step 3: Append to `EXPECTED_COLUMNS`**

`lib/db-snapshot.ts:202`:

```ts
const EXPECTED_COLUMNS: Array<{ table: string; column: string; decl: string }> = [
  { table: 'projects', column: 'alias', decl: 'text' },
  { table: 'projects', column: 'current_week', decl: 'integer' },
  { table: 'wbs_nodes', column: 'work_kind', decl: 'text' },
  { table: 'leaf_progress', column: 'source', decl: 'text' },
];
```

- [ ] **Step 4: Generate and apply the migration, then check the children survived**

```bash
cp data/report.db data/report.db.bak
node -e "const D=require('better-sqlite3');const d=new D('data/report.db');console.log('before',d.prepare('select count(*) c from doc_stages').get(),d.prepare('select count(*) c from wbs_nodes').get())"
npx drizzle-kit generate
npx drizzle-kit migrate
node -e "const D=require('better-sqlite3');const d=new D('data/report.db');console.log('after',d.prepare('select count(*) c from doc_stages').get(),d.prepare('select count(*) c from wbs_nodes').get())"
```

Both counts must be identical. A drizzle migration that rebuilds a table instead of altering it cascades its DROP through a transaction where `PRAGMA foreign_keys=OFF` is a no-op, and has already eaten 357 `doc_stages` rows once. If the generated SQL contains `DROP TABLE`, stop and hand-edit it to a plain `ALTER TABLE ... ADD COLUMN`.

- [ ] **Step 5: Migrate the tracked seed and CHECKPOINT it**

```bash
REPORT_DB_PATH=data/seed.db npx drizzle-kit migrate
node -e "new (require('better-sqlite3'))('data/seed.db').pragma('wal_checkpoint(TRUNCATE)')"
git status --short data/seed.db
```

`data/seed.db` must show as modified. Without the checkpoint the write stays in `seed.db-wal` and git reports no change at all, and a deployment with no blob store attached opens that untouched file directly.

- [ ] **Step 6: Run the schema test to verify it passes**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-ensure-schema.ts
```

Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add lib/schema.ts lib/db-snapshot.ts scripts/verify-ensure-schema.ts data/migrations data/seed.db
git commit -m "Two columns: what kind of work, and how the figure was arrived at"
rm data/report.db.bak
```

---

## Task 3: Applying a kind, and measuring what it moves

**Files:**
- Create: `lib/work-kind-apply.ts`
- Modify: `lib/mutations.ts:419-431` (the milestone branch of `applyProgressMethod`)
- Modify: `lib/progress-sqlite.ts:340-352` (its sqlite twin)
- Test: `scripts/verify-work-kind-apply.ts`

**Before anything else, fix the rule this task has to agree with.**
`applyProgressMethod` means to award rungs *in order until* the next would
exceed what was reported. Its comment says so; its loop does not stop, so after
one rung is missed it keeps testing the ones after it and awards whichever is
cheap enough. On a 15/50/25/10 ladder a row at 57.5% becomes *material ✓,
connections ✓, QC inspection ✓, installation ✗*: a QC pass on something not yet
installed. It has never run in anger because `milestones` holds zero rows, and
it must not be the first thing that does. The whole difference is measurable: on
Gundih week 60 the broken rule moves 0.54 points over 13 rows, the correct rule
moves 1.01 points over 25.

**Interfaces:**
- Consumes: `BUILT_IN_KINDS`, `Shape`, `gateLadder` from `lib/work-kind.ts`; `milestoneProgress` from `lib/progress.ts`; `Milestone` from `lib/types.ts`
- Produces:
  - `interface KindTarget { id: string; name: string; bobot: number; pct: number }`
  - `interface KindChange { id: string; fromPct: number; toPct: number; milestones: Milestone[]; done: string[] }`
  - `function ladderFor(kindId: string, shape: Shape, rowName: string, kinds: WorkKind[]): Milestone[]`
  - `function changeFor(row: KindTarget, milestones: Milestone[]): KindChange`
  - `function impactOf(changes: KindChange[]): { movedRows: number; pointsDelta: number }`

- [ ] **Step 1: Stop the loop in both writers**

`lib/mutations.ts`, the `method === 'milestone'` branch, and the matching block
in `lib/progress-sqlite.ts`. One added line each:

```ts
      for (const m of ms) {
        if (((acc + m.weight) / totalW) * 100 <= pct + 1e-9) {
          acc += m.weight;
          done.push(m.id);
        } else break; // a ladder is climbed in order; a rung missed ends the climb
      }
```

Update the comment above it from "Award milestones in order until their
cumulative weight would exceed" to state the stop explicitly, since the old
wording was accurate about the intent and the code is what drifted.

- [ ] **Step 2: Write the failing test**

Create `scripts/verify-work-kind-apply.ts`:

```ts
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
```

- [ ] **Step 3: Run it to verify it fails**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind-apply.ts
```

Expected: fails to resolve `../lib/work-kind-apply.ts`.

- [ ] **Step 4: Write `lib/work-kind-apply.ts`**

```ts
import { milestoneProgress } from './progress';
import type { Milestone } from './types';
import { gateLadder, type Shape, type WorkKind } from './work-kind';

/**
 * Turning a work kind into stored rungs, and saying out loud what that costs.
 *
 * Changing how you measure must not change what was measured, and this module is
 * where that promise is kept honest. It cannot be kept perfectly: a row reported
 * at 57.5% against a 15/50/25/10 ladder is not on any rung, and the only honest
 * restatement is the rung below it. So the figure moves, and because it moves the
 * app must SAY SO BEFORE it happens rather than afterwards. That is the whole
 * reason `impactOf` exists and why nothing here writes anything.
 */

export interface KindTarget {
  id: string;
  name: string;
  /** Share of the whole project, 0..100. */
  bobot: number;
  /** Where the row stands today, in its own percent. */
  pct: number;
}

export interface KindChange {
  id: string;
  fromPct: number;
  toPct: number;
  /** Share of the whole project, carried so an impact can be weighted without a second lookup. */
  bobot: number;
  milestones: Milestone[];
  /** Ids of the rungs awarded by the restatement. */
  done: string[];
}

/** The rungs a row gets. A gate is one rung carrying the row's own name. */
export function ladderFor(
  kindId: string,
  shape: Shape,
  rowName: string,
  kinds: WorkKind[]
): Milestone[] {
  if (shape === 'gate') return gateLadder(rowName);
  if (shape === 'quote') return [];
  const kind = kinds.find((k) => k.id === kindId);
  return kind ? kind.steps.map((s) => ({ ...s })) : [];
}

/**
 * What a row becomes, without becoming it.
 *
 * Rungs are awarded in order while the running total stays at or below what was
 * already reported. Never more generous than the number it came from, which is
 * the same rule `applyProgressMethod` applies when a method changes, stated here
 * so a preview and an apply cannot drift apart.
 */
export function changeFor(row: KindTarget, milestones: Milestone[]): KindChange {
  const pct = Math.max(0, Math.min(100, row.pct));
  if (milestones.length === 0) {
    return { id: row.id, fromPct: pct, toPct: pct, bobot: row.bobot, milestones, done: [] };
  }
  const total = milestones.reduce((s, m) => s + m.weight, 0) || 1;
  const done: string[] = [];
  let acc = 0;
  for (const m of milestones) {
    if (((acc + m.weight) / total) * 100 <= pct + 1e-9) {
      acc += m.weight;
      done.push(m.id);
    }
  }
  return {
    id: row.id,
    fromPct: pct,
    toPct: milestoneProgress(milestones, done),
    bobot: row.bobot,
    milestones,
    done,
  };
}

/**
 * What a bulk apply would do to the project total, in the project's own points.
 *
 * Reported, never corrected. The figures stand; the screen says how far they
 * will move and the person decides. Measured on Gundih week 60 across every
 * decision in the spec, this comes to 1.01 points over 25 of 218 rows.
 */
export function impactOf(changes: KindChange[]): { movedRows: number; pointsDelta: number } {
  let movedRows = 0;
  let pointsDelta = 0;
  for (const c of changes) {
    if (Math.abs(c.toPct - c.fromPct) > 0.01) movedRows += 1;
    pointsDelta += ((c.toPct - c.fromPct) / 100) * c.bobot;
  }
  return { movedRows, pointsDelta };
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind-apply.ts
```

Expected: ALL PASS, exit 0.

- [ ] **Step 6: Prove the preview and the writer still agree**

`changeFor` and `applyProgressMethod` now implement the same rule in two places,
which is the kind of pair that drifts. Run the existing suite that covers the
writer, and confirm nothing it asserted has moved:

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-progress-sqlite.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-numbers.ts
```

Expected: ALL PASS on both. Neither exercises a milestone ladder today, so a
failure here means the `break` reached something it should not have.

- [ ] **Step 7: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add lib/work-kind-apply.ts scripts/verify-work-kind-apply.ts lib/mutations.ts lib/progress-sqlite.ts
git commit -m "A ladder is climbed in order, and what that costs is said first"
```

---

## Task 4: Writing a kind, on both stores

**Files:**
- Modify: `lib/types.ts` (`WbsItem`, `LeafSnapshot`)
- Modify: `lib/progress-sqlite.ts:259` (`setProgressMethodSqlite`), and its save path
- Modify: `lib/mutations.ts:321` (`applyFieldProgress`), `:372` (`applyProgressMethod`)
- Modify: `lib/actions.ts:271` (add `setWorkKindAction`)

**Interfaces:**
- Consumes: `ladderFor` from `lib/work-kind-apply.ts`; `BUILT_IN_KINDS`, `Shape` from `lib/work-kind.ts`
- Produces:
  - `async function setWorkKindAction(leafId: string, rowName: string, kindId: string, shape: Shape, steps?: Milestone[]): Promise<ActionResult>`
  - `LeafSnapshot.note?: string`, `LeafSnapshot.source?: 'gate' | 'steps' | 'quote' | 'manual'`
  - `WbsItem.workKind?: string | null`

- [ ] **Step 1: Add the fields to `lib/types.ts`**

In `WbsItem`, beside `progressMethod`:

```ts
  /** Which kind of work this row is. See `lib/work-kind.ts`. Null until asked. */
  workKind?: string | null;
```

In `LeafSnapshot`, after `milestonesDone`:

```ts
  /** Free text the person recorded beside the figure, e.g. a vendor's report reference. */
  note?: string;
  /** How the figure was arrived at. 'quote' and 'manual' are both lumpsum and are not the same claim. */
  source?: 'gate' | 'steps' | 'quote' | 'manual';
```

- [ ] **Step 2: Add `setWorkKindAction` to `lib/actions.ts`**

Directly below `setProgressMethodAction` (which it mirrors, including the sqlite / db.json fork):

```ts
/**
 * `rowName` is passed in rather than looked up. The panel already holds
 * `node.name`, and adding a database read to an action that does not need one
 * is how a clock or an uncached read creeps into a path that must stay cheap.
 */
export async function setWorkKindAction(
  leafId: string,
  rowName: string,
  kindId: string,
  shape: Shape,
  steps?: Milestone[]
): Promise<ActionResult> {
  // A quote and a hand-typed percent are both lumpsum; a gate and a ladder are
  // both milestone. The kind decides the question, the shape decides the method.
  const method: ProgressMethod = shape === 'quote' ? 'lumpsum' : 'milestone';
  const milestones = steps ?? ladderFor(kindId, shape, rowName, BUILT_IN_KINDS);

  const projectId = await sqliteProject();
  if (projectId) return sqliteWrite(() => setWorkKindSqlite(leafId, kindId, method, milestones));
  try {
    await mutateDb((db) => {
      applyProgressMethod(db, leafId, method, { milestones });
      const item = db.wbsItems.find((i) => i.id === leafId);
      if (item) item.workKind = kindId;
    });
    updateTag('db');
    refresh();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
```

A `quote` row gets an empty `milestones` array from `ladderFor`, which
`applyProgressMethod` handles already: the `lumpsum` branch clears both
`qtyDone` and `milestonesDone` and leaves `cumProgressPct` exactly as it was.

- [ ] **Step 3: Write the kind on the sqlite side**

In `lib/progress-sqlite.ts`, add `setWorkKindSqlite` next to `setProgressMethodSqlite`. It does what `setProgressMethodSqlite` does, plus one field, and reuses the same transaction shape so the "switching clears the other method's evidence" rule keeps holding:

```ts
export function setWorkKindSqlite(
  nodeId: string,
  kindId: string,
  method: ProgressMethod,
  milestones: Milestone[]
): void {
  setProgressMethodSqlite(nodeId, method, { milestones });
  db.update(schema.wbsNodes)
    .set({ workKind: kindId })
    .where(eq(schema.wbsNodes.id, nodeId))
    .run();
}
```

- [ ] **Step 4: Persist `note` and `source` on save**

`leaf_progress.note` has existed since the table was created and nothing has ever written to it. In `lib/progress-sqlite.ts`'s save path (`applyFieldProgressSqlite`, around `:192`) and in `lib/mutations.ts:321` (`applyFieldProgress`), accept `note` and `source` on the update payload and carry them onto the row exactly as `qtyDone` and `milestonesDone` are carried. Do not recompute anything: `syncLeafSnapshot` still owns `cumProgressPct`.

- [ ] **Step 5: Prove a round trip against a throwaway database**

Extend `scripts/verify-progress-sqlite.ts` with a case that sets a work kind on a leaf, reads it back, and asserts the leaf's percent is unchanged by the switch. Build the fixture with `copyDbFixture` from `scripts/db-fixture.ts`, never `fs.copyFileSync`, because recent writes live in `report.db-wal` and a file copy silently copies the past.

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-progress-sqlite.ts
```

Expected: ALL PASS, including the new case.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add lib/types.ts lib/actions.ts lib/progress-sqlite.ts lib/mutations.ts scripts/verify-progress-sqlite.ts
git commit -m "A kind reaches both stores, and the note column finally has a writer"
```

---

## Task 5: Carrying the kind to the screen

**Files:**
- Modify: `lib/overall-map.ts:245` (`leafDetail`), and the `MapNode` interface at `:83`
- Modify: `scripts/verify-overall-map.ts`

**Interfaces:**
- Produces: `MapNode.workKind?: string | null`, `MapNode.note?: string | null`, `MapNode.source?: string | null`

- [ ] **Step 1: Extend the map test first**

In `scripts/verify-overall-map.ts`, add a case asserting that a leaf's `workKind`, `note` and `source` arrive on the node unchanged and that `buildOverallMap` still computes no percentage of its own. Run it and watch the new case fail.

- [ ] **Step 2: Add the fields**

In the `/* leaf only */` block of the `MapNode` interface, beside `method`:

```ts
  /** Which kind of work this row is, or null if nobody has been asked yet. */
  workKind?: string | null;
  /** What the person recorded beside this week's figure. */
  note?: string | null;
  /** How this week's figure was arrived at. */
  source?: string | null;
```

Then carry them through `leafDetail`. **Carry only.** `lib/overall-map.ts` computes nothing, and a screen with its own opinion is how a report ends up disagreeing with the site.

- [ ] **Step 3: Run the map test**

```bash
node --import ./scripts/ts-resolve.mjs scripts/verify-overall-map.ts
```

Expected: ALL PASS.

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add lib/overall-map.ts scripts/verify-overall-map.ts
git commit -m "The map carries the kind, and still computes nothing"
```

---

## Task 6: The four questions

**Files:**
- Create: `components/weekly/ProgressEntry.tsx`
- Modify: `components/weekly/ActivityPanel.tsx:317-325`

**Interfaces:**
- Consumes: `Draft` and `Shape`; `MapNode` from `lib/overall-map.ts`
- Produces: `function ProgressEntry({ node, draft, setDraft, shape, manual, onManual }): JSX.Element`

`ActivityPanel.tsx` is 827 lines before this task. The three entry forms move out with it, so the panel keeps being the panel and this file keeps being the question.

- [ ] **Step 1: Create `components/weekly/ProgressEntry.tsx`**

Four forms, chosen by shape. No Radix anywhere in this file: it renders inside a panel that can be opened from a list, and the rule is per screen, never per row.

**Gate** — one control, not a checklist:

```tsx
<button
  type="button"
  onClick={() => toggle()}
  aria-pressed={isDone}
  className="flex min-h-14 w-full items-center justify-between rounded-2xl border px-4 text-left transition-colors duration-200 ease-ios"
>
  <span className="text-[15px] font-medium">{node.name}</span>
  <span className="text-sm font-semibold">{isDone ? 'Done' : 'Not yet'}</span>
</button>
```

Plus a native `<input type="date">` labelled `When`, written into `draft.note` as `on <date>` when set. Do not mount a `DateField`: that hand-rolled primitive belongs to the planner and carries its own calendar.

**Steps** — the existing `MilestoneEntry` moved across unchanged, then relabelled from "steps done" to "How far has it got?".

**Quote** — a number, a date and a source, all native inputs:

```tsx
<p className="text-[13px] text-muted-foreground">What did the latest report say?</p>
// number input bound to draft.pct
// <input type="date"> bound to the report's own date, not today
// <input type="text" placeholder="Who reported it"> bound to draft.note
```

**Manual** — `PercentEntry` exactly as it stands today, slider included, with its comment preserved.

- [ ] **Step 2: Keep manual reachable from every shape**

Below whichever form is showing, one always-present control:

```tsx
<button type="button" onClick={onManual} className="mt-3 min-h-11 w-full rounded-xl text-sm text-muted-foreground">
  Type a percent instead
</button>
```

Pressing it swaps the form for `PercentEntry` for this save only and sets `draft.source = 'manual'`. It does not change the row's kind: a one-off override is not a decision about what the row is.

- [ ] **Step 3: Render it from `ActivityPanel`**

Replace `ActivityPanel.tsx:317-325` (the three-way `node.method` conditional) with a single `<ProgressEntry … />`. Keep the `pct` readout and the plan sentence beneath it exactly where they are.

- [ ] **Step 4: Look at it, at both widths**

```bash
node scripts/shoot.mjs "http://localhost:3000/weekly/32/overall" /tmp/entry-desktop.png
node scripts/shoot.mjs "http://localhost:3000/weekly/32/overall" /tmp/entry-390.png 390 844
```

Open both images and actually look. Extracted text shows content, never composition. Check: no control shorter than 44px, no horizontal scroll at 390px, the row name in the gate button not truncated to three characters.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add components/weekly/ProgressEntry.tsx components/weekly/ActivityPanel.tsx
git commit -m "Four questions, and none of them is how many percent"
```

---

## Task 7: Asking once, and the answer that answers eighteen rows

**Files:**
- Create: `components/weekly/WorkKindPicker.tsx`
- Modify: `components/weekly/ActivityPanel.tsx` (render the picker when `node.workKind` is null)

**Interfaces:**
- Consumes: `BUILT_IN_KINDS`, `guessWorkKind`, `suggestFromPeers` from `lib/work-kind.ts`; `setWorkKindAction` from `lib/actions.ts`
- Produces: `function WorkKindPicker({ node, peers, onDone }): JSX.Element`

- [ ] **Step 1: Build the picker**

Four kind buttons, `min-h-14`, in a two-column grid. Above them, the suggestion, shown as a sentence and never pre-applied:

```
Looks like Procurement, same as "PO Unprice" and 17 other rows.
```

The peer count is computed from `peers` with `normalizeName`, and the sentence falls back to the built-in guess when no peer matches. When neither produces anything, the picker simply shows the four buttons with no claim above them, because no guess is better than a wrong one.

Below the kinds, one row of three shape buttons (`One-off`, `Stages`, `Quoted`) pre-selected from the guess, so a wrong shape is one tap to fix rather than a trip into a submenu.

- [ ] **Step 2: Show it in the panel when the kind is unknown**

In `ActivityPanel`, when `node.workKind` is null, `WorkKindPicker` takes the place of `ProgressEntry`. After it saves, the panel shows the question for the kind just chosen, in the same open panel. Do not close and reopen: the person came to fill something in.

- [ ] **Step 3: Confirm one correction carries**

With the dev server running, open a Gundih row named `PO Unprice`, answer it, then open a different row with the same name and confirm the sentence names the first one. Capture it:

```bash
node scripts/shoot.mjs "http://localhost:3000/weekly/32/overall" /tmp/picker-390.png 390 844
```

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add components/weekly/WorkKindPicker.tsx components/weekly/ActivityPanel.tsx
git commit -m "Asked once, and the answer answers seventeen more"
```

---

## Task 8: What an answer means, and what a report admits

**Files:**
- Modify: `components/weekly/ProgressEntry.tsx` (the translation sentence)
- Modify: `components/weekly/WeekChecks.tsx` (the admission)

- [ ] **Step 1: Translate every answer into plan terms**

Under the figure in `ProgressEntry`, replace the current single plan sentence with three short lines. All three are already in props: `node.actualPct`, `node.planPct`, `node.weekPct`, `node.weight`. Last week is `node.actualPct - node.weekPct`. No new query, no new prop.

```
Up 7.5 points to 57.5%
Plan says 62.5 this week, so 5.0 behind
This row carries 0.31 points of the project
```

Use `fmt1` / `fmt2` as the file already does. No em dash.

- [ ] **Step 2: Let the week say how much of it was judged**

In `WeekChecks.tsx`, add one line counting rows saved with `source === 'manual'` this week, phrased as a fact and not a warning:

```
4 of 31 figures were typed by hand
```

It links to those rows. It does not block anything, it is not red, and it never scolds. Reported, never corrected, which is the same stance the app takes toward a heading handed out at 140%.

- [ ] **Step 3: Look at both screens**

```bash
node scripts/shoot.mjs "http://localhost:3000/weekly/32/overall" /tmp/final-390.png 390 844
node scripts/shoot.mjs "http://localhost:3000/weekly/32/check" /tmp/check-390.png 390 844
```

- [ ] **Step 4: Run every verify script and build**

```bash
for s in work-kind work-kind-apply overall-map progress-sqlite ensure-schema plan-curve; do
  echo "--- $s"; node --import ./scripts/ts-resolve.mjs scripts/verify-$s.ts || echo "FAILED $s";
done
npx next build > /tmp/build.log 2>&1; echo $?
tail -20 /tmp/build.log
```

The build must exit 0. Both build failures in this feature area's history were build-time only, so a passing dev server proves nothing.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add components/weekly/ProgressEntry.tsx components/weekly/WeekChecks.tsx
git commit -m "Every answer says what it did to the plan, and the week says how much of it was judged"
```

---

## Self-review notes

**Spec coverage.** Decision 1 (ask the kind) is Task 7. Decision 2 (ladders per kind) is Task 1. Decision 3 (three shapes) is Tasks 1 and 6. Decision 4 (asked once) is Tasks 2, 4 and 7. Decision 5 (the app remembers) is `suggestFromPeers`, Tasks 1 and 7. Decision 6 (translated into plan terms) is Task 8 Step 1. Decision 7 (origin recorded) is Task 4 Step 4 and Task 8 Step 2. Decision 8 (manual never closed) is Task 6 Step 2. The bulk apply with impact preview is Task 3's arithmetic; **its screen is deliberately not in this plan** and is the first thing to add once the per-row path is proven in use, because a bulk tool for a question nobody has answered yet has nothing to apply.

**One defect fixed along the way.** `applyProgressMethod`'s loop never stopped,
so a restatement could award a later cheap rung after skipping an earlier
expensive one. Task 3 Step 1 fixes it in both writers before anything writes a
ladder for the first time, and Task 3's test asserts the stop directly. It is
listed here because it is a behaviour change to existing code that this plan did
not set out to make: it moves the measured impact from 0.54 points to 1.01.

**One spec deviation, deliberate.** The spec writes ladder labels in Indonesian. AGENTS.md locks the app to English and leaves only `/print/*` in Indonesian, so the built-in labels ship as English and the spec's Indonesian is read as the intent rather than the copy.
