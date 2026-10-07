# Projects: links and an explaining Gantt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Links between activities (after it finishes / after it starts / finishes after it finishes, with a wait of 0+ days) are made and stored in Projects, checked against the typed plan, drawn on the Gantt with the reason for each date, and read by the forecast; plus "Lock as contract".

**Architecture:** One pure module (`lib/links.ts`) owns the link shape and its parser. `lib/chains.ts` grows one pure network analysis (`analyseNetwork`, `wouldLoop`, `conflictMoves`, `whySentence`) that the server (`getSheet`, `validateWeek`) and the client (planner, Gantt, panel) both call, so screen and server cannot disagree. Writes go through one non-`'use server'` module (`lib/links-sqlite.ts`, callable from node scripts) wrapped by thin server actions. No schema change: links stay in `wbs_nodes.waits_for`; the contract uses the existing `baselines` / `node_schedules`.

**Tech Stack:** Next 16 (cacheComponents), React 19, better-sqlite3 + drizzle, framer-motion, Tailwind/shadcn. Verify scripts run with `node --import ./scripts/ts-resolve.mjs scripts/<name>.ts` and print PASS/FAIL lines, exiting non-zero on any failure.

**Spec:** `docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md` — read it first; every task argues from it.

## Global Constraints

- No scheduler jargon in any visible string. On screen only: "After it finishes" / "After it starts" / "Finishes after it finishes", "Wait N days", "Can slip N days", "Sets the project finish", "Sets the date", "Waits for" / "Holds up". FS/SS/FF, lag, float, critical, driving, predecessor, successor live in code and comments only.
- App copy is English; no em dash (—) in any visible string; capital first letter on each label segment.
- Wait is an integer, 0 ≤ wait ≤ 3650. No start-to-finish, no negative wait.
- Calendar days, inclusive dates (`dur = finish − start + 1`), ISO `YYYY-MM-DD`.
- Plan dates never move without a press. Nothing ever moves a date EARLIER on its own.
- No schema change, no migration, no new table. `wbs_nodes` / `node_schedules` ids have NO default: every insert supplies one (`randomUUID()` from `node:crypto`).
- Inside any `.map()` that can exceed ~20 rows: native `<input>` / `<select>`, no Radix.
- `/print/*`, Data Overall's screen, reports and exports are not touched.
- UI is verified by pressing and looking: `node scripts/shoot.mjs <url> <out.png> [w] [h]` at 1440×900 and 390×844, open the PNG and look; press controls (puppeteer from the scratchpad: `createRequire('E:/Figtries/Prototype/Report/package.json')('puppeteer-core')`) and assert state before/after and after a reload. The Browser pane cannot screenshot here.
- Merbau (`pdemo-merbau`) is local demo data. Use it to look and press; never commit `data/` changes; reset it afterwards with `node --import ./scripts/ts-resolve.mjs scripts/seed-demo.ts`.
- Type-check with a scratch tsconfig that extends the project one and includes only `app/**`, `components/**`, `lib/**`, `types/**`, `next-env.d.ts` (other sessions' `.next*` types produce phantom errors).
- `npx next build > build.log 2>&1; echo $?` before any push. Never push without the user's yes.

## Performance budget (the user's condition: "smooth, ringan, mewah walaupun fiturnya banyak")

Measured, never assumed, on a PRODUCTION build (`set NEXT_DIST_DIR=.next-verify&& npx next build`, then `preview_start` `prod-verify` on :3211), phone profile (390×844, 4× CPU) unless noted, with `scripts/verify-projects-perf.mjs` (Task 0). Task 0 records the baseline in this file; Tasks 7, 9, 10 and 12 re-run it and must stay inside:

| Measure | Budget |
|---|---|
| Press ⋯ → row panel on screen | ≤ 150 ms, and ≤ baseline + 20% |
| Press "Links: …" → Links panel on screen | ≤ 150 ms |
| Planner scroll, 10 steps | no long task > 100 ms; total long-task time ≤ baseline + 50 ms |
| Desktop (1440, 1× CPU) bar-end drag, 60 pointer moves | no long task > 50 ms |
| LCP of `/projects/pdemo-merbau` | ≤ baseline + 10% |
| JS the page loads (`jsKB`, encoded, resource timing — Next 16 prints no First Load JS) | ≤ baseline + 15 kB |
| `analyseNetwork` on 300 rows / 300 links (node) | ≤ 2 ms average over 100 runs |

How it stays inside, by construction:
- `LinksPanel` and `LinkDragCard` load through `next/dynamic` each inside its own `<Suspense fallback={null}>` (AGENTS "Lazy-load the overlays"; a dynamic overlay without its own boundary flashed the week bar to skeleton on 4 Oct 2026).
- EPC suggestions are fetched by a GET route only when a never-asked row's Links panel opens; the page itself computes nothing extra. The date-chain guesses show at once; EPC ones join when they arrive.
- The arrow layer is one memoised SVG (`useMemo` on network, visible rows, scale, selection); hover never re-renders it.
- A drag moves its dashed line by writing the SVG path's `d` through a ref inside `requestAnimationFrame` — no React state per pointer move. React state changes only on press and release.
- Motion is the app's one curve (`--ease-ios`, `MOTION` in `lib/design.ts`): arrows fade with `transition-opacity duration-200`, the pressed arrows thicken with `transition-[stroke-width,opacity]`. Nothing animates layout, nothing pops in after hydration (entrance is CSS, per AGENTS).
- "Mewah" means quiet and exact, not decorated: hairline arrows, one red for what matters, tabular figures, generous spacing, no spinner that appears for less than 300 ms.

---

### Task 0: Measure the page as it is now

**Files:**
- Create: `scripts/verify-projects-perf.mjs`

- [ ] **Step 1: Write the probe**

```js
/**
 * How the Projects page feels: press, scroll, drag and load, measured from
 * INSIDE the page, on a production build. Budget and baseline live in
 * docs/superpowers/plans/2026-10-07-projects-links-gantt.md.
 *
 * Usage: node scripts/verify-projects-perf.mjs [baseUrl] [projectId]
 */
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const base = process.argv[2] ?? 'http://localhost:3211';
const project = process.argv[3] ?? 'pdemo-merbau';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await puppeteer.launch({ executablePath: exe, headless: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

async function open(phone) {
  const page = await browser.newPage();
  await page.setViewport(phone ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1440, height: 900 });
  const cdp = await page.createCDPSession();
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.evaluateOnNewDocument(() => {
    window.__long = [];
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: true });
    window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  await page.goto(`${base}/projects/${project}`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await sleep(1500);
  return page;
}

/** Press, then time until `text` is on screen, from inside the page. */
async function pressUntil(page, selector, text) {
  return page.evaluate(
    (selector, text) =>
      new Promise((resolve) => {
        const el = document.querySelector(selector);
        if (!el) return resolve(null);
        const t0 = performance.now();
        const done = () => document.body.innerText.includes(text);
        const mo = new MutationObserver(() => {
          if (done()) {
            mo.disconnect();
            requestAnimationFrame(() => resolve(Math.round(performance.now() - t0)));
          }
        });
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        el.click();
        setTimeout(() => { mo.disconnect(); resolve(null); }, 5000);
      }),
    selector,
    text
  );
}

// Phone: load, scroll, press.
{
  const page = await open(true);
  out.lcp = Math.round(await page.evaluate(() => window.__lcp));
  await page.evaluate(() => (window.__long = []));
  await page.evaluate(async () => {
    const scrollers = [...document.querySelectorAll('main *')].filter((e) => e.scrollHeight > e.clientHeight + 200 && getComputedStyle(e).overflowY !== 'visible');
    const s = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
    for (let i = 0; i < 10; i += 1) {
      s.scrollBy(0, 400);
      await new Promise((r) => setTimeout(r, 120));
    }
    s.scrollTo(0, 0);
  });
  await sleep(500);
  const long = await page.evaluate(() => window.__long);
  out.scrollLongMax = Math.round(Math.max(0, ...long));
  out.scrollLongTotal = Math.round(long.reduce((a, b) => a + b, 0));
  out.pressMenu = await pressUntil(page, 'button[aria-label^="Actions for row 1.1.1"]', 'Add row below');
  out.pressLinks = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.innerText.startsWith('Links:')))
    ? await pressUntil(page, 'button[data-links-entry]', 'Waits for')
    : 'n/a (before Task 9)';
  await page.close();
}

// Desktop: a drag across the Gantt (only once handles exist, Task 10).
{
  const page = await open(false);
  const handle = await page.$('[data-link-handle="finish"]');
  if (handle) {
    const box = await handle.boundingBox();
    await page.evaluate(() => (window.__long = []));
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    for (let i = 0; i < 60; i += 1) await page.mouse.move(box.x + 4 + i * 3, box.y + 4 + i * 2);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const long = await page.evaluate(() => window.__long);
    out.dragLongMax = Math.round(Math.max(0, ...long));
  } else out.dragLongMax = 'n/a (before Task 10)';
  await page.close();
}

console.log(JSON.stringify(out, null, 2));
await browser.close();
```
  (The Links entry gets `data-links-entry` in Task 9 and each drag handle `data-link-handle="start|finish"` in Task 10; add those attributes there.)

- [ ] **Step 2: Baseline** — build and start production (`set NEXT_DIST_DIR=.next-verify&& npx next build > build-base.log 2>&1; echo $?`, then `preview_start` `prod-verify`), run `node scripts/verify-projects-perf.mjs` three times, and write the median of each figure here. Read First Load JS for `/projects/[id]` from `build-base.log`. Time `analyseNetwork` is measured from Task 2 on.

  Baseline (7 Oct 2026, prod build f3e054a, Merbau, 4 runs): LCP 1264 ms (1188-1312), jsKB 264, scroll 4000 px with long-task max 0-51 ms / total 0-51 ms, press ⋯ 38 ms (36-51). Note: next build type-checks `scripts/`, so never edit files while a build runs, and read the log for "Failed", not the exit code of a wrapper.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-projects-perf.mjs docs/superpowers/plans/2026-10-07-projects-links-gantt.md
git commit -m "Projects perf probe and its baseline"
```

---

### Task 1: The link shape and its parser

**Files:**
- Create: `lib/links.ts`
- Create: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LinkType = 'FS' | 'SS' | 'FF';
  export interface StoredLink { id: string; type: LinkType; wait: number }
  export const LINK_TYPES: readonly LinkType[];
  export const WAY_LABEL: Record<LinkType, string>;
  export const MAX_WAIT: number; // 3650
  export function cleanLink(x: unknown): StoredLink | null;
  export function parseLinks(raw: string | null | undefined): StoredLink[] | null;
  export function serializeLinks(links: StoredLink[]): string;
  ```

- [ ] **Step 1: Write the failing test** — create `scripts/verify-schedule-logic.ts` (later tasks append sections above the final block; the fixture lines at the top are used from Task 3 on):

```ts
/**
 * Proves the link model and the network analysis behind Projects' links and
 * Gantt (spec: docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md).
 *
 * Writes go to a COPY of data/report.db (see scripts/db-fixture.ts).
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const fixture = path.join(os.tmpdir(), `schedule-logic-${Date.now()}.db`);
copyDbFixture(path.join(process.cwd(), 'data', 'report.db'), fixture);
process.env.REPORT_DB_PATH = fixture;

const { parseLinks, serializeLinks, cleanLink } = await import('../lib/links.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};
const j = (v: unknown) => JSON.stringify(v);

/* --------------------------------------------------------------- the shape */

check('null column means never asked', parseLinks(null) === null);
check('empty string means never asked', parseLinks('') === null);
check('malformed JSON reads as never asked, not an error', parseLinks('{oops') === null);
check('[] means waits for nothing', j(parseLinks('[]')) === '[]');
check(
  'a legacy bare id reads as after it finishes, no wait',
  j(parseLinks('["a"]')) === j([{ id: 'a', type: 'FS', wait: 0 }]),
  j(parseLinks('["a"]'))
);
check(
  'the new shape round-trips',
  j(parseLinks(serializeLinks([{ id: 'a', type: 'SS', wait: 7 }]))) === j([{ id: 'a', type: 'SS', wait: 7 }])
);
check('an unknown way is dropped', cleanLink({ id: 'a', type: 'SF', wait: 0 }) === null);
check('a negative wait is dropped', cleanLink({ id: 'a', type: 'FS', wait: -2 }) === null);
check('a fractional wait is dropped', cleanLink({ id: 'a', type: 'FS', wait: 1.5 }) === null);
check('a missing wait reads as 0', j(cleanLink({ id: 'a', type: 'FF' })) === j({ id: 'a', type: 'FF', wait: 0 }));
check(
  'duplicates keep the first',
  j(parseLinks('[{"id":"a","type":"FS","wait":1},{"id":"a","type":"SS","wait":0}]')) ===
    j([{ id: 'a', type: 'FS', wait: 1 }])
);

/* ==== later tasks append their sections ABOVE this line ==== */

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts`
Expected: error `Cannot find module '…/lib/links.ts'`.

- [ ] **Step 3: Implement `lib/links.ts`**

```ts
/**
 * One activity waiting for another: the shape stored in `wbs_nodes.waits_for`
 * on the activity that WAITS, and the one parser every reader goes through.
 *
 * Three ways, in the code's own short names (never on screen — see WAY_LABEL):
 *   FS  B starts after A finishes      B.start  ≥ A.finish + 1 + wait
 *   SS  B starts after A starts        B.start  ≥ A.start + wait
 *   FF  B finishes after A finishes    B.finish ≥ A.finish + wait
 * No start-to-finish and no negative wait (decided 7 Oct 2026, spec
 * docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md).
 *
 * NULL means nobody was asked yet (suggestions are offered); [] means "waits
 * for nothing". A bare string id is how links were stored before 7 Oct 2026
 * and reads as FS with no wait. Anything malformed reads as never asked,
 * never as an error.
 */

export type LinkType = 'FS' | 'SS' | 'FF';

export interface StoredLink {
  id: string;
  type: LinkType;
  /** Whole calendar days, 0 or more. */
  wait: number;
}

export const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF'];

/** What a person reads. The codes never reach the screen. */
export const WAY_LABEL: Record<LinkType, string> = {
  FS: 'After it finishes',
  SS: 'After it starts',
  FF: 'Finishes after it finishes',
};

export const MAX_WAIT = 3650;

export function cleanLink(x: unknown): StoredLink | null {
  if (typeof x === 'string') return x ? { id: x, type: 'FS', wait: 0 } : null;
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (!LINK_TYPES.includes(o.type as LinkType)) return null;
  const wait = o.wait === undefined ? 0 : o.wait;
  if (typeof wait !== 'number' || !Number.isInteger(wait) || wait < 0 || wait > MAX_WAIT) return null;
  return { id: o.id, type: o.type as LinkType, wait };
}

export function parseLinks(raw: string | null | undefined): StoredLink[] | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out: StoredLink[] = [];
  for (const x of v) {
    const l = cleanLink(x);
    if (!l || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out;
}

export function serializeLinks(links: StoredLink[]): string {
  return JSON.stringify(links.map((l) => ({ id: l.id, type: l.type, wait: l.wait })));
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts`
Expected: every line PASS, `all passed`.

- [ ] **Step 5: Commit**

```bash
git add lib/links.ts scripts/verify-schedule-logic.ts
git commit -m "Links: one stored shape and one parser"
```

---

### Task 2: The network analysis

**Files:**
- Modify: `lib/chains.ts` — add the network section after `inferChains`; delete the `Float` interface and `computeFloat` (Task 3 removes their only caller in the same commit series — do Task 3 Step 3 before running the type-check). Keep `inferChains`, `addDays`, `MAX_GAP`, `ChainNode`, `Link`, `ShiftRow`, `ShiftPreview`, `WeekSpan`, `weeksTouched`. `shiftPreview` is deleted in Task 8.
- Modify: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Consumes: `StoredLink`, `LinkType` from `lib/links.ts`.
- Produces (exported from `lib/chains.ts`):
  ```ts
  export interface NetNode { id: string; isLeaf: boolean; isMilestone: boolean; startDate: string | null; finishDate: string | null; links: StoredLink[] | null }
  export interface LinkState { fromId: string; toId: string; type: LinkType; wait: number; slack: number; bound: string }
  export interface RowLogic { incoming: LinkState[]; outgoing: LinkState[]; setsDateBy: string[]; conflicts: LinkState[]; reachesFinish: boolean; canSlip: number | null; setsProjectFinish: boolean; lateFinish: string | null }
  export interface Network { rows: Map<string, RowLogic>; links: LinkState[]; ignored: { fromId: string; toId: string }[]; projectFinish: string | null }
  export function analyseNetwork(nodes: NetNode[]): Network;
  export function wouldLoop(nodes: NetNode[], fromId: string, toId: string): string[] | null; // "toId waits for fromId" closes a loop? → the ids round it
  export function conflictMoves(nodes: NetNode[], fromIds: string[], names: Map<string, string>): ShiftRow[];
  export function whySentence(id: string, net: Network, nodes: Map<string, NetNode>, names: Map<string, string>): { text: string; conflict: boolean };
  ```
  `SheetRow` (Task 3) carries exactly the `NetNode` field names, so a `SheetRow[]` IS a `NetNode[]`.

- [ ] **Step 1: Append the failing tests** to `scripts/verify-schedule-logic.ts` above the marker line:

```ts
/* ------------------------------------------------------------- the network */

const { analyseNetwork, conflictMoves, whySentence, wouldLoop } = await import('../lib/chains.ts');
type NetNode = import('../lib/chains.ts').NetNode;

const node = (id: string, s: string, f: string, links: NetNode['links'] = null, extra: Partial<NetNode> = {}): NetNode => ({
  id, isLeaf: true, isMilestone: false, startDate: s, finishDate: f, links, ...extra,
});
// The session's 7-row example: A=PFD, B=H&MB (SS+7 from A), C=P&ID (FS from A),
// D=Datasheet (FS from B, starts too early), E=HAZOP (FF+6 from C), M=IFC (FS from E).
const plan: NetNode[] = [
  { id: 'S', isLeaf: false, isMilestone: false, startDate: '2026-03-09', finishDate: '2026-05-16', links: [{ id: 'A', type: 'FS', wait: 0 }] },
  node('A', '2026-03-09', '2026-04-12'),
  node('B', '2026-03-16', '2026-04-19', [{ id: 'A', type: 'SS', wait: 7 }]),
  node('C', '2026-04-13', '2026-05-10', [{ id: 'A', type: 'FS', wait: 0 }]),
  node('D', '2026-04-08', '2026-05-03', [{ id: 'B', type: 'FS', wait: 0 }]),
  node('E', '2026-04-27', '2026-05-16', [{ id: 'C', type: 'FF', wait: 6 }]),
  node('M', '2026-05-16', '2026-05-16', [{ id: 'E', type: 'FS', wait: 0 }], { isMilestone: true }),
];
const net = analyseNetwork(plan);
const r = (id: string) => net.rows.get(id)!;

check('a group row carries no links, even if stored', !net.links.some((l) => l.toId === 'S' || l.fromId === 'S'));
check('after it finishes, 0 slack, sets the date', j(r('C').setsDateBy) === j(['A']), j(r('C').incoming));
check('after it starts + 7, 0 slack, sets the date', j(r('B').setsDateBy) === j(['A']), j(r('B').incoming));
check('finishes after it finishes + 6 sets the date', j(r('E').setsDateBy) === j(['C']), j(r('E').incoming));
check('a milestone may sit on its predecessor finish day', j(r('M').setsDateBy) === j(['E']), j(r('M').incoming));
check('starting too early is a conflict of the exact size', r('D').conflicts.length === 1 && r('D').conflicts[0].slack === -12, j(r('D').conflicts));
check('the project finish is the latest leaf finish', net.projectFinish === '2026-05-16');
check(
  'the finishing chain sets the project finish',
  ['A', 'C', 'E', 'M'].every((id) => r(id).setsProjectFinish),
  j(['A', 'C', 'E', 'M'].map((id) => r(id).canSlip))
);
check('a row nothing waits for gets no figure', r('D').canSlip === null && !r('D').reachesFinish);
check('a row whose only follower does not reach the finish gets no figure', r('B').canSlip === null);

const two = analyseNetwork([
  node('P', '2026-01-01', '2026-01-10'),
  node('Q', '2026-01-05', '2026-01-10'),
  node('R', '2026-01-11', '2026-01-20', [{ id: 'P', type: 'FS', wait: 0 }, { id: 'Q', type: 'FS', wait: 0 }]),
]);
check('two predecessors can both set the date', j(two.rows.get('R')!.setsDateBy) === j(['P', 'Q']));

const branches = (wait: number) =>
  analyseNetwork([
    node('A', '2026-01-01', '2026-01-10'),
    node('B', '2026-01-11', '2026-01-30', [{ id: 'A', type: 'FS', wait: 0 }]),
    node('C', '2026-01-11', '2026-01-20', [{ id: 'A', type: 'FS', wait: 0 }]),
    node('D', '2026-01-31', '2026-02-05', [{ id: 'B', type: 'FS', wait: 0 }, { id: 'C', type: 'FS', wait }]),
  ]);
check('a branch with room can slip by its room', branches(0).rows.get('C')!.canSlip === 10, String(branches(0).rows.get('C')!.canSlip));
check('the longest branch cannot slip', branches(0).rows.get('B')!.canSlip === 0 && branches(0).rows.get('B')!.setsProjectFinish);
check('a wait eats the room', branches(4).rows.get('C')!.canSlip === 6, String(branches(4).rows.get('C')!.canSlip));

const loopNet = analyseNetwork([
  node('A', '2026-01-01', '2026-01-10', [{ id: 'C', type: 'FS', wait: 0 }]),
  node('B', '2026-01-11', '2026-01-20', [{ id: 'A', type: 'FS', wait: 0 }]),
  node('C', '2026-01-21', '2026-01-30', [{ id: 'B', type: 'FS', wait: 0 }]),
]);
check('a stored loop is ignored, one link only', loopNet.ignored.length === 1, j(loopNet.ignored));
const ab = [node('A', '2026-01-01', '2026-01-10'), node('B', '2026-01-11', '2026-01-20', [{ id: 'A', type: 'FS', wait: 0 }])];
check('wouldLoop names the way round', j(wouldLoop(ab, 'B', 'A')) === j(['B', 'A', 'B']), j(wouldLoop(ab, 'B', 'A')));
check('wouldLoop refuses itself', j(wouldLoop(ab, 'A', 'A')) === j(['A', 'A']));
check('no loop, no path', wouldLoop(ab, 'A', 'B') === null);

const names = new Map(plan.map((n) => [n.id, n.id]));
const moves = conflictMoves(plan.map((n) => (n.id === 'A' ? { ...n, finishDate: '2026-04-20' } : n)), ['A'], names);
const mv = new Map(moves.map((m) => [m.id, m]));
check('a later predecessor moves its follower by exactly the overrun', mv.get('C')?.days === 8, j(mv.get('C')));
check('the move cascades', mv.get('E')?.days === 8 && mv.get('M')?.days === 8, j(moves));
check('a follower with room is not moved', !mv.has('B'));
check('a duration is kept', mv.get('C')?.toFinish === '2026-05-18', j(mv.get('C')));
check(
  'nothing is ever moved earlier',
  conflictMoves(plan.map((n) => (n.id === 'A' ? { ...n, finishDate: '2026-04-01' } : n)), ['A'], names).length === 0
);

const nodeMap = new Map(plan.map((n) => [n.id, n]));
const why = (id: string) => whySentence(id, net, nodeMap, names);
check('why: after it finishes', why('C').text === 'Starts 13 Apr because A finishes 12 Apr.', why('C').text);
check('why: after it starts + wait', why('B').text === 'Starts 16 Mar, 7 days after A starts.', why('B').text);
check('why: finishes after it finishes + wait', why('E').text === 'Finishes 16 May, 6 days after C finishes.', why('E').text);
check('why: a conflict is red', why('D').conflict && why('D').text === 'Starts 8 Apr, before B finishes (19 Apr).', why('D').text);
check('why: no links', why('A').text === 'Not linked yet. Its dates are typed.', why('A').text);
const ss0 = analyseNetwork([node('A', '2026-01-01', '2026-01-10'), node('B', '2026-01-01', '2026-01-05', [{ id: 'A', type: 'SS', wait: 0 }])]);
check('why: after it starts, no wait', whySentence('B', ss0, new Map([['A', node('A', '2026-01-01', '2026-01-10')], ['B', node('B', '2026-01-01', '2026-01-05')]]), new Map([['A', 'A']])).text === 'Starts 1 Jan, when A starts.');
const room = analyseNetwork([node('A', '2026-01-01', '2026-01-10'), node('B', '2026-01-20', '2026-01-25', [{ id: 'A', type: 'FS', wait: 0 }])]);
check('why: room', whySentence('B', room, new Map([['A', node('A', '2026-01-01', '2026-01-10')], ['B', node('B', '2026-01-20', '2026-01-25')]]), new Map([['A', 'A']])).text === 'Starts 20 Jan; A would allow 11 Jan.');

// Budget: the planner reruns this on every date change.
const big: NetNode[] = Array.from({ length: 300 }, (_, i) =>
  node(`n${i}`, `2026-${String(1 + (i % 12)).padStart(2, '0')}-01`, `2026-${String(1 + (i % 12)).padStart(2, '0')}-20`, i ? [{ id: `n${Math.floor(i / 2)}`, type: (['FS', 'SS', 'FF'] as const)[i % 3], wait: i % 5 }] : null)
);
const t0 = performance.now();
for (let k = 0; k < 100; k += 1) analyseNetwork(big);
const avg = (performance.now() - t0) / 100;
check('analyseNetwork on 300 rows stays under 2 ms', avg < 2, `${avg.toFixed(2)} ms`);
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts`
Expected: a failure that `analyseNetwork` is not a function / not exported.

- [ ] **Step 3: Implement** — in `lib/chains.ts`, add `import type { LinkType, StoredLink } from './links';` at the top, delete the `Float` interface and `computeFloat` with their doc comments, and add after `inferChains`:

```ts
/* ---------------------------------------------------------------- network */

/**
 * The stored links, read against the TYPED plan (7 Oct 2026, spec
 * docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md).
 *
 * The plan's dates are not computed from the links: they are a promise
 * somebody typed. So no forward pass is run; each link is CHECKED. Its slack is
 * how far the waiting side sits past the bound the link sets: below zero is a
 * conflict, zero means the link is what sets that date.
 *
 * Only leaves carry links. A row with children has no dates of its own, and a
 * link on it would be a link to everything inside it.
 */
export interface NetNode {
  id: string;
  isLeaf: boolean;
  isMilestone: boolean;
  startDate: string | null;
  finishDate: string | null;
  /** This row's own `waits_for`: the links INTO it. Null = never asked. */
  links: StoredLink[] | null;
}

export interface LinkState {
  fromId: string;
  toId: string;
  type: LinkType;
  wait: number;
  /** Days the waiting side sits past `bound`; negative is a conflict. */
  slack: number;
  /** The earliest the waiting side (its start, or its finish for FF) may be. */
  bound: string;
}

export interface RowLogic {
  incoming: LinkState[];
  outgoing: LinkState[];
  /** Predecessors whose link has slack 0: they set this row's date. */
  setsDateBy: string[];
  conflicts: LinkState[];
  /** Linked, through what it holds up, to an activity that ends the project. */
  reachesFinish: boolean;
  /** Days it can slip before the project finish moves; null off the finish. */
  canSlip: number | null;
  setsProjectFinish: boolean;
  /** The latest it may finish without moving the project finish; null off it. */
  lateFinish: string | null;
}

export interface Network {
  rows: Map<string, RowLogic>;
  links: LinkState[];
  /** Links that close a loop. Ignored by everything, named by Check. */
  ignored: { fromId: string; toId: string }[];
  projectFinish: string | null;
}

type Dated = NetNode & { startDate: string; finishDate: string };

const dayNo = (iso: string) => Math.round(utc(iso) / MS_PER_DAY);
const isoOf = (day: number) => new Date(day * MS_PER_DAY).toISOString().slice(0, 10);

function scheduled(n: NetNode | undefined): n is Dated {
  return Boolean(n && n.isLeaf && n.startDate && n.finishDate);
}

/** The bound a link sets on its waiting side, and that side's day. */
function measure(a: Dated, b: Dated, type: LinkType, wait: number): { bound: number; side: number } {
  if (type === 'SS') return { bound: dayNo(a.startDate) + wait, side: dayNo(b.startDate) };
  if (type === 'FF') return { bound: dayNo(a.finishDate) + wait, side: dayNo(b.finishDate) };
  // FS. A milestone is an event at the END of its date, so a milestone that
  // waits for A may sit on A's own finish day.
  return { bound: dayNo(a.finishDate) + (b.isMilestone ? 0 : 1) + wait, side: dayNo(b.startDate) };
}

interface Edge {
  from: string;
  to: string;
  type: LinkType;
  wait: number;
}

/** Links between scheduled leaves, minus the ones that close a loop. */
function liveLinks(nodes: NetNode[]): { live: Edge[]; ignored: { fromId: string; toId: string }[] } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const candidates: Edge[] = [];
  for (const b of nodes) {
    if (!scheduled(b)) continue;
    for (const l of b.links ?? []) {
      if (l.id === b.id || !scheduled(byId.get(l.id))) continue;
      candidates.push({ from: l.id, to: b.id, type: l.type, wait: l.wait });
    }
  }
  // Edges go in in plan order then stored order; one whose target already
  // reaches its source would close a loop and is set aside. Deterministic.
  const out = new Map<string, string[]>();
  const reaches = (start: string, goal: string): boolean => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === goal) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(out.get(id) ?? []));
    }
    return false;
  };
  const live: Edge[] = [];
  const ignored: { fromId: string; toId: string }[] = [];
  for (const c of candidates) {
    if (reaches(c.to, c.from)) {
      ignored.push({ fromId: c.from, toId: c.to });
      continue;
    }
    live.push(c);
    const list = out.get(c.from);
    if (list) list.push(c.to);
    else out.set(c.from, [c.to]);
  }
  return { live, ignored };
}

export function analyseNetwork(nodes: NetNode[]): Network {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const { live, ignored } = liveLinks(nodes);

  const rows = new Map<string, RowLogic>();
  for (const n of nodes) {
    if (!scheduled(n)) continue;
    rows.set(n.id, {
      incoming: [], outgoing: [], setsDateBy: [], conflicts: [],
      reachesFinish: false, canSlip: null, setsProjectFinish: false, lateFinish: null,
    });
  }

  const links: LinkState[] = live.map((c) => {
    const { bound, side } = measure(byId.get(c.from) as Dated, byId.get(c.to) as Dated, c.type, c.wait);
    return { fromId: c.from, toId: c.to, type: c.type, wait: c.wait, slack: side - bound, bound: isoOf(bound) };
  });
  for (const l of links) {
    rows.get(l.fromId)!.outgoing.push(l);
    const into = rows.get(l.toId)!;
    into.incoming.push(l);
    if (l.slack === 0) into.setsDateBy.push(l.fromId);
    if (l.slack < 0) into.conflicts.push(l);
  }

  let last: number | null = null;
  for (const id of rows.keys()) {
    const f = dayNo((byId.get(id) as Dated).finishDate);
    if (last === null || f > last) last = f;
  }

  // Backward pass over the links that lead to the finish. The live graph has
  // no loops, so the recursion ends.
  const reach = new Map<string, boolean>();
  const reachesFinish = (id: string): boolean => {
    const known = reach.get(id);
    if (known !== undefined) return known;
    const finishing = dayNo((byId.get(id) as Dated).finishDate) === last;
    const value = finishing || rows.get(id)!.outgoing.some((l) => reachesFinish(l.toId));
    reach.set(id, value);
    return value;
  };
  const lf = new Map<string, number>();
  const lateFinish = (id: string): number => {
    const known = lf.get(id);
    if (known !== undefined) return known;
    const n = byId.get(id) as Dated;
    const dur = dayNo(n.finishDate) - dayNo(n.startDate) + 1;
    let value = dayNo(n.finishDate) === last ? last! : Infinity;
    for (const l of rows.get(id)!.outgoing) {
      if (!reachesFinish(l.toId)) continue;
      const s = byId.get(l.toId) as Dated;
      const sLF = lateFinish(l.toId);
      const sLS = sLF - (dayNo(s.finishDate) - dayNo(s.startDate));
      const candidate =
        l.type === 'SS'
          ? sLS - l.wait + dur - 1
          : l.type === 'FF'
            ? sLF - l.wait
            : sLS - (s.isMilestone ? 0 : 1) - l.wait;
      if (candidate < value) value = candidate;
    }
    lf.set(id, value);
    return value;
  };

  for (const [id, row] of rows) {
    row.reachesFinish = reachesFinish(id);
    if (!row.reachesFinish) continue;
    const late = lateFinish(id);
    row.lateFinish = isoOf(late);
    row.canSlip = late - dayNo((byId.get(id) as Dated).finishDate);
    row.setsProjectFinish = row.canSlip <= 0;
  }

  return { rows, links, ignored, projectFinish: last === null ? null : isoOf(last) };
}

/**
 * Whether "toId waits for fromId" would close a loop, and the way round if so:
 * [fromId, toId, …, fromId]. A row waiting for itself is [id, id].
 */
export function wouldLoop(nodes: NetNode[], fromId: string, toId: string): string[] | null {
  if (fromId === toId) return [fromId, fromId];
  const next = new Map<string, string[]>();
  for (const e of liveLinks(nodes).live) {
    const list = next.get(e.from);
    if (list) list.push(e.to);
    else next.set(e.from, [e.to]);
  }
  // A way from toId back to fromId already exists? Then fromId → toId closes it.
  const prev = new Map<string, string>();
  const seen = new Set([toId]);
  const queue = [toId];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === fromId) {
      const path = [fromId];
      let cur = fromId;
      while (cur !== toId) {
        cur = prev.get(cur)!;
        path.unshift(cur);
      }
      return [fromId, ...path];
    }
    for (const n of next.get(id) ?? []) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, id);
      queue.push(n);
    }
  }
  return null;
}

/**
 * What has to move LATER, and by how much, after the rows in `fromIds` moved.
 *
 * Walks forward from them over the live links; a follower whose links now
 * give it negative slack moves by exactly the largest overrun, keeps its
 * duration, and is walked from in turn. Never earlier: room a predecessor
 * gives back stays room.
 */
export function conflictMoves(nodes: NetNode[], fromIds: string[], names: Map<string, string>): ShiftRow[] {
  const work = new Map(nodes.map((n) => [n.id, { ...n }]));
  const { live } = liveLinks(nodes);
  const liveKey = new Set(live.map((e) => `${e.from}>${e.to}`));
  const out = new Map<string, string[]>();
  for (const e of live) {
    const list = out.get(e.from);
    if (list) list.push(e.to);
    else out.set(e.from, [e.to]);
  }
  const shift = new Map<string, number>();
  const queue = [...fromIds];
  for (let guard = 0; queue.length && guard < 100_000; guard += 1) {
    const id = queue.shift()!;
    for (const to of out.get(id) ?? []) {
      const b = work.get(to)!;
      if (!scheduled(b)) continue;
      let need = 0;
      for (const l of b.links ?? []) {
        const a = work.get(l.id);
        if (!scheduled(a) || !liveKey.has(`${l.id}>${to}`)) continue;
        const { bound, side } = measure(a, b, l.type, l.wait);
        need = Math.max(need, bound - side);
      }
      if (need <= 0) continue;
      b.startDate = addDays(b.startDate, need);
      b.finishDate = addDays(b.finishDate, need);
      shift.set(to, (shift.get(to) ?? 0) + need);
      queue.push(to);
    }
  }
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const original = new Map(nodes.map((n) => [n.id, n]));
  return [...shift.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))
    .map(([id, days]) => {
      const n = original.get(id) as Dated;
      return {
        id,
        name: names.get(id) ?? id,
        fromStart: n.startDate,
        toStart: addDays(n.startDate, days),
        fromFinish: n.finishDate,
        toFinish: addDays(n.finishDate, days),
        days,
      };
    });
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const short = (iso: string) => SHORT.format(new Date(utc(iso)));
const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;

/** One sentence: why this row's date is what it is. Plain words only. */
export function whySentence(
  id: string,
  net: Network,
  nodes: Map<string, NetNode>,
  names: Map<string, string>
): { text: string; conflict: boolean } {
  const row = net.rows.get(id);
  const n = nodes.get(id);
  if (!row || !n?.startDate || !n.finishDate) return { text: 'Not scheduled yet.', conflict: false };
  if (!row.incoming.length) return { text: 'Not linked yet. Its dates are typed.', conflict: false };
  const tight = [...row.incoming].sort((a, b) => a.slack - b.slack)[0];
  const a = nodes.get(tight.fromId) as Dated;
  const name = names.get(tight.fromId) ?? tight.fromId;
  if (tight.slack < 0) {
    if (tight.type === 'FF') return { text: `Finishes ${short(n.finishDate)}, before ${name} finishes (${short(a.finishDate)}).`, conflict: true };
    if (tight.type === 'SS') return { text: `Starts ${short(n.startDate)}, before ${name} starts (${short(a.startDate)}).`, conflict: true };
    return { text: `Starts ${short(n.startDate)}, before ${name} finishes (${short(a.finishDate)}).`, conflict: true };
  }
  if (tight.slack > 0) {
    return tight.type === 'FF'
      ? { text: `Finishes ${short(n.finishDate)}; ${name} would allow ${short(tight.bound)}.`, conflict: false }
      : { text: `Starts ${short(n.startDate)}; ${name} would allow ${short(tight.bound)}.`, conflict: false };
  }
  if (tight.type === 'SS')
    return {
      text: tight.wait ? `Starts ${short(n.startDate)}, ${days(tight.wait)} after ${name} starts.` : `Starts ${short(n.startDate)}, when ${name} starts.`,
      conflict: false,
    };
  if (tight.type === 'FF')
    return {
      text: tight.wait ? `Finishes ${short(n.finishDate)}, ${days(tight.wait)} after ${name} finishes.` : `Finishes ${short(n.finishDate)}, when ${name} finishes.`,
      conflict: false,
    };
  return {
    text: tight.wait
      ? `Starts ${short(n.startDate)}, ${days(tight.wait)} after ${name} finishes.`
      : `Starts ${short(n.startDate)} because ${name} finishes ${short(a.finishDate)}.`,
    conflict: false,
  };
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts`
Expected: all PASS. If a can-slip check fails, print `[...net.rows]` and compute the expected `lateFinish` by hand from the spec's formulas before changing any code.

- [ ] **Step 5: Commit** (with Task 3, because deleting `computeFloat` breaks `lib/sheet.ts` until Task 3 lands — do Task 3 now and commit both together)

---

### Task 3: Rows carry their links; the server reads them

**Files:**
- Modify: `lib/sheet.ts` (`SheetRow`, `Sheet`, `getSheet`, imports)
- Modify: `lib/sheet-predict.ts` (placeholder row, ~line 81)
- Modify: `lib/types.ts` (`WbsItem`, ~line 54)
- Modify: `lib/dashboard-db.ts` (`parseIds` → `parseLinks`, ~lines 82-91 and 183)
- Modify: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Consumes: `parseLinks`, `StoredLink` (Task 1); `analyseNetwork` (Task 2).
- Produces:
  - `SheetRow.links: StoredLink[] | null`, `SheetRow.contractStart: string | null`, `SheetRow.contractFinish: string | null`; `SheetRow.totalFloat` = `RowLogic.canSlip`; `SheetRow.isCritical` = `RowLogic.setsProjectFinish`.
  - `Sheet.contract: { lockedAt: string; reason: string | null } | null`.
  - `WbsItem.waitLinks?: StoredLink[]` (ids stay in `WbsItem.waitsFor`).

- [ ] **Step 1: Append the failing test** above the marker line:

```ts
/* --------------------------------------------------- rows carry their links */

const { db, schema } = await import('../lib/sqlite.ts');
const { getSheet } = await import('../lib/sheet.ts');
const { eq } = await import('drizzle-orm');
const linked = db.select().from(schema.wbsNodes).all().find((n) => n.waitsFor && n.waitsFor !== '[]');
if (!linked) throw new Error('the fixture has no linked row; the local database had ten on 7 Oct 2026');
const sheet = getSheet(linked.projectId);
const row = sheet.rows.find((x) => x.id === linked.id)!;
check('a legacy row reads its links in the new shape', Array.isArray(row.links) && row.links.every((l) => l.type === 'FS' && l.wait === 0), j(row.links));
check('a group row never carries links', sheet.rows.filter((x) => x.isSummary).every((x) => x.links === null));
check('no contract yet', sheet.contract === null && sheet.rows.every((x) => x.contractStart === null));
check('a group row has no can-slip figure', sheet.rows.filter((x) => x.isSummary).every((x) => x.totalFloat === null && !x.isCritical));
```

- [ ] **Step 2: Implement**

  `lib/sheet.ts`:
  - imports: replace `import { computeFloat, inferChains, type ChainNode, type WeekSpan } from './chains';` with `import { analyseNetwork, type WeekSpan } from './chains';`, add `import { parseLinks, type StoredLink } from './links';`, and add `and` to the `drizzle-orm` import.
  - `SheetRow`: rewrite the `totalFloat` doc to "Days this row can slip before the project finish moves, through its links. Null on a group row and on a row not linked through to the finish (see `analyseNetwork`)." and the `isCritical` doc to "It sets the project finish: a day late here is a day late at the end." Then add after `isCritical`:
    ```ts
    /** This row's own links (what it waits for). Null: never asked. Always null on a group row. */
    links: StoredLink[] | null;
    /** The contract's dates for this row, once a contract is locked. */
    contractStart: string | null;
    contractFinish: string | null;
    ```
  - `Sheet`: add `/** Set once the plan has been locked as the contract. */ contract: { lockedAt: string; reason: string | null } | null;`.
  - `getSheet`, after `const schedByNode = …`:
    ```ts
    const contractRow = db
      .select()
      .from(schema.baselines)
      .where(and(eq(schema.baselines.projectId, projectId), eq(schema.baselines.kind, 'contractual')))
      .all()[0];
    const contractByNode = new Map(
      contractRow
        ? db
            .select()
            .from(schema.nodeSchedules)
            .where(eq(schema.nodeSchedules.baselineId, contractRow.id))
            .all()
            .map((s) => [s.nodeId, s] as const)
        : []
    );
    ```
  - In the placeholder `rows.push({ … })`, beside `totalFloat: null, isCritical: false,`:
    ```ts
    links: hasChildren ? null : parseLinks(n.waitsFor),
    contractStart: contractByNode.get(n.id)?.startDate ?? null,
    contractFinish: contractByNode.get(n.id)?.finishDate ?? null,
    ```
  - Replace the whole "Criticality, from the chain the dates already describe…" block (the `chainNodes` const, `computeFloat` call and its loop) with:
    ```ts
    // What the stored links say about the typed plan — see analyseNetwork. A
    // SheetRow carries exactly the NetNode fields, so the rows go in as they are.
    const net = analyseNetwork(rows);
    for (const r of rows) {
      const logic = net.rows.get(r.id);
      if (!logic || r.isSummary) continue;
      r.totalFloat = logic.canSlip;
      r.isCritical = logic.setsProjectFinish;
    }
    ```
  - In the returned object: `contract: contractRow ? { lockedAt: contractRow.approvedAt ?? contractRow.createdAt, reason: contractRow.reason } : null,`.

  `lib/sheet-predict.ts`: in the placeholder row beside `totalFloat: null, isCritical: false,` add `links: null, contractStart: null, contractFinish: null,`.

  `lib/types.ts`: add `import type { StoredLink } from './links';` at the top and, after `waitsFor?: string[];`:
  ```ts
  /** The same links with their way and wait (lib/links.ts). The forecast and Check read these. */
  waitLinks?: StoredLink[];
  ```

  `lib/dashboard-db.ts`: add `import { parseLinks } from './links';`, delete `parseIds` and its comment, and replace `waitsFor: parseIds(n.waitsFor),` with:
  ```ts
  ...(() => {
    const links = parseLinks(n.waitsFor);
    return links === null ? {} : { waitsFor: links.map((l) => l.id), waitLinks: links };
  })(),
  ```

- [ ] **Step 3: Run the tests and the type-check**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts` → all PASS.
Run the scratch-tsconfig type-check → 0 errors; every other `SheetRow` literal it names gets `links: null, contractStart: null, contractFinish: null`.
Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts` → still PASS (ids unchanged).

- [ ] **Step 4: Commit Tasks 2 and 3 together**

```bash
git add lib/chains.ts lib/sheet.ts lib/sheet-predict.ts lib/types.ts lib/dashboard-db.ts scripts/verify-schedule-logic.ts
git commit -m "Network analysis over stored links; rows carry them and criticality comes from them"
```

---

### Task 4: Writing links, and keeping them clean

**Files:**
- Create: `lib/links-sqlite.ts`
- Modify: `lib/progress-sqlite.ts` (delete `setWaitsForSqlite`, ~lines 470-489)
- Modify: `lib/actions.ts` (delete `setWaitsForAction`, ~lines 288-296, and its import)
- Modify: `lib/sheet-actions.ts` (add `saveRowLinksAction`)
- Modify: `lib/sheet-structure.ts` (`renumber`, after `coverChildren`, ~line 200)
- Modify: `lib/paste-actions.ts` (`renumberProject`, after `coverChildren`, ~line 288)
- Modify: `scripts/verify-forecast-store.ts`
- Modify: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Consumes: `StoredLink`, `serializeLinks`, `parseLinks`, `cleanLink` (Task 1); `wouldLoop`, `NetNode` (Task 2); `getSheet`, `Sheet` (Task 3).
- Produces:
  ```ts
  // lib/links-sqlite.ts — no 'use server'; callable from node scripts
  export function setLinksSqlite(projectId: string, nodeId: string, links: StoredLink[]): void;
  export function saveRowLinksSqlite(projectId: string, nodeId: string, waitsFor: StoredLink[], holdsUp: StoredLink[]): void;
  export function pruneLinks(projectId: string, tx?: Pick<typeof db, 'update'>): void;
  // lib/sheet-actions.ts
  export async function saveRowLinksAction(nodeId: string, waitsFor: StoredLink[], holdsUp: StoredLink[]): Promise<{ ok: true; sheet: Sheet } | { ok: false; error: string }>;
  ```
  In `holdsUp`, each `id` is a FOLLOWER's id; `type`/`wait` say how that follower waits for `nodeId`.

- [ ] **Step 1: Append the failing tests** above the marker line:

```ts
/* ------------------------------------------------------------ writing links */

const { setLinksSqlite, saveRowLinksSqlite, pruneLinks } = await import('../lib/links-sqlite.ts');
const proj = linked.projectId;
const dated = sheet.rows.filter((x) => x.isLeaf && x.startDate);
if (dated.length < 3) throw new Error('the linked project needs three scheduled activities');
const [L1, L2, L3] = dated;
const branch = sheet.rows.find((x) => x.isSummary)!;
const stored = (id: string) => db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, id)).all()[0].waitsFor;
const refuses = (fn: () => void, word: string) => {
  try {
    fn();
    return false;
  } catch (e) {
    return String((e as Error).message).toLowerCase().includes(word);
  }
};
// Start clean: these three may already hold links from the fixture.
for (const x of [L1, L2, L3]) db.update(schema.wbsNodes).set({ waitsFor: null }).where(eq(schema.wbsNodes.id, x.id)).run();

setLinksSqlite(proj, L2.id, [{ id: L1.id, type: 'SS', wait: 3 }]);
check('a link is stored in the new shape', stored(L2.id) === JSON.stringify([{ id: L1.id, type: 'SS', wait: 3 }]), stored(L2.id) ?? '');
check('itself is refused', refuses(() => setLinksSqlite(proj, L1.id, [{ id: L1.id, type: 'FS', wait: 0 }]), 'itself'));
check('a group row is refused', refuses(() => setLinksSqlite(proj, L1.id, [{ id: branch.id, type: 'FS', wait: 0 }]), 'group'));
check('a loop is refused and named', refuses(() => setLinksSqlite(proj, L1.id, [{ id: L2.id, type: 'FS', wait: 0 }]), 'loop'));
check('an unknown id is refused', refuses(() => setLinksSqlite(proj, L1.id, [{ id: 'nope', type: 'FS', wait: 0 }]), 'not found'));

saveRowLinksSqlite(proj, L2.id, [{ id: L1.id, type: 'FS', wait: 0 }], [{ id: L3.id, type: 'FF', wait: 2 }]);
check('holds up writes into the follower', (parseLinks(stored(L3.id)) ?? []).some((l) => l.id === L2.id && l.type === 'FF' && l.wait === 2), stored(L3.id) ?? '');
saveRowLinksSqlite(proj, L2.id, [{ id: L1.id, type: 'FS', wait: 0 }], []);
check('dropping it from holds up removes it from the follower', !(parseLinks(stored(L3.id)) ?? []).some((l) => l.id === L2.id), stored(L3.id) ?? '');

db.update(schema.wbsNodes).set({ waitsFor: JSON.stringify([{ id: 'gone', type: 'FS', wait: 0 }, { id: L1.id, type: 'FS', wait: 0 }]) }).where(eq(schema.wbsNodes.id, L3.id)).run();
pruneLinks(proj);
check('prune drops a link to a row that no longer exists', j(parseLinks(stored(L3.id))) === j([{ id: L1.id, type: 'FS', wait: 0 }]), stored(L3.id) ?? '');
db.update(schema.wbsNodes).set({ waitsFor: JSON.stringify([{ id: L1.id, type: 'FS', wait: 0 }]) }).where(eq(schema.wbsNodes.id, branch.id)).run();
pruneLinks(proj);
check('prune clears links on a group row', stored(branch.id) === null, String(stored(branch.id)));
```

- [ ] **Step 2: Run to see it fail** — Expected: `Cannot find module '…/lib/links-sqlite.ts'`.

- [ ] **Step 3: Implement `lib/links-sqlite.ts`**

```ts
/**
 * The only writer of `wbs_nodes.waits_for`. Not a server action, so the verify
 * scripts can call it; `saveRowLinksAction` in lib/sheet-actions.ts wraps it.
 *
 * Everything the Links panel and the Gantt drag refuse is refused here too,
 * because a payload from the browser can say anything. Reads go through `db`
 * (inside a better-sqlite3 transaction it is the same connection and sees the
 * transaction's own writes); writes go through the writer handed in.
 */
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { wouldLoop, type NetNode } from './chains';
import { cleanLink, parseLinks, serializeLinks, type StoredLink } from './links';

type Writer = Pick<typeof db, 'update'>;

function projectNodes(projectId: string) {
  return db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.projectId, projectId)).all();
}

function validate(projectId: string, nodeId: string, links: StoredLink[]): StoredLink[] {
  const nodes = projectNodes(projectId);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const self = byId.get(nodeId);
  if (!self) throw new Error('Row not found');
  if (!self.isLeaf) throw new Error('A group row cannot wait for anything; link the activities inside it');
  const clean: StoredLink[] = [];
  const seen = new Set<string>();
  for (const raw of links) {
    const l = cleanLink(raw);
    if (!l) throw new Error('That link is not valid');
    if (l.id === nodeId) throw new Error('An activity cannot wait for itself');
    const other = byId.get(l.id);
    if (!other) throw new Error('That activity was not found');
    if (!other.isLeaf) throw new Error('A group row cannot be waited for; pick an activity inside it');
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    clean.push(l);
  }
  // Loops, against the rest of the stored graph. Dates do not matter here, but
  // the network only reads scheduled leaves, so every leaf gets a nominal day.
  const graph: NetNode[] = nodes.map((n) => ({
    id: n.id,
    isLeaf: n.isLeaf,
    isMilestone: n.isMilestone,
    startDate: '2000-01-01',
    finishDate: '2000-01-01',
    links: n.id === nodeId ? [] : parseLinks(n.waitsFor),
  }));
  const me = graph.find((n) => n.id === nodeId)!;
  for (const l of clean) {
    const path = wouldLoop(graph, l.id, nodeId);
    if (path) {
      const name = (id: string) => byId.get(id)?.deskripsi ?? id;
      throw new Error(`That would loop back: ${path.map(name).join(' → ')}`);
    }
    me.links = [...(me.links ?? []), l];
  }
  return clean;
}

export function setLinksSqlite(projectId: string, nodeId: string, links: StoredLink[]): void {
  const clean = validate(projectId, nodeId, links);
  db.update(schema.wbsNodes).set({ waitsFor: serializeLinks(clean) }).where(eq(schema.wbsNodes.id, nodeId)).run();
}

/**
 * The panel's Save: this row's own links, and how each follower waits for it.
 * A follower that was waiting for this row and is no longer listed stops
 * waiting for it; its other links are left alone. One transaction.
 */
export function saveRowLinksSqlite(projectId: string, nodeId: string, waitsFor: StoredLink[], holdsUp: StoredLink[]): void {
  const known = new Set(projectNodes(projectId).map((n) => n.id));
  for (const h of holdsUp) if (!known.has(h.id)) throw new Error('That activity was not found');
  db.transaction((tx) => {
    const own = validate(projectId, nodeId, waitsFor);
    tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(own) }).where(eq(schema.wbsNodes.id, nodeId)).run();

    const wanted = new Map(holdsUp.map((h) => [h.id, h]));
    for (const n of projectNodes(projectId)) {
      if (n.id === nodeId) continue;
      const current = parseLinks(n.waitsFor);
      const had = (current ?? []).some((l) => l.id === nodeId);
      const want = wanted.get(n.id);
      if (!had && !want) continue;
      const rest = (current ?? []).filter((l) => l.id !== nodeId);
      const next = want ? [...rest, { id: nodeId, type: want.type, wait: want.wait }] : rest;
      const clean = validate(projectId, n.id, next);
      tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(clean) }).where(eq(schema.wbsNodes.id, n.id)).run();
    }
  });
}

/**
 * Called from both `renumber()` copies, the funnel every structural change
 * passes through: a group row carries no links, and no link points at a row
 * that is gone or has become a group. The stale-flag family of `isMilestone`.
 * An undo that brings a deleted row back restores its own links, not the
 * links other rows had to it.
 */
export function pruneLinks(projectId: string, tx: Writer = db): void {
  const nodes = projectNodes(projectId);
  const leaf = new Set(nodes.filter((n) => n.isLeaf).map((n) => n.id));
  for (const n of nodes) {
    if (!n.waitsFor) continue;
    if (!n.isLeaf) {
      tx.update(schema.wbsNodes).set({ waitsFor: null }).where(eq(schema.wbsNodes.id, n.id)).run();
      continue;
    }
    const links = parseLinks(n.waitsFor);
    if (links === null) continue;
    const kept = links.filter((l) => leaf.has(l.id) && l.id !== n.id);
    if (kept.length !== links.length) {
      tx.update(schema.wbsNodes).set({ waitsFor: serializeLinks(kept) }).where(eq(schema.wbsNodes.id, n.id)).run();
    }
  }
}
```

  Wire it:
  - `lib/sheet-structure.ts`: `import { pruneLinks } from './links-sqlite';`; in `renumber`, right after `if (baselineId) coverChildren(projectId, baselineId, tx);` add `pruneLinks(projectId, tx);` with the comment `// AND THE LINKS: a group row carries none, and none point at a row that is gone. See pruneLinks.`
  - `lib/paste-actions.ts`: the same import, and `pruneLinks(projectId, tx);` after `if (baselineId) coverChildren(projectId, baselineId, tx);` in `renumberProject`.
  - `lib/progress-sqlite.ts`: delete `setWaitsForSqlite` and its doc comment.
  - `lib/actions.ts`: delete `setWaitsForAction` and drop `setWaitsForSqlite` from its import list.
  - `lib/sheet-actions.ts`: add to the imports `import { saveRowLinksSqlite } from './links-sqlite';`, `import type { StoredLink } from './links';`, and add `getSheet, type Sheet` to the existing `./sheet` import; then:
    ```ts
    /** The Links panel's Save, and the Gantt drag card's. Answers with the sheet as it now stands. */
    export async function saveRowLinksAction(
      nodeId: string,
      waitsFor: StoredLink[],
      holdsUp: StoredLink[]
    ): Promise<{ ok: true; sheet: Sheet } | { ok: false; error: string }> {
      await beforeWrite();
      try {
        const projectId = projectOfNode(nodeId);
        if (!projectId) throw new Error('Row not found');
        saveRowLinksSqlite(projectId, nodeId, waitsFor, holdsUp);
        await landed();
        return { ok: true, sheet: getSheet(projectId) };
      } catch (e) {
        return fail(e);
      }
    }
    ```
  - `scripts/verify-forecast-store.ts`: replace the `setWaitsForSqlite` import with `import { setLinksSqlite } from '../lib/links-sqlite.ts';` (keep it a dynamic import if the script imports after setting `REPORT_DB_PATH`), and every call `setWaitsForSqlite(p, id, ids)` with `setLinksSqlite(p, id, ids.map((x) => ({ id: x, type: 'FS' as const, wait: 0 })))`. Its assertions read ids from `dashboard-db` and do not change.

- [ ] **Step 4: Run**

```
node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-forecast-store.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-paste.ts
```
Expected: all PASS. `grep -rn "setWaitsFor" lib components app scripts` → nothing. Type-check → 0 errors.

- [ ] **Step 5: Commit**

```bash
git add lib/links-sqlite.ts lib/progress-sqlite.ts lib/actions.ts lib/sheet-actions.ts lib/sheet-structure.ts lib/paste-actions.ts scripts/verify-forecast-store.ts scripts/verify-schedule-logic.ts
git commit -m "One writer for links: refuses itself, group rows, unknown rows and loops; renumber prunes"
```

---

### Task 5: The forecast reads the way and the wait

**Files:**
- Modify: `lib/forecast.ts` (~lines 20-27, 55-56, 130-145)
- Modify: `lib/forecast-read.ts` (~line 60)
- Modify: `scripts/verify-forecast.ts` (~lines 170-200)

**Interfaces:**
- Consumes: `StoredLink` (Task 1); `WbsItem.waitLinks` (Task 3).
- Produces: `ForecastLeafInput.waitsFor: StoredLink[]`.

- [ ] **Step 1: Failing tests** — in `scripts/verify-forecast.ts`, change each direct input `waitsFor: ['A']` / `waitsFor: ['B']` (~lines 173, 181, 198) to `waitsFor: [{ id: 'A', type: 'FS', wait: 0 }]` (resp. `'B'`). Then, after the existing link checks (~line 200), add:

```ts
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
```

- [ ] **Step 2: Run to see the three new checks FAIL**

Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts`

- [ ] **Step 3: Implement**

  `lib/forecast.ts`:
  - add `import type { StoredLink } from './links';`
  - `ForecastLeafInput.waitsFor`: `/** Confirmed links only, with their way and wait. */ waitsFor: StoredLink[];`
  - delete `DRIVING_SLACK_DAYS` and its comment.
  - replace the loop `for (const pid of leaf.waitsFor) { … }` (through its closing brace) with:
    ```ts
    // How far a predecessor runs past what this activity allowed for it, by
    // the link's way. Measured against the PLAN on both sides, so an overlap
    // the plan already had is kept and room the plan left is used first. A
    // link drives only when nothing is left of that room (7 Oct 2026: links
    // are typed now, with their wait; the old 3-day tolerance was for links
    // guessed from dates).
    for (const link of leaf.waitsFor) {
      const pred = visit(link.id);
      if (!pred) continue;
      const p = byId.get(link.id)!;
      const pPS = dayOf(p.planStart);
      const pPF = dayOf(p.planFinish);
      let value: number;
      if (link.type === 'SS') {
        // Started (or done) is not late to start; not started starts when its
        // own push lets it, never before the status date.
        const predStart = p.pct > 0 || pred.basis === 'done' ? pPS : Math.max(pPS + Math.max(0, pred.push), D + 1);
        value = predStart - Math.max(pPS, PS - link.wait);
      } else if (link.type === 'FF') {
        value = pred.day - Math.max(pPF, PF - link.wait);
      } else {
        value = pred.day - Math.max(pPF, PS - 1 - link.wait);
      }
      push = Math.max(push, value);
      if (value > nearest) {
        nearest = value;
        drivenBy = value >= 0 ? link.id : null;
      }
    }
    ```
  - Fix the comment on the `LeafForecast.drivenBy` field: "The predecessor holding it, when its link has no room left."

  `lib/forecast-read.ts`: replace `waitsFor: item.waitsFor ?? [],` with
  ```ts
  // db.json-shaped fixtures carry ids only; those read as "after it finishes".
  waitsFor: item.waitLinks ?? (item.waitsFor ?? []).map((id) => ({ id, type: 'FS' as const, wait: 0 })),
  ```

- [ ] **Step 4: Run all three forecast readers**

```
node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-forecast-store.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-priority-actions.ts
```
Expected: all PASS. Because the 3-day tolerance is gone, a "path"/"driven by" check on a fixture whose links had 1-3 days of room may change. For EVERY failing check: print old and new value, add a line under "Moved figures" below (check name, old, new, reason: "room in the plan no longer counts as driving"), and only then update that one expectation. If more than three checks move, STOP and report to the user with the list instead of updating.

  Moved figures: _(filled in during execution)_

- [ ] **Step 5: Commit**

```bash
git add lib/forecast.ts lib/forecast-read.ts scripts/verify-forecast.ts docs/superpowers/plans/2026-10-07-projects-links-gantt.md
git commit -m "Forecast pushes by the link's way and wait; the guessed-link tolerance goes"
```

---

### Task 6: Check names conflicts and loops

**Files:**
- Modify: `lib/analysis.ts` (inside `validateWeek`, after the contract-value `findings.push`)
- Modify: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Consumes: `analyseNetwork`, `NetNode` (Task 2); `WbsItem.waitLinks` (Task 3); `Database.schedule[]` `startDate`/`finishDate`; `buildProjectDashboardData(projectId).db` from `lib/dashboard-db.ts`.
- Produces: a `warn` finding "N activities start before what they wait for" with `rows` (each `{ id, label, value }`), or an `ok` finding "Links between activities agree with the plan"; plus a `warn` "A link loops back" when the network ignored any link.

- [ ] **Step 1: Append the failing test** above the marker line:

```ts
/* ------------------------------------------------------------------- check */

const { validateWeek } = await import('../lib/analysis.ts');
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
setLinksSqlite(proj, L3.id, [{ id: L1.id, type: 'FS', wait: 0 }]);
const data = buildProjectDashboardData(proj)!;
const s1 = data.db.schedule!.find((s) => s.leafId === L1.id)!;
const s3 = data.db.schedule!.find((s) => s.leafId === L3.id)!;
s3.startDate = s1.startDate; // starts with it, so before it finishes
const v = validateWeek(data.db, data.weeks[0]);
const finding = v.findings.find((f) => f.title.includes('before what they wait for'));
check('Check names an activity that starts before what it waits for', Boolean(finding?.rows?.some((x) => x.id === L3.id)), JSON.stringify(finding));
```

- [ ] **Step 2: Run → that check FAILs.**

- [ ] **Step 3: Implement** — add `import { analyseNetwork, type NetNode } from './chains';` to `lib/analysis.ts` and, after the contract-value `findings.push(...)` in `validateWeek`:

```ts
  // Links the typed plan breaks (spec 2026-10-07). Read with the same analysis
  // the planner draws, so Check and the Gantt name the same rows.
  {
    const dates = new Map((db.schedule ?? []).map((s) => [s.leafId, s]));
    const parents = new Set(db.wbsItems.map((i) => i.parentId).filter(Boolean));
    const nodes: NetNode[] = db.wbsItems.map((i) => ({
      id: i.id,
      isLeaf: !parents.has(i.id),
      isMilestone: Boolean(i.isMilestone),
      startDate: dates.get(i.id)?.startDate ?? null,
      finishDate: dates.get(i.id)?.finishDate ?? null,
      links: i.waitLinks ?? (i.waitsFor ? i.waitsFor.map((id) => ({ id, type: 'FS' as const, wait: 0 })) : null),
    }));
    const net = analyseNetwork(nodes);
    const names = new Map(db.wbsItems.map((i) => [i.id, i.deskripsi]));
    const late = [...net.rows.entries()].filter(([, r]) => r.conflicts.length > 0);
    findings.push(
      late.length
        ? {
            level: 'warn',
            title: `${late.length} ${late.length === 1 ? 'activity starts' : 'activities start'} before what they wait for`,
            detail: 'Their plan dates break a link made in Projects. Move them there, or change the link.',
            rows: late.map(([id, r]) => ({
              id,
              label: names.get(id) ?? id,
              value: `Waits for ${names.get(r.conflicts[0].fromId) ?? r.conflicts[0].fromId}`,
            })),
          }
        : { level: 'ok', title: 'Links between activities agree with the plan', detail: 'No activity starts before what it waits for.' }
    );
    if (net.ignored.length) {
      findings.push({
        level: 'warn',
        title: 'A link loops back',
        detail: 'These links are ignored until one of them is removed in Projects.',
        rows: net.ignored.map((l) => ({ id: l.toId, label: names.get(l.toId) ?? l.toId, value: `Waits for ${names.get(l.fromId) ?? l.fromId}` })),
      });
    }
  }
```

- [ ] **Step 4: Run** `verify-schedule-logic.ts` → all PASS; `node --import ./scripts/ts-resolve.mjs scripts/verify-dashboard-figures.ts` → PASS (if it asserts an exact number of findings, add the new `ok` finding to that expectation with a one-line comment naming this task).

- [ ] **Step 5: Commit**

```bash
git add lib/analysis.ts scripts/verify-schedule-logic.ts
git commit -m "Check names activities that start before what they wait for, and loops"
```

---

### Task 7: The Gantt draws variant A

**Files:**
- Create: `lib/gantt-arrows.ts`
- Modify: `components/projects/GanttChart.tsx`
- Modify: `components/projects/ScheduleSheet.tsx`
- Modify: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Consumes: `Network`, `analyseNetwork` (Task 2); `SheetRow.contractStart/contractFinish/totalFloat/isCritical` (Task 3).
- Produces:
  ```ts
  // lib/gantt-arrows.ts
  export function arrowPath(type: LinkType, from: { x1: number; x2: number; y: number }, to: { x1: number; x2: number; y: number; milestone: boolean }, rowH: number): string;
  export function visibleEnd(id: string, visibleIndex: Map<string, number>, parentOf: Map<string, string | null>): { index: number; collapsed: boolean } | null;
  // GanttChart new props
  network?: Network | null; parentOf?: Map<string, string | null>; contract?: boolean;
  ```
  `x1` is a bar's left edge, `x2` its right edge (finish day + one day width), `y` its row centre.

- [ ] **Step 1: Failing geometry tests** — above the marker line:

```ts
/* ----------------------------------------------------------- arrow geometry */

const { arrowPath, visibleEnd } = await import('../lib/gantt-arrows.ts');
check('after it finishes: right end into left end', arrowPath('FS', { x1: 0, x2: 100, y: 10 }, { x1: 140, x2: 200, y: 50, milestone: false }, 28) === 'M100 10 H108 V50 H138');
check('after it starts: out and in on the left', arrowPath('SS', { x1: 20, x2: 100, y: 10 }, { x1: 60, x2: 200, y: 50, milestone: false }, 28) === 'M20 10 H10 V50 H58');
check('finishes after it finishes: out and in on the right', arrowPath('FF', { x1: 0, x2: 100, y: 10 }, { x1: 40, x2: 160, y: 50, milestone: false }, 28) === 'M100 10 H170 V50 H162');
check('an arrow that doubles back runs between the rows', arrowPath('FS', { x1: 0, x2: 100, y: 10 }, { x1: 60, x2: 200, y: 50, milestone: false }, 28) === 'M100 10 H108 V24 H48 V50 H58');
const vis = new Map([['G', 0], ['A', 1]]);
const par = new Map<string, string | null>([['G', null], ['A', 'G'], ['H', 'G']]);
check('a hidden row ends on its shown group', j(visibleEnd('H', vis, par)) === j({ index: 0, collapsed: true }));
check('a shown row ends on itself', j(visibleEnd('A', vis, par)) === j({ index: 1, collapsed: false }));
```

- [ ] **Step 2: Run → `Cannot find module '…/lib/gantt-arrows.ts'`.**

- [ ] **Step 3: Implement `lib/gantt-arrows.ts`**

```ts
/**
 * Where an arrow between two bars runs. Pure, so its shape is tested rather
 * than eyeballed. Elbows only: the corners carry no meaning, the ends do —
 * after it finishes leaves the right end and enters the left, after it starts
 * leaves and enters on the left, finishes after it finishes on the right.
 */
import type { LinkType } from './links';

const STUB = 8;
const GAP = 2;

export function arrowPath(
  type: LinkType,
  from: { x1: number; x2: number; y: number },
  to: { x1: number; x2: number; y: number; milestone: boolean },
  rowH: number
): string {
  const toLeft = to.milestone ? to.x1 - 6 : to.x1;
  if (type === 'SS') {
    const x = Math.min(from.x1, toLeft) - 10;
    return `M${from.x1} ${from.y} H${x} V${to.y} H${toLeft - GAP}`;
  }
  if (type === 'FF') {
    const toRight = to.milestone ? to.x1 + 6 : to.x2;
    const x = Math.max(from.x2, toRight) + 10;
    return `M${from.x2} ${from.y} H${x} V${to.y} H${toRight + GAP}`;
  }
  if (toLeft - 10 >= from.x2 + STUB) return `M${from.x2} ${from.y} H${from.x2 + STUB} V${to.y} H${toLeft - GAP}`;
  const mid = from.y + (to.y > from.y ? rowH / 2 : -rowH / 2);
  return `M${from.x2} ${from.y} H${from.x2 + STUB} V${mid} H${toLeft - 12} V${to.y} H${toLeft - GAP}`;
}

/** The row an arrow ends on: itself if shown, else its nearest shown group. */
export function visibleEnd(
  id: string,
  visibleIndex: Map<string, number>,
  parentOf: Map<string, string | null>
): { index: number; collapsed: boolean } | null {
  let cur: string | null | undefined = id;
  let collapsed = false;
  while (cur) {
    const i = visibleIndex.get(cur);
    if (i !== undefined) return { index: i, collapsed };
    collapsed = true;
    cur = parentOf.get(cur);
  }
  return null;
}
```
Run → the geometry checks PASS.

- [ ] **Step 4: Draw it in `GanttChart.tsx`**

  Imports: `Fragment` from react; `type Network` from `@/lib/chains`; `arrowPath, visibleEnd` from `@/lib/gantt-arrows`.

  Props (add to the destructuring and the type):
  ```ts
  /** The links read against the plan (lib/chains.ts). Null or absent draws no arrows. */
  network?: Network | null;
  /** Every row's parent, so an arrow to a collapsed row ends on its group. */
  parentOf?: Map<string, string | null>;
  /** A contract is locked: the legend names the grey bar. */
  contract?: boolean;
  ```

  After `const shown = rows.slice(from, to);`:
  ```ts
  const visibleIndex = new Map(rows.map((r, i) => [r.id, i]));
  const xOf = (iso: string) => daysBetween(spanStart, iso) * scale;
  const endsOf = (r: SheetRow) => ({ x1: xOf(r.startDate!), x2: xOf(r.finishDate!) + scale });
  ```

  Today line: replace the today `<span>` with
  ```tsx
  <span aria-hidden title="Today" className="absolute top-0 z-10 w-0 border-l-[1.5px] border-dashed border-sky-500" style={{ left: todayX, height: bodyH }}>
    <span className="absolute left-1 top-0.5 text-[10px] font-semibold text-sky-600">Today</span>
  </span>
  ```

  Bars: wrap each return of the bars' `shown.map` in `<Fragment key={r.id}>…</Fragment>` (moving `key` off the button), and inside the fragment, after the bar button, add:
  ```tsx
  {r.totalFloat != null && r.totalFloat > 0 && !r.isSummary && (
    <span aria-hidden className="pointer-events-none absolute z-[3] flex items-center" style={{ left: x + w + 2, top: y + rowH / 2 - 4, height: 8 }}>
      <span className="border-t-[1.5px] border-dashed border-muted-foreground/60" style={{ width: Math.max(r.totalFloat * scale - 2, 4) }} />
      <span className="h-2 w-[1.5px] bg-muted-foreground/60" />
      <span className="ml-1 whitespace-nowrap text-[10px] text-muted-foreground">+{r.totalFloat} {r.totalFloat === 1 ? 'day' : 'days'}</span>
    </span>
  )}
  {r.contractStart && r.contractFinish && !r.isSummary && (
    <span
      aria-hidden
      title={`Contract ${fmtDate(r.contractStart)} → ${fmtDate(r.contractFinish)}`}
      className="pointer-events-none absolute z-[2] rounded-full bg-muted-foreground/30"
      style={{ left: xOf(r.contractStart), top: y + rowH / 2 + 8, height: 4, width: Math.max((daysBetween(r.contractStart, r.contractFinish) + 1) * scale, 3) }}
    />
  )}
  {(() => {
    const c = network?.rows.get(r.id)?.conflicts[0];
    if (!c) return null;
    const edge = c.type === 'FF' ? xOf(r.finishDate) + scale : x;
    const bound = xOf(c.bound) + (c.type === 'FF' ? scale : 0);
    return (
      <>
        <span aria-hidden className="pointer-events-none absolute z-[1] bg-[var(--bad)]/10" style={{ left: Math.min(edge, bound), width: Math.abs(bound - edge), top: y + 4, height: rowH - 8 }} />
        <span aria-hidden className="pointer-events-none absolute z-[7] grid size-3.5 place-items-center rounded-full bg-[var(--bad)] text-[9px] font-bold text-white" style={{ left: Math.max(0, x - 16), top: y + rowH / 2 - 14 }}>!</span>
      </>
    );
  })()}
  ```
  Inside the task-bar button, after the coloured `<span>`:
  ```tsx
  {r.isCritical && !bracket && (
    <span aria-hidden className="absolute -inset-x-0.5 rounded-[4px] ring-2 ring-[var(--bad)]" style={{ top: rowH / 2 - 7, height: 14 }} />
  )}
  ```
  and in the diamond branch, add `ring-2 ring-[var(--bad)] ring-offset-1` to the diamond `<span>`'s classes when `r.isCritical`.

  Arrows: build the layer ONCE per change of what it draws, so hover and scroll never rebuild it — `const arrowLayer = useMemo(() => network && ( …the SVG below… ), [network, rows, scale, spanStart, selectedId, parentOf, rowH, width, bodyH]);` — and render `{arrowLayer}` as the LAST child of the body `<div className="relative" style={{ height: bodyH }}>`. Give each `<g>` `className="transition-opacity duration-200 ease-ios"` and each `<path>` `className="transition-[stroke-width,stroke-opacity] duration-200 ease-ios"` so pressing a bar eases its arrows up instead of snapping. The SVG:
  ```tsx
  {network && (
    <svg aria-hidden className="pointer-events-none absolute left-0 top-0 z-[6] overflow-visible" width={width} height={bodyH}>
      <defs>
        {(['muted', 'path', 'lit', 'bad'] as const).map((k) => (
          <marker key={k} id={`ah-${k}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L8 4 L0 8 z" fill={k === 'bad' ? 'var(--bad)' : k === 'muted' ? 'var(--muted-foreground)' : 'var(--foreground)'} />
          </marker>
        ))}
      </defs>
      {network.links.map((l) => {
        const a = visibleEnd(l.fromId, visibleIndex, parentOf ?? new Map());
        const b = visibleEnd(l.toId, visibleIndex, parentOf ?? new Map());
        if (!a || !b || a.index === b.index) return null;
        const ra = rows[a.index];
        const rb = rows[b.index];
        if (!ra.startDate || !ra.finishDate || !rb.startDate || !rb.finishDate) return null;
        const lit = selectedId != null && (l.fromId === selectedId || l.toId === selectedId);
        const dim = selectedId != null && !lit;
        const bad = l.slack < 0;
        const onPath = Boolean(network.rows.get(l.fromId)?.setsProjectFinish && network.rows.get(l.toId)?.setsProjectFinish);
        const kind = bad ? 'bad' : lit ? 'lit' : onPath ? 'path' : 'muted';
        const to = { ...endsOf(rb), y: b.index * rowH + rowH / 2, milestone: rb.isMilestone && !b.collapsed };
        return (
          <g key={`${l.fromId}>${l.toId}`} opacity={dim ? 0.25 : 1}>
            <path
              d={arrowPath(l.type, { ...endsOf(ra), y: a.index * rowH + rowH / 2 }, to, rowH)}
              fill="none"
              stroke={bad ? 'var(--bad)' : kind === 'muted' ? 'var(--muted-foreground)' : 'var(--foreground)'}
              strokeOpacity={kind === 'muted' ? 0.55 : kind === 'path' ? 0.7 : 1}
              strokeWidth={lit || bad ? 1.75 : 1.1}
              strokeDasharray={bad || a.collapsed || b.collapsed ? '4 3' : undefined}
              markerEnd={`url(#ah-${kind})`}
            />
            {l.wait > 0 && (
              <text
                x={l.type === 'FF' ? to.x2 + 14 : to.x1 - 14}
                y={to.y - 6}
                textAnchor={l.type === 'FF' ? 'start' : 'end'}
                className="fill-muted-foreground text-[10px] font-medium"
              >
                +{l.wait} {l.wait === 1 ? 'day' : 'days'}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  )}
  ```
  (SVG `<text>` is fine here: this SVG is drawn at the surface's own pixel size, never scaled to fit — the AGENTS rule is about stretched viewBoxes.)

  Pressing empty space restores the arrows: add a prop `onClear?: () => void;` and on the body div `onClick={(e) => { if (e.target === e.currentTarget) onClear?.(); }}`. ScheduleSheet passes `onClear={() => setSelectedId(null)}` (use the sheet's actual selection setter; read where `selectedId` is declared).

  Legend (the legend component at the bottom of the same file): read how one entry is drawn, then append, after the fired rules, fixed entries in that same markup: a 2px red-outlined bar "Sets the project finish" (when any row `isCritical`), a dashed tail "Can slip" (when any row has `totalFloat > 0`), a 4px grey bar "Contract" (when `contract`), a red ! "Conflict" (when `network` has any conflict), a dashed sky line "Today". The legend receives `rows`; pass `network` and `contract` to it too.

- [ ] **Step 5: Wire `ScheduleSheet.tsx`**

  Import `analyseNetwork` from `@/lib/chains` and replace the `chainNodes` / `chainLinks` memos with:
  ```ts
  // What the stored links say about the plan on screen — the same analysis the
  // server ran in getSheet, recomputed the moment a date changes here.
  const network = useMemo(() => analyseNetwork(rows), [rows]);
  const parentOf = useMemo(() => new Map(rows.map((r) => [r.id, r.parentId])), [rows]);
  // The outline and the tail follow the dates on screen, not the last payload.
  const drawnRows = useMemo(
    () =>
      visible.map((r) => {
        const n = network.rows.get(r.id);
        return n && !r.isSummary ? { ...r, isCritical: n.setsProjectFinish, totalFloat: n.canSlip } : r;
      }),
    [visible, network]
  );
  ```
  Pass `rows={drawnRows} network={network} parentOf={parentOf} contract={contract}` to `<GanttChart>` (it got `visible` before). `contract` is a new ScheduleSheet prop `contract: boolean`, given `sheet.contract !== null` in `app/projects/[id]/page.tsx`. Until Task 8 replaces it, keep the `shiftPreview(...)` call compiling by leaving it untouched; if `chainNodes`/`chainLinks` are still referenced there, keep those two memos until Task 8 removes them.

- [ ] **Step 6: Look at it**

  Start `dev-preview` with `preview_start`. Give Merbau three links by hand (Task 9 ships the panel):
  ```bash
  node -e "const D=require('better-sqlite3');const db=new D('data/report.db');const r=db.prepare(\"select id,deskripsi from wbs_nodes where project_id='pdemo-merbau' and is_leaf=1 order by sort_order limit 4\").all();const set=db.prepare('update wbs_nodes set waits_for=? where id=?');set.run(JSON.stringify([{id:r[0].id,type:'SS',wait:7}]),r[1].id);set.run(JSON.stringify([{id:r[0].id,type:'FS',wait:0}]),r[2].id);set.run(JSON.stringify([{id:r[1].id,type:'FS',wait:0}]),r[3].id);console.log(r.map(x=>x.deskripsi))"
  ```
  Then the budget: production build + `prod-verify`, `node scripts/verify-projects-perf.mjs` three times; scroll and LCP inside budget against the Task 0 baseline, written under it as "after Task 7". Over budget is a stop: find the cost (CDP trace, see memory "Animation perf recipe") before going on.

  Shoot `http://localhost:3000/projects/pdemo-merbau` at 1440×900 and 390×844 and LOOK: arrows elbow from the ends their way names; the SS arrow enters on the left with "+7 days"; red outlines only where a row sets the finish; dashed tails with "+N days" only on rows linked through to the finish; the Today line dashed sky; a conflict (row 4 starts before row 2 finishes in Merbau's plan) shows the red !, the pale band and a red dashed arrow. Nothing overlaps a label; fix and re-shoot until it reads cleanly.

- [ ] **Step 7: Type-check, then commit**

```bash
git add lib/gantt-arrows.ts components/projects/GanttChart.tsx components/projects/ScheduleSheet.tsx app/projects/[id]/page.tsx scripts/verify-schedule-logic.ts
git commit -m "Gantt: arrows by way, finish-setting outline, can-slip tail, contract bar, conflict marks"
```

---

### Task 8: Conflicts are asked about, and listed

**Files:**
- Modify: `lib/chains.ts` (delete `shiftPreview`)
- Modify: `lib/sheet-actions.ts` (`shiftFollowersAction` → `moveFollowersAction`)
- Modify: `components/projects/ShiftPreview.tsx`
- Modify: `components/projects/ScheduleSheet.tsx` (`commit`'s date branch, mount the strip)
- Create: `components/projects/ConflictStrip.tsx`

**Interfaces:**
- Consumes: `conflictMoves`, `ShiftRow`, `Network` (Task 2).
- Produces:
  ```ts
  export async function moveFollowersAction(projectId: string, fromIds: string[]): Promise<{ ok: true; moved: number; sheet: Sheet } | { ok: false; error: string }>;
  // ShiftPreview (type in lib/chains.ts) gains: fromIds?: string[]
  ```

- [ ] **Step 1: Server action** — in `lib/sheet-actions.ts` replace `shiftFollowersAction` and its doc with:

```ts
/**
 * Move what now starts before what it waits for — later, by exactly the
 * overrun, durations kept, cascading — after the rows in `fromIds` moved.
 *
 * The moves are worked out HERE from the stored links and dates, not taken
 * from the browser: a payload naming its own rows to move could move any row
 * it liked. Never earlier (see `conflictMoves`).
 */
export async function moveFollowersAction(
  projectId: string,
  fromIds: string[]
): Promise<{ ok: true; moved: number; sheet: Sheet } | { ok: false; error: string }> {
  await beforeWrite();
  try {
    const baselineId = getActiveBaselineId(projectId);
    if (!baselineId) throw new Error('This project has no schedule yet');
    const sheet = getSheet(projectId);
    const known = new Set(sheet.rows.map((r) => r.id));
    const moves = conflictMoves(sheet.rows, fromIds.filter((id) => known.has(id)), new Map(sheet.rows.map((r) => [r.id, r.name])));
    db.transaction((tx) => {
      for (const m of moves) {
        tx.update(schema.nodeSchedules)
          .set({ startDate: m.toStart, finishDate: m.toFinish })
          .where(and(eq(schema.nodeSchedules.baselineId, baselineId), eq(schema.nodeSchedules.nodeId, m.id)))
          .run();
      }
      if (moves.length) coverChildren(projectId, baselineId, tx);
    });
    await landed();
    return { ok: true, moved: moves.length, sheet: getSheet(projectId) };
  } catch (e) {
    return fail(e);
  }
}
```
  Change the `./chains` import to `import { conflictMoves } from './chains';` (drop `inferChains`, `ChainNode`, `chainAddDays` once `grep -n "chainAddDays\|inferChains\|ChainNode" lib/sheet-actions.ts` shows no other use). In `lib/chains.ts` delete `shiftPreview` and its doc, and add `fromIds?: string[];` to the `ShiftPreview` interface with the doc "The rows to walk forward from when the offer is taken; the moved row when absent."

- [ ] **Step 2: The prompt after a date edit** — in `ScheduleSheet.tsx`'s `commit`, replace the block from `const delta =` through the end of `if (delta !== 0) { … }` with:

```ts
          // The edit has landed. What the person could not have known: which
          // followers it now pushes past their links, and which weeks it moves.
          const after = rows.map((r) =>
            r.id === row.id ? { ...r, startDate: res.startDate, finishDate: res.finishDate } : r
          );
          const followers = conflictMoves(after, [row.id], nameById);
          const self: ShiftRow | null =
            row.startDate && row.finishDate && res.startDate && res.finishDate
              ? {
                  id: row.id,
                  name: row.name,
                  fromStart: row.startDate,
                  toStart: res.startDate,
                  fromFinish: row.finishDate,
                  toFinish: res.finishDate,
                  days: Math.round(
                    (Date.parse(res.startDate + 'T00:00:00Z') - Date.parse(row.startDate + 'T00:00:00Z')) / MS_PER_DAY
                  ),
                }
              : null;
          if (self && (followers.length > 0 || self.fromStart !== self.toStart || self.fromFinish !== self.toFinish)) {
            setShift({ rowId: row.id, rowName: row.name, preview: { moved: [self], followers, fromDate: null, toDate: null } });
          }
```
  Change `commit`'s dependency list: `chainNodes, chainLinks` → `rows`. Imports from `@/lib/chains`: add `conflictMoves`, `type ShiftRow`; remove `inferChains`, `shiftPreview`, `type ChainNode`. Delete the `chainNodes`/`chainLinks` memos if Task 7 left them.

- [ ] **Step 3: The bar's words** — in `components/projects/ShiftPreview.tsx`:
  - import `moveFollowersAction` instead of `shiftFollowersAction`; `import type { Sheet } from '@/lib/sheet';`
  - `onApplied: (sheet: Sheet) => void;`
  - the "moved" span renders only when `self` exists; when `self.days === 0` (only the finish moved) it reads `now finishes {short date of self.toFinish}`; otherwise unchanged.
  - replace the followers block's text and buttons with:
    ```tsx
    <span className="text-xs text-muted-foreground">
      <strong className="text-foreground">{shift.followers[0].name}</strong>
      {shift.followers.length > 1 ? ` and ${shift.followers.length - 1} after it` : ''} now{' '}
      {shift.followers.length === 1 ? 'starts' : 'start'} before what they wait for.
    </span>
    <m.button
      type="button"
      whileTap={{ scale: 0.97 }}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await moveFollowersAction(projectId, shift.fromIds ?? [rowId]);
          if (res.ok) onApplied(res.sheet);
        })
      }
      className="btn-primary flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
    >
      <CheckCircle2 className="size-3.5" />
      {pending ? 'Moving…' : `Move ${shift.followers.length} ${shift.followers.length === 1 ? 'row' : 'rows'}`}
    </m.button>
    <button type="button" onClick={onDismiss} className="h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted">
      Keep dates
    </button>
    ```
  - Rewrite the file's doc comment's second paragraph: links are stored now (lib/links.ts); the offer moves each follower by the smallest amount that clears its link; "Keep dates" leaves the conflict visible in the strip and on the Gantt.
  - In `ScheduleSheet`, wherever `<ShiftPreviewBar … onApplied={…} />` is rendered, make it `onApplied={(sheet) => { applySheet(sheet); setShift(null); }}` and keep whatever else the old handler did.

- [ ] **Step 4: The strip** — create `components/projects/ConflictStrip.tsx`:

```tsx
'use client';

import { CircleAlert } from 'lucide-react';

import type { Network } from '@/lib/chains';

/**
 * The one standing reminder over the planner: activities whose typed dates
 * break a link, by name; each name opens that row's Links panel. Absent when
 * there are none. "Nothing waits for this yet" is a per-row chip, never a
 * strip: at the start every row would be on it.
 */
export default function ConflictStrip({
  network,
  names,
  onOpen,
}: {
  network: Network;
  names: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  const ids = [...network.rows.entries()].filter(([, r]) => r.conflicts.length > 0).map(([id]) => id);
  if (!ids.length) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-bad-soft px-3 py-2 text-xs text-bad sm:px-6">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      <span className="font-medium">
        {ids.length} {ids.length === 1 ? 'activity starts' : 'activities start'} before what they wait for:
      </span>
      {ids.map((id) => (
        <button key={id} type="button" onClick={() => onOpen(id)} className="min-h-8 rounded-md px-1.5 font-semibold underline-offset-2 hover:underline">
          {names.get(id) ?? id}
        </button>
      ))}
    </div>
  );
}
```
  Mount it in `ScheduleSheet` directly above the ShiftPreview bar:
  ```tsx
  <ConflictStrip
    network={network}
    names={nameById}
    onOpen={(id) => {
      setSelectedId(id);
      setMenuRow(rows.find((r) => r.id === id) ?? null);
      setMenuMode('menu'); // becomes 'links' in Task 9
    }}
  />
  ```
  (Use the sheet's actual setter names; read them where `RowMenu` is mounted.)

- [ ] **Step 5: Press it** — puppeteer script in the scratchpad against `dev-preview`, Merbau with Task 7's links: type a finish date 10 days later on row 1 in the sheet; assert the bar reads "… now starts before what they wait for." and "Move 1 row" (or more); press "Keep dates" → the strip names the follower; reload → still named. Type it again later, press "Move N rows" → strip gone; reload → the follower's start equals its link's bound. Shoot 1440 and 390 and look.

- [ ] **Step 6: Type-check, commit**

```bash
git add lib/chains.ts lib/sheet-actions.ts components/projects/ShiftPreview.tsx components/projects/ScheduleSheet.tsx components/projects/ConflictStrip.tsx
git commit -m "A date that breaks a link is asked about; kept conflicts are listed over the planner"
```

---

### Task 9: The Links panel

**Files:**
- Create: `lib/link-suggestions.ts`
- Create: `components/projects/LinksPanel.tsx`
- Modify: `components/projects/RowMenu.tsx`
- Modify: `components/projects/ScheduleSheet.tsx`
- Create: `app/api/projects/[id]/link-suggestions/route.ts` (EPC guesses, fetched when a panel opens)
- Modify: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Consumes: `WAY_LABEL`, `LINK_TYPES`, `StoredLink` (Task 1); `Network`, `wouldLoop`, `whySentence`, `inferChains`, `conflictMoves` (Task 2); `saveRowLinksAction` (Task 4); `unansweredLinks` from `lib/forecast-epc.ts`; `buildProjectDashboardData` from `lib/dashboard-db.ts`.
- Produces:
  ```ts
  // lib/link-suggestions.ts
  export function suggestionsFor(rows: Pick<SheetRow, 'id' | 'parentId' | 'isLeaf' | 'startDate' | 'finishDate' | 'links'>[], epc?: Record<string, string[]>): Map<string, string[]>;
  // RowMenu
  initialMode?: 'menu' | 'delete' | 'links';
  network: Network; rows: SheetRow[]; names: Map<string, string>; suggestions: string[]; onLinksSaved: (sheet: Sheet, touched: string[]) => void;
  // ScheduleSheet new prop
  // LinksPanel also takes projectId: string, to fetch EPC guesses
  ```

- [ ] **Step 1: Suggestions, tested** — above the marker line:

```ts
/* ------------------------------------------------------------- suggestions */

const { suggestionsFor } = await import('../lib/link-suggestions.ts');
const sugRows = [
  { id: 'p', parentId: 'g', isLeaf: true, startDate: '2026-01-01', finishDate: '2026-01-10', links: null },
  { id: 'q', parentId: 'g', isLeaf: true, startDate: '2026-01-11', finishDate: '2026-01-20', links: null },
  { id: 'r', parentId: 'g', isLeaf: true, startDate: '2026-01-21', finishDate: '2026-01-30', links: [] },
  { id: 'z', parentId: 'h', isLeaf: true, startDate: null, finishDate: null, links: null },
];
const sug = suggestionsFor(sugRows, { q: ['z', 'p', 'nope'] });
check('a row never asked gets the date guess and EPC order, once each', j(sug.get('q')) === j(['p', 'z']), j([...sug]));
check('a row that answered, even "nothing", gets no suggestion', !sug.has('r'));
```

  Implement `lib/link-suggestions.ts`:
```ts
/**
 * The guesses offered in the Links panel, one list per activity: the chain the
 * dates already describe (`inferChains`: siblings that start right after one
 * another) and EPC order's guess (`unansweredLinks`, worked out on the page
 * because it needs work kinds and ladders the sheet does not carry). Only for
 * activities nobody has answered (links === null). Each is applied by its own
 * press, never in bulk: a one-press "link everything" was shipped and removed
 * on 27 Sep 2026 because nothing showed what it had done.
 */
import { inferChains } from './chains';
import type { SheetRow } from './sheet';

export function suggestionsFor(
  rows: Pick<SheetRow, 'id' | 'parentId' | 'isLeaf' | 'startDate' | 'finishDate' | 'links'>[],
  epc: Record<string, string[]> = {}
): Map<string, string[]> {
  const asked = new Set(rows.filter((r) => r.links !== null).map((r) => r.id));
  const leaf = new Set(rows.filter((r) => r.isLeaf).map((r) => r.id));
  const out = new Map<string, string[]>();
  const add = (to: string, from: string) => {
    if (asked.has(to) || !leaf.has(to) || !leaf.has(from) || to === from) return;
    const list = out.get(to);
    if (!list) out.set(to, [from]);
    else if (!list.includes(from)) list.push(from);
  };
  const nodes = rows.map((r, i) => ({ id: r.id, parentId: r.parentId, order: i, isLeaf: r.isLeaf, startDate: r.startDate, finishDate: r.finishDate }));
  for (const l of inferChains(nodes)) add(l.toId, l.fromId);
  for (const [to, froms] of Object.entries(epc)) for (const from of froms) add(to, from);
  return out;
}
```
  (`'nope'` is not a row and is dropped; `'p'` arrives from both guesses and is listed once.)

  Run → PASS.

  EPC order's guesses are NOT worked out on the page (that would make every planner load pay for them). They come from a GET route, fetched only when a never-asked activity's Links panel opens. Create `app/api/projects/[id]/link-suggestions/route.ts` — first read an existing GET route in this repo (`app/api/weeks/[week]/photos/route.ts`) and copy its header exactly (runtime, `connection()` / dynamic handling under `cacheComponents`, how params are awaited):
  ```ts
  import { NextResponse } from 'next/server';
  import { connection } from 'next/server';

  import { buildProjectDashboardData } from '@/lib/dashboard-db';
  import { unansweredLinks } from '@/lib/forecast-epc';
  import { ensureFreshDb } from '@/lib/db-snapshot';

  /**
   * EPC order's link guesses for activities nobody has answered, for the
   * Links panel. A GET route and not a server action: a client READ goes
   * through a route with a retry (memory: never read through a server action).
   */
  export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    await connection();
    const { id } = await params;
    await ensureFreshDb();
    const items = buildProjectDashboardData(id)?.db.wbsItems ?? [];
    return NextResponse.json(Object.fromEntries(unansweredLinks(items)), { headers: { 'Cache-Control': 'no-store' } });
  }
  ```
  (If `ensureFreshDb` is not the name of the snapshot re-check other read routes call, use the one they call.)
  In `LinksPanel`, when `row.links === null`, fetch it once on mount with one retry, and merge: `const [epc, setEpc] = useState<string[]>([]); useEffect(() => { … fetch(\`/api/projects/${projectId}/link-suggestions\`) … setEpc(json[row.id] ?? []) … }, [row.id, row.links, projectId]);` — LinksPanel gains a `projectId: string` prop; the shown list is `[...suggestions, ...epc.filter((id) => !suggestions.includes(id))]`, date guesses first so the list never jumps above what is already on screen. A failed fetch shows nothing extra (the date guesses still stand); no error banner for a hint. `suggestionsFor` is then called WITHOUT the second argument in ScheduleSheet.

- [ ] **Step 2: `components/projects/LinksPanel.tsx`**

```tsx
'use client';

import { useMemo, useState, useTransition } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';

import { whySentence, wouldLoop, type Network } from '@/lib/chains';
import { LINK_TYPES, MAX_WAIT, WAY_LABEL, type LinkType, type StoredLink } from '@/lib/links';
import type { Sheet, SheetRow } from '@/lib/sheet';
import { saveRowLinksAction } from '@/lib/sheet-actions';
import { cn } from '@/lib/utils';

/**
 * One activity's links: what it waits for, what waits for it, and one sentence
 * saying why its date is what it is. Nothing is saved before Save. Native
 * inputs: both lists can run long (Radix per screen, never per row).
 *
 * A "holds up" entry's way is the FOLLOWER's: "After it finishes" there means
 * the follower starts after THIS activity finishes.
 */
export default function LinksPanel({
  row,
  rows,
  network,
  names,
  suggestions,
  onBack,
  onSaved,
}: {
  row: SheetRow;
  rows: SheetRow[];
  network: Network;
  names: Map<string, string>;
  suggestions: string[];
  onBack: () => void;
  onSaved: (sheet: Sheet, touched: string[]) => void;
}) {
  const logic = network.rows.get(row.id);
  const [waits, setWaits] = useState<StoredLink[]>(() => row.links ?? []);
  const [holds, setHolds] = useState<StoredLink[]>(() =>
    rows.flatMap((r) => (r.links ?? []).filter((l) => l.id === row.id).map((l) => ({ id: r.id, type: l.type, wait: l.wait })))
  );
  const [adding, setAdding] = useState<'waits' | 'holds' | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const why = whySentence(row.id, network, byId, names);

  // The graph as it would stand with this panel's edits, for the loop check.
  const draft = useMemo(
    () =>
      rows.map((r) => {
        if (r.id === row.id) return { ...r, links: waits };
        const rest = (r.links ?? []).filter((l) => l.id !== row.id);
        const h = holds.find((x) => x.id === r.id);
        return h ? { ...r, links: [...rest, { id: row.id, type: h.type, wait: h.wait }] } : { ...r, links: r.links === null ? null : rest };
      }),
    [rows, row.id, waits, holds]
  );
  const loops = (other: string, side: 'waits' | 'holds') =>
    Boolean(side === 'waits' ? wouldLoop(draft, other, row.id) : wouldLoop(draft, row.id, other));

  const chip = why.conflict
    ? null
    : logic?.setsProjectFinish
      ? { text: 'Sets the project finish', tone: 'bg-bad-soft text-bad' }
      : logic?.canSlip != null
        ? { text: `Can slip ${logic.canSlip} ${logic.canSlip === 1 ? 'day' : 'days'}`, tone: 'bg-muted text-foreground' }
        : logic && logic.outgoing.length === 0
          ? { text: 'Nothing waits for this yet', tone: 'bg-muted text-muted-foreground' }
          : { text: 'Not linked through to the finish yet', tone: 'bg-muted text-muted-foreground' };

  const contractGap =
    row.contractFinish && row.finishDate && row.contractFinish !== row.finishDate
      ? Math.round((Date.parse(row.finishDate + 'T00:00:00Z') - Date.parse(row.contractFinish + 'T00:00:00Z')) / 86_400_000)
      : 0;

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveRowLinksAction(row.id, waits, holds);
      if (!res.ok) return setError(res.error);
      onSaved(res.sheet, [row.id, ...waits.map((w) => w.id)]);
    });

  const clampWait = (v: string) => Math.max(0, Math.min(MAX_WAIT, Math.floor(Number(v) || 0)));

  const list = (side: 'waits' | 'holds') => {
    const items = side === 'waits' ? waits : holds;
    const set = side === 'waits' ? setWaits : setHolds;
    return items.map((l, i) => (
      <div key={l.id} className="mt-2 rounded-xl border p-2.5">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{names.get(l.id) ?? l.id}</span>
          {side === 'waits' && logic?.setsDateBy.includes(l.id) && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">Sets the date</span>
          )}
          <button type="button" aria-label={`Remove ${names.get(l.id) ?? ''}`} onClick={() => set(items.filter((_, k) => k !== i))} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <select
            aria-label="How it waits"
            value={l.type}
            onChange={(e) => set(items.map((x, k) => (k === i ? { ...x, type: e.target.value as LinkType } : x)))}
            className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-2 text-[13px]"
          >
            {LINK_TYPES.map((t) => (
              <option key={t} value={t}>
                {WAY_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="flex h-11 items-center gap-1.5 rounded-lg border px-2 text-[13px] text-muted-foreground">
            Wait
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_WAIT}
              value={l.wait}
              onChange={(e) => set(items.map((x, k) => (k === i ? { ...x, wait: clampWait(e.target.value) } : x)))}
              className="w-12 bg-transparent text-right tabular-nums text-foreground outline-none"
            />
            days
          </label>
        </div>
      </div>
    ));
  };

  const picker = (side: 'waits' | 'holds') => {
    const taken = new Set((side === 'waits' ? waits : holds).map((l) => l.id));
    const q = query.trim().toLowerCase();
    const shown = rows
      .filter((r) => r.isLeaf && r.id !== row.id && !taken.has(r.id))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.code.startsWith(q))
      .slice(0, 50);
    return (
      <div className="mt-2 rounded-xl border p-2">
        <label className="flex h-11 items-center gap-2 rounded-lg border px-2">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find an activity" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        </label>
        <ul className="mt-1 max-h-64 overflow-y-auto">
          {shown.map((r) => {
            const loop = loops(r.id, side);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={loop}
                  onClick={() => {
                    const add = { id: r.id, type: 'FS' as const, wait: 0 };
                    if (side === 'waits') setWaits([...waits, add]);
                    else setHolds([...holds, add]);
                    setAdding(null);
                    setQuery('');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-muted disabled:opacity-50"
                >
                  <span className="shrink-0 rounded bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  {loop && <span className="shrink-0 text-[11px] text-muted-foreground">Would loop back</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => setAdding(null)} className="mt-1 min-h-9 w-full rounded-lg text-[12px] text-muted-foreground hover:bg-muted">
          Close
        </button>
      </div>
    );
  };

  const addButton = (side: 'waits' | 'holds', label: string) =>
    adding === side ? (
      picker(side)
    ) : (
      <button
        type="button"
        onClick={() => {
          setAdding(side);
          setQuery('');
        }}
        className="mt-2 min-h-11 w-full rounded-xl border border-dashed border-primary/40 text-[13px] font-semibold text-primary"
      >
        {label}
      </button>
    );

  return (
    <div>
      <button type="button" onClick={onBack} className="-ml-1 flex h-9 items-center gap-1 rounded-lg px-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back
      </button>

      <div className={cn('mt-2 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed', why.conflict ? 'bg-bad-soft text-bad' : 'bg-muted/60')}>
        {why.text}
        {chip && <span className={cn('ml-2 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold', chip.tone)}>{chip.text}</span>}
        {contractGap !== 0 && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {Math.abs(contractGap)} {Math.abs(contractGap) === 1 ? 'day' : 'days'} {contractGap > 0 ? 'later' : 'earlier'} than contract
          </p>
        )}
      </div>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Waits for</p>
      {list('waits')}
      {addButton('waits', '+ Add what it waits for')}
      {row.links === null &&
        suggestions
          .filter((id) => !waits.some((w) => w.id === id))
          .map((id) => (
            <div key={id} className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="text-[11px] font-semibold">Suggested</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{names.get(id) ?? id}</span>
              <button type="button" onClick={() => setWaits([...waits, { id, type: 'FS', wait: 0 }])} className="min-h-9 rounded-full bg-primary/10 px-3 text-[12px] font-semibold text-primary">
                Use
              </button>
            </div>
          ))}

      <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Holds up</p>
      {list('holds')}
      {addButton('holds', '+ Add what waits for this')}

      {error && <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onBack} className="min-h-11 rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted">
          Cancel
        </button>
        <button type="button" disabled={pending} onClick={save} className="min-h-11 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground disabled:opacity-60">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire `RowMenu.tsx`**
  - Mode union: `useState<'menu' | 'unit' | 'delete' | 'links'>(initialMode)`; prop `initialMode?: 'menu' | 'delete' | 'links'`.
  - New props in the destructuring and type: `projectId: string; network: Network; rows: SheetRow[]; names: Map<string, string>; suggestions: string[]; onLinksSaved: (sheet: Sheet, touched: string[]) => void;` (import `type Network` from `@/lib/chains`, `Link2` from lucide-react). Load the panel lazily so the planner's first load does not carry it:
    ```ts
    const LinksPanel = dynamic(() => import('./LinksPanel'), { ssr: false });
    ```
    and render it inside its own `<Suspense fallback={null}>` (memory "Lazy overlay needs its own Suspense"). Warm the chunk when the ⋯ menu opens — `useEffect(() => { void import('./LinksPanel'); }, []);` in RowMenu — so pressing "Links" never waits for the network.
  - Give the Links `<Item>` the attribute `data-links-entry` (the perf probe presses it); if `Item` does not pass extra props through, add `{...rest}` to it.
  - First thing inside the `mode === 'menu'` list, for activities only:
    ```tsx
    {!row.isSummary && (
      <>
        <Item icon={<Link2 className="size-4" />} onClick={() => setMode('links')} disabled={pending}>
          Links: Waits for {row.links?.length ?? 0} · Holds up {rows.filter((r) => r.links?.some((l) => l.id === row.id)).length}
        </Item>
        <Divider />
      </>
    )}
    ```
  - Hide the phone date inputs and everything else while `mode === 'links'` (they are already gated on `mode === 'menu'`; check each block), and add:
    ```tsx
    {mode === 'links' && (
      <LinksPanel
        row={row}
        rows={rows}
        network={network}
        names={names}
        suggestions={suggestions}
        onBack={() => (initialMode === 'links' ? onClose() : setMode('menu'))}
        onSaved={(sheet, touched) => {
          onLinksSaved(sheet, touched);
          onClose();
        }}
      />
    )}
    ```
  In `ScheduleSheet`:
  - `const suggestions = useMemo(() => suggestionsFor(rows), [rows]);` and pass `projectId={projectId}` to `<RowMenu>` (RowMenu passes it to `LinksPanel`).
  - widen the `menuMode` state type to include `'links'`; ConflictStrip's `onOpen` sets `'links'`.
  - pass to `<RowMenu>`: `network={network} rows={rows} names={nameById} suggestions={suggestions.get(menuRow.id) ?? []}` and
    ```tsx
    onLinksSaved={(sheet, touched) => {
      applySheet(sheet);
      // A link that the plan already breaks: offer the move at once.
      const followers = conflictMoves(sheet.rows, touched, new Map(sheet.rows.map((r) => [r.id, r.name])));
      if (followers.length) {
        setShift({ rowId: touched[0], rowName: nameById.get(touched[0]) ?? '', preview: { moved: [], followers, fromDate: null, toDate: null, fromIds: touched } });
      }
    }}
    ```
  - `ShiftPreviewBar` must render with `moved: []`: guard every `shift.moved[0]` / `self` use (no "moved N days" span, no week list from `self`).

- [ ] **Step 4: Press it** — puppeteer, 390×844 and 1440×900: open Merbau, press ⋯ on an activity → "Links: Waits for 0 · Holds up 0"; press it → why sentence and chip visible; "+ Add what it waits for" → type part of a name → pick → way "After it starts", wait 3 → Save → panel closes; reopen → same values; reload → same; the Gantt draws an arrow entering on the left with "+3 days". Pick, for an activity that already holds this one up, the reverse direction → that entry is disabled "Would loop back". Change something and press Cancel → reload → nothing changed. Use a "Suggested" on a never-asked row → Save → stored. Shoot each state at both widths and look. Then the budget: production build, `node scripts/verify-projects-perf.mjs` three times; "Press ⋯" and "Press Links" inside budget, First Load JS within baseline + 15 kB; write the medians under the baseline as "after Task 9".

- [ ] **Step 5: Type-check, lint the touched files, commit**

```bash
git add lib/link-suggestions.ts components/projects/LinksPanel.tsx components/projects/RowMenu.tsx components/projects/ScheduleSheet.tsx app/api/projects/[id]/link-suggestions/route.ts scripts/verify-schedule-logic.ts
git commit -m "Links panel in the row menu: waits for, holds up, why, suggestions"
```

---

### Task 10: Drag between bar ends (desktop)

**Files:**
- Create: `components/projects/LinkDragCard.tsx`
- Modify: `components/projects/GanttChart.tsx`
- Modify: `components/projects/ScheduleSheet.tsx`

**Interfaces:**
- Consumes: `wouldLoop`, `WAY_LABEL`, `LINK_TYPES`, `MAX_WAIT`, `saveRowLinksAction`, `conflictMoves`.
- Produces: GanttChart prop `onLink?: (fromId: string, toId: string, type: LinkType) => void`.

- [ ] **Step 1: The card** — create `components/projects/LinkDragCard.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';

import { wouldLoop } from '@/lib/chains';
import { LINK_TYPES, MAX_WAIT, WAY_LABEL, type LinkType } from '@/lib/links';
import type { Sheet, SheetRow } from '@/lib/sheet';
import { saveRowLinksAction } from '@/lib/sheet-actions';

/** What a drag between two bar ends will save. Nothing is stored before Save. */
export default function LinkDragCard({
  from,
  to,
  initialType,
  rows,
  onDone,
  onCancel,
}: {
  from: SheetRow;
  to: SheetRow;
  initialType: LinkType;
  rows: SheetRow[];
  onDone: (sheet: Sheet) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<LinkType>(initialType);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const loop = wouldLoop(rows, from.id, to.id);
  const save = () =>
    start(async () => {
      setError(null);
      const own = [...(to.links ?? []).filter((l) => l.id !== from.id), { id: from.id, type, wait }];
      const holdsUp = rows.flatMap((r) => (r.links ?? []).filter((l) => l.id === to.id).map((l) => ({ id: r.id, type: l.type, wait: l.wait })));
      const res = await saveRowLinksAction(to.id, own, holdsUp);
      if (!res.ok) return setError(res.error);
      onDone(res.sheet);
    });
  return (
    <div role="dialog" aria-label="New link" className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,22rem)] -translate-x-1/2 rounded-2xl border bg-card p-4 text-[13px] shadow-lg">
      <p>
        <strong>{to.name}</strong> waits for <strong>{from.name}</strong>
      </p>
      <div className="mt-3 flex gap-2">
        <select aria-label="How it waits" value={type} onChange={(e) => setType(e.target.value as LinkType)} className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-2">
          {LINK_TYPES.map((t) => (
            <option key={t} value={t}>
              {WAY_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="flex h-11 items-center gap-1.5 rounded-lg border px-2 text-muted-foreground">
          Wait
          <input
            type="number"
            min={0}
            max={MAX_WAIT}
            value={wait}
            onChange={(e) => setWait(Math.max(0, Math.min(MAX_WAIT, Math.floor(Number(e.target.value) || 0))))}
            className="w-12 bg-transparent text-right text-foreground outline-none"
          />
          days
        </label>
      </div>
      {loop && <p className="mt-2 text-bad">Would loop back: {loop.map((id) => names.get(id) ?? id).join(' → ')}</p>}
      {error && <p className="mt-2 text-bad">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-full px-4 text-muted-foreground hover:bg-muted">
          Cancel
        </button>
        <button type="button" disabled={pending || Boolean(loop)} onClick={save} className="min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-50">
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Handles and the drag in `GanttChart.tsx`**
  - imports: `useSyncExternalStore` from react; `type LinkType` from `@/lib/links`.
  - prop `onLink?: (fromId: string, toId: string, type: LinkType) => void;`
  - inside the component:
    ```ts
    // A mouse, not a finger: on touch a handle is a mis-tap waiting to happen,
    // and the Links panel does the job there.
    const fine = useSyncExternalStore(
      (cb) => {
        const m = window.matchMedia('(pointer: fine)');
        m.addEventListener('change', cb);
        return () => m.removeEventListener('change', cb);
      },
      () => window.matchMedia('(pointer: fine)').matches,
      () => false
    );
    type End = 'start' | 'finish';
    // A drag never goes through React state while it moves: the pointer fires
    // ~120 times a second and re-rendering 185 bars that often is the jank the
    // budget forbids. The line and the target ring are written straight into
    // two SVG elements, once per frame. React hears about the drag twice: when
    // it starts (to show the layer) and when it ends (onLink).
    const dragRef = useRef<{ fromId: string; fromEnd: End; x0: number; y0: number; target: { id: string; end: End } | null } | null>(null);
    const [dragging, setDragging] = useState(false);
    const lineRef = useRef<SVGPathElement>(null);
    const ringRef = useRef<SVGCircleElement>(null);
    const frame = useRef(0);
    const bodyRef = useRef<HTMLDivElement>(null);
    const endDrag = () => {
      dragRef.current = null;
      cancelAnimationFrame(frame.current);
      setDragging(false);
    };
    useEffect(() => {
      if (!dragging) return;
      const esc = (e: KeyboardEvent) => e.key === 'Escape' && endDrag();
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    }, [dragging]);
    const wayOf = (a: End, b: End): LinkType | null => (a === 'finish' && b === 'start' ? 'FS' : a === 'start' && b === 'start' ? 'SS' : a === 'finish' && b === 'finish' ? 'FF' : null);
    ```
  - give the body div `ref={bodyRef}` and:
    ```tsx
    onPointerMove={(e) => {
      const drag = dragRef.current;
      if (!drag || !bodyRef.current) return;
      const box = bodyRef.current.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const row = rows[Math.floor(y / rowH)];
      let target: { id: string; end: End } | null = null;
      let tx = 0;
      if (row && row.id !== drag.fromId && !row.isSummary && row.startDate && row.finishDate) {
        const sx = xOf(row.startDate);
        const fx = xOf(row.finishDate) + scale;
        const end: End = Math.abs(x - sx) <= Math.abs(x - fx) ? 'start' : 'finish';
        if (Math.min(Math.abs(x - sx), Math.abs(x - fx)) <= 16 && wayOf(drag.fromEnd, end)) {
          target = { id: row.id, end };
          tx = end === 'start' ? sx : fx;
        }
      }
      drag.target = target;
      const ty = Math.floor(y / rowH) * rowH + rowH / 2;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        lineRef.current?.setAttribute('d', `M${drag.x0} ${drag.y0} L${x} ${y}`);
        if (ringRef.current) {
          ringRef.current.setAttribute('cx', String(tx));
          ringRef.current.setAttribute('cy', String(ty));
          ringRef.current.style.opacity = target ? '1' : '0';
        }
      });
    }}
    onPointerUp={() => {
      const drag = dragRef.current;
      if (drag?.target && onLink) {
        const way = wayOf(drag.fromEnd, drag.target.end);
        if (way) onLink(drag.fromId, drag.target.id, way);
      }
      endDrag();
    }}
    ```
  - on each task bar button add the class `group`, and inside it, when `fine && onLink && !bracket`:
    ```tsx
    {(['start', 'finish'] as const).map((end) => (
      <span
        key={end}
        aria-hidden
        data-link-handle={end}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          bodyRef.current?.setPointerCapture(e.pointerId);
          const ex = end === 'start' ? x : x + w;
          const ey = y + rowH / 2;
          dragRef.current = { fromId: r.id, fromEnd: end, x0: ex, y0: ey, target: null };
          setDragging(true);
        }}
        className="absolute top-1/2 z-[8] size-3 -translate-y-1/2 cursor-crosshair rounded-full border-2 bg-card opacity-0 transition-opacity group-hover:opacity-100"
        style={{ [end === 'start' ? 'left' : 'right']: -6, borderColor: color }}
      />
    ))}
    ```
  - a SEPARATE small SVG for the drag (not inside the memoised arrow layer, so starting a drag does not rebuild the arrows), rendered only while `dragging`, as a sibling of `{arrowLayer}`:
    ```tsx
    {dragging && (
      <svg aria-hidden className="pointer-events-none absolute left-0 top-0 z-[9] overflow-visible" width={width} height={bodyH}>
        <path ref={lineRef} d="" stroke="var(--primary)" strokeWidth={1.75} strokeDasharray="4 3" fill="none" />
        <circle ref={ringRef} r={7} fill="none" stroke="var(--primary)" strokeWidth={2} style={{ opacity: 0, transition: 'opacity 120ms var(--ease-ios)' }} />
      </svg>
    )}
    ```
  - The card in Step 3 loads lazily: in ScheduleSheet `const LinkDragCard = dynamic(() => import('./LinkDragCard'), { ssr: false });`, rendered inside its own `<Suspense fallback={null}>`; warm it with `void import('./LinkDragCard')` in the handle's `onPointerDown` so it is ready on release.
  - After Step 4's presses, the budget: production build, `node scripts/verify-projects-perf.mjs` three times; "drag long task max" ≤ 50 ms; write the medians under the baseline as "after Task 10".

- [ ] **Step 3: ScheduleSheet** — state `const [pendingLink, setPendingLink] = useState<{ fromId: string; toId: string; type: LinkType } | null>(null);`, pass `onLink={(fromId, toId, type) => setPendingLink({ fromId, toId, type })}` to `<GanttChart>`, and render:
  ```tsx
  {pendingLink && (() => {
    const from = rows.find((r) => r.id === pendingLink.fromId);
    const to = rows.find((r) => r.id === pendingLink.toId);
    if (!from || !to) return null;
    return (
      <LinkDragCard
        from={from}
        to={to}
        initialType={pendingLink.type}
        rows={rows}
        onCancel={() => setPendingLink(null)}
        onDone={(sheet) => {
          applySheet(sheet);
          setPendingLink(null);
          const followers = conflictMoves(sheet.rows, [from.id], new Map(sheet.rows.map((r) => [r.id, r.name])));
          if (followers.length) setShift({ rowId: to.id, rowName: to.name, preview: { moved: [], followers, fromDate: null, toDate: null, fromIds: [from.id] } });
        }}
      />
    );
  })()}
  ```

- [ ] **Step 4: Press it** — puppeteer at 1440×900: hover a bar → two handles visible; drag (mouse down on the right handle, move, up near the left end of another bar) → card "B waits for A", way "After it finishes"; Save → arrow drawn; reload → still there. Drag from B's right handle to A's left end → card shows "Would loop back: …" and Save is disabled. Start a drag, press Escape → no card. At 390×844 with touch emulation (`page.emulate` an iPhone) → no handles in the DOM. Shoot and look.

- [ ] **Step 5: Type-check, commit**

```bash
git add components/projects/LinkDragCard.tsx components/projects/GanttChart.tsx components/projects/ScheduleSheet.tsx
git commit -m "Gantt: drag from one bar end to another to make a link (mouse only)"
```

---

### Task 11: Lock as contract

**Files:**
- Create: `lib/contract-sqlite.ts`
- Modify: `lib/sheet-actions.ts` (`lockContractAction`)
- Create: `components/projects/LockContract.tsx`
- Modify: `app/projects/[id]/page.tsx` (header)
- Modify: `scripts/verify-schedule-logic.ts`

**Interfaces:**
- Consumes: `Sheet.contract`, `SheetRow.contractStart/contractFinish` (Task 3); `getActiveBaselineId` (`lib/sheet.ts`); `ConfirmDialog` (`components/ui/ConfirmDialog.tsx`: props `open, title, message: ReactNode, confirmLabel, busyLabel?, busy?, destructive?, onConfirm, onCancel`).
- Produces:
  ```ts
  export function lockContractSqlite(projectId: string, reason: string): { baselineId: string; rows: number };
  export async function lockContractAction(projectId: string, reason: string): Promise<{ ok: true; rows: number } | { ok: false; error: string }>;
  ```

- [ ] **Step 1: Failing test** — above the marker line:

```ts
/* ---------------------------------------------------------------- contract */

const { lockContractSqlite } = await import('../lib/contract-sqlite.ts');
check('a reason is required', refuses(() => lockContractSqlite(proj, '   '), 'reason'));
const lockedAt = lockContractSqlite(proj, 'Signed kick-off plan');
const afterLock = getSheet(proj);
const scheduledLeaves = afterLock.rows.filter((x) => x.isLeaf && x.startDate);
check('every scheduled activity is copied', lockedAt.rows === scheduledLeaves.length, `${lockedAt.rows} vs ${scheduledLeaves.length}`);
check('the sheet reads the contract', afterLock.contract?.reason === 'Signed kick-off plan' && scheduledLeaves.every((x) => x.contractStart === x.startDate && x.contractFinish === x.finishDate));
check('a second lock is refused', refuses(() => lockContractSqlite(proj, 'again'), 'already'));
check('the plan still writes to the active baseline', afterLock.baselineId === sheet.baselineId);
```

- [ ] **Step 2: Run → `Cannot find module '…/lib/contract-sqlite.ts'`.**

- [ ] **Step 3: Implement `lib/contract-sqlite.ts`**

```ts
/**
 * "Lock as contract": today's plan, copied once as the contractual baseline.
 * The plan stays editable; this copy never moves, and nothing in the app
 * unlocks it (revisions are board item 18). approvedBy stays empty until login
 * exists (board 22): the reason is what makes the lock arguable later.
 */
import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { db, schema } from './sqlite';
import { getActiveBaselineId } from './sheet';

export function lockContractSqlite(projectId: string, reason: string): { baselineId: string; rows: number } {
  const why = reason.trim();
  if (!why) throw new Error('Say why this plan is the contract: a reason is required');
  const exists = db
    .select({ id: schema.baselines.id })
    .from(schema.baselines)
    .where(and(eq(schema.baselines.projectId, projectId), eq(schema.baselines.kind, 'contractual')))
    .all()[0];
  if (exists) throw new Error('This project already has a contract');
  const active = getActiveBaselineId(projectId);
  if (!active) throw new Error('This project has no schedule yet');
  const leaves = new Set(
    db
      .select({ id: schema.wbsNodes.id })
      .from(schema.wbsNodes)
      .where(and(eq(schema.wbsNodes.projectId, projectId), eq(schema.wbsNodes.isLeaf, true)))
      .all()
      .map((n) => n.id)
  );
  const schedules = db
    .select()
    .from(schema.nodeSchedules)
    .where(eq(schema.nodeSchedules.baselineId, active))
    .all()
    .filter((s) => leaves.has(s.nodeId));
  const baselineId = `${projectId}:contractual`;
  db.transaction((tx) => {
    tx.insert(schema.baselines)
      .values({ id: baselineId, projectId, kind: 'contractual', revisionNo: 0, label: 'Contract', reason: why, approvedAt: new Date().toISOString() })
      .run();
    for (const s of schedules) {
      tx.insert(schema.nodeSchedules)
        .values({ id: randomUUID(), baselineId, nodeId: s.nodeId, startDate: s.startDate, finishDate: s.finishDate, durationDays: s.durationDays })
        .run();
    }
  });
  return { baselineId, rows: schedules.length };
}
```
  `lib/sheet-actions.ts`:
```ts
import { lockContractSqlite } from './contract-sqlite';

/** "Lock as contract" in the Projects header. */
export async function lockContractAction(projectId: string, reason: string): Promise<{ ok: true; rows: number } | { ok: false; error: string }> {
  await beforeWrite();
  try {
    const { rows } = lockContractSqlite(projectId, reason);
    await landed();
    return { ok: true, rows };
  } catch (e) {
    return fail(e);
  }
}
```
Run → PASS.

- [ ] **Step 4: The button** — `components/projects/LockContract.tsx`:

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { lockContractAction } from '@/lib/sheet-actions';

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });

/** Lock today's plan as the contract, once. Afterwards only says when it was locked. */
export default function LockContract({ projectId, lockedAt, activities }: { projectId: string; lockedAt: string | null; activities: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (lockedAt) {
    return (
      <span className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted-foreground sm:h-9">
        <Lock className="size-3.5" aria-hidden />
        Contract locked {DATE.format(new Date(lockedAt.slice(0, 10) + 'T00:00:00Z'))}
      </span>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted sm:h-9">
        <Lock className="size-3.5" aria-hidden />
        Lock as contract
      </button>
      <ConfirmDialog
        open={open}
        title="Lock this plan as the contract?"
        destructive={false}
        confirmLabel="Lock as contract"
        busyLabel="Locking…"
        busy={pending}
        message={
          <div className="space-y-3">
            <p>
              Copies today&apos;s plan of {activities} activities as the contract. The plan stays editable; the contract never moves.
            </p>
            <label className="block text-[12px] font-medium text-muted-foreground">
              Why is this the contract?
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border bg-card px-3 py-2 text-[13px] text-foreground" />
            </label>
            {error && <p className="text-[12.5px] text-bad">{error}</p>}
          </div>
        }
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onConfirm={() =>
          start(async () => {
            if (!reason.trim()) return setError('Say why this plan is the contract.');
            const res = await lockContractAction(projectId, reason);
            if (!res.ok) return setError(res.error);
            setOpen(false);
            router.refresh();
          })
        }
      />
    </>
  );
}
```
  Match the trigger's look to `ProjectDetails`' trigger (read it and copy its class string so the two buttons sit as a pair). Mount in `app/projects/[id]/page.tsx` beside `<ProjectDetails project={project} />`:
  ```tsx
  <LockContract projectId={id} lockedAt={sheet.contract?.lockedAt ?? null} activities={sheet.rows.filter((r) => r.isLeaf && r.startDate).length} />
  ```
  The sheet takes `rows` as a seed and owns them (see `ScheduleSheet`), so `router.refresh()` alone may not bring the contract bars in. Press it (Step 5): if the bars do not appear without a full reload, have ScheduleSheet re-read on `contract` prop change — it already has a `syncRows()` re-read used after failures; call it from an effect keyed on the `contract` prop.

- [ ] **Step 5: Press it** on Merbau, 1440 and 390: "Lock as contract" → dialog → confirm with an empty reason → the sentence "Say why this plan is the contract." appears and nothing is stored (reload, button still there); type a reason → Lock → the badge "Contract locked …" replaces the button; grey contract bars under each task; change one activity's finish 5 days later → its bar moves, its contract bar stays, its Links panel says "5 days later than contract". Reload → all still true. Shoot and look. Reset Merbau with `seed-demo.ts` afterwards.

- [ ] **Step 6: Commit**

```bash
git add lib/contract-sqlite.ts lib/sheet-actions.ts components/projects/LockContract.tsx app/projects/[id]/page.tsx components/projects/ScheduleSheet.tsx scripts/verify-schedule-logic.ts
git commit -m "Lock as contract: today's plan copied once, drawn under each bar"
```

---

### Task 12: Prove it end to end, and write it down

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Every verify script that touches this**

```
node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-forecast.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-forecast-store.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-priority-actions.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-paste.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-dashboard-figures.ts
node --import ./scripts/ts-resolve.mjs scripts/verify-sheet-columns.ts
node scripts/verify-sheet-optimistic.mjs
```
Expected: all PASS.

- [ ] **Step 2: Screens, looked at** — Merbau with links, one kept conflict and a contract: Projects at 1440×900 and 390×844; Data Overall's activity panel ("What has to finish before this one?" lists the new links by name, read only). Then the full budget table: production build, the probe three times, every row inside budget against the Task 0 baseline; write the final medians under it. Any row over budget is fixed before Step 4, not reported as done.

- [ ] **Step 3: Build**

```bash
npx next build > build.log 2>&1; echo $?
```
Expected: `0`; `grep -n "Uncached data" build.log` → nothing.

- [ ] **Step 4: AGENTS.md** — add, at the end of "# Setup, weights and the plan curve":

```markdown
**Links are made in Projects and checked, never scheduled** (7 Oct 2026, spec
`docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md`). Three ways
(after it finishes / after it starts / finishes after it finishes) with a wait
of 0+ days, stored as `{id, type, wait}` in `wbs_nodes.waits_for` on the row
that waits; a bare string id from before reads as FS + 0 (`lib/links.ts`).
`analyseNetwork` in `lib/chains.ts` is the one reading: `getSheet`,
`validateWeek`, the Gantt and the Links panel all call it. Plan dates stay
typed; a link the plan breaks is offered a move (later only, by exactly the
overrun) and, declined, stays red and listed over the planner and in Check.
"Can slip" is shown only for rows linked through to the finish: the old rule
gave every unlinked row float to the project end. The screen never says
FS/SS/FF, lag, float or critical. `lib/links-sqlite.ts` is the only writer and
`pruneLinks` runs in both `renumber()` copies. "Lock as contract" copies the
plan once into a `contractual` baseline; nothing in the app unlocks it.
```

- [ ] **Step 5: Commit, reset the demo, ask before pushing**

```bash
git add AGENTS.md
git commit -m "AGENTS: links are made in Projects and checked, never scheduled"
node --import ./scripts/ts-resolve.mjs scripts/seed-demo.ts
git status --short
```
`git status` must show no `data/` change staged. Tell the user what shipped, list any "Moved figures" from Task 5, and ask "Push?". Never push without a yes; after a push, check the deployment before saying done.
