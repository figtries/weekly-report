# Daily Report Fill-in Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the daily report form with a card screen whose day opens as yesterday already filled in, with a timed "Today so far" log, AOC/AFH, and progress read from weekly.

**Architecture:** Pure logic lives in three small `lib/` modules (`daily-items`, `daily-status`, `daily-progress`) proved by one verify script. The screen is a client component that owns an optimistic copy of the report (`useDailyReport`) and writes each change through one new server action that does NOT call `refresh()`. Eight section cards share one `SectionCard`. Entrance is CSS keyframes; framer-motion only for what a press causes.

**Tech Stack:** Next.js 16.2.9 (cacheComponents), React 19.2, framer-motion 13 (`m`), lucide-react, Tailwind 4, shadcn tokens, node `--import ./scripts/ts-resolve.mjs` for verify scripts.

**Spec:** `docs/superpowers/specs/2026-09-30-daily-report-screen-design.md`

## Global Constraints

- The app is English. Every label, button and message in the new screen is English; report data stays as typed. Labels are capital-first ("Same as yesterday", "Plan 42%"). No em dash in any visible string.
- NO new colour, font or radius. Cards are `rounded-lg border-border bg-card shadow-sm`; the hero is the `OverviewHero` surface from `components/weekly/WbsTreeVisual.tsx:542`; chips are fixed-width `rounded-lg` rectangles (never capsules) in the raw pairs `STATUS_LEGEND` uses (`bg-emerald-50 text-emerald-700`, `bg-blue-50 text-blue-700`, `bg-amber-50 text-amber-700`, `bg-gray-100 text-gray-500`). Actual is `chart-1` blue, plan is `chart-2` red.
- Touch targets at least 44px on phones (`min-h-11`), nothing that appears only on hover, every real thing has a pressable control.
- Entrance on load is CSS keyframes (`animate-enter`, `stagger-1`..`stagger-8`, `animate-rise-in`), never a framer-motion `initial` written into server HTML. Framer-motion (`m`) only for what a person's action causes, always through `MOTION` from `lib/design.ts` (`ease`, `duration`, `spring`) and `pressMotion` from `components/motion/Press`. `layout` animations pass `transition={MOTION.spring}` explicitly.
- Radix never per row. Inside cards use native `<input>`/`<select>`. `/print/*` stays free of Radix and framer-motion.
- Progress is read from weekly, never typed. No figure while `weightGate` fails (the card says "Held until the weights reach 100%").
- Writes are awaited server actions; reads stay in the RSC page. No `refresh()` on autosave.
- Verify UI by screenshot (`scripts/shoot.mjs`) at 390px, 768px and desktop and by pressing the real buttons. Never `next build` into `.next`: use `NEXT_DIST_DIR=.next-verify`, write to a file, echo `$?`. Temp dist dirs are named `.next-preview-*`. Never write `/dev/null` as an argument to a Node script.
- Files under `lib/` and `components/` are CRLF: match the file's line endings when patching. Do not run prettier. `git add <path>` one file at a time, then `git diff --cached --name-only`; never `git add -A` (other sessions write into this tree).
- Tests that press buttons write to `data/db.json`: finish with `git checkout -- data/db.json`.

## File Structure

Create:
- `lib/daily-items.ts` list parsing, legacy strings, hours-each inference, suggestions
- `lib/daily-status.ts` `sectionStates`, `lapsedPermits`, `daysLapsed`, `readyCount`
- `lib/daily-progress.ts` `dailyProgressFor` (pure)
- `scripts/verify-daily-carry.ts` the proof for all of the above plus the create/patch mutations
- `components/daily/useDailyReport.ts` optimistic state, ordered writes, revert
- `components/daily/fields.tsx` `NumField`, `TextField`, `Stepper`, `useHydrated`, `INPUT_CLS`
- `components/daily/SectionCard.tsx` the card, its chip, `CardButton`, `CardProps`
- `components/daily/DailyHero.tsx` the hero with the 8-segment meter
- `components/daily/TodayLog.tsx` the timed log
- `components/daily/DailyReportScreen.tsx` composition
- `components/daily/cards/{Weather,ManHours,Ptw,Hse,Activities,Aoc,Progress,Photos}Card.tsx`

Modify: `lib/types.ts`, `lib/mutations.ts`, `lib/actions.ts`, `lib/data.ts`, `app/daily/[date]/page.tsx`, `app/daily/page.tsx`, `components/daily/DailyReportsView.tsx`, `app/print/daily/[date]/page.tsx`, `components/print/DailyPrintReport.tsx`, `docs/superpowers/specs/2026-09-30-daily-report-screen-design.md`, `AGENTS.md`.

Delete: `components/daily/DailyForm.tsx` (and `saveDailyAction` once nothing calls it).

---

### Task 1: Types and list helpers

**Files:**
- Modify: `lib/types.ts` (ManHourRow, after HseRow, DailyReport)
- Create: `lib/daily-items.ts`
- Create: `scripts/verify-daily-carry.ts` (first part)

**Interfaces:**
- Produces: types `ActivityItem`, `AocRow`, `LogKind`, `LogEntry`, `DailySectionKey`, `DailyPatch`; `ManHourRow.hoursEach?`; `DailyReport.{todayItems,tomorrowItems,aoc,aocNone,log,confirmed}?`
- Produces (`lib/daily-items.ts`): `parseLegacyItems(text, prefix, done): ActivityItem[]`, `todayItemsOf(r)`, `tomorrowItemsOf(r)`, `joinItems(items)`, `activityStrings(today, tomorrow)`, `inferHoursEach(row)`, `hoursEachOf(row)`, `suggestActivities(reports, taken, limit?)`

- [ ] **Step 1: Write the failing test.** Create `scripts/verify-daily-carry.ts`:

```ts
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
import type { DailyReport } from '../lib/types.ts';

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

// LATER TASKS APPEND CHECKS ABOVE THIS LINE.
if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nall checks passed');
```

- [ ] **Step 2: Run it to see it fail.** Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-daily-carry.ts`. Expected: fails with `Cannot find module` for `lib/daily-items.ts`.

- [ ] **Step 3: Add the types.** In `lib/types.ts` replace `ManHourRow` with:

```ts
export interface ManHourRow {
  id: string;
  company: string;
  pobQty: number;
  /**
   * Hours each person works per day. When it is set, `todayHours` is
   * `pobQty × hoursEach` (the workbook's own formula: 8 for office, 12 for
   * site), which is what lets a report be filled by counting heads. Absent on
   * rows written before the fill-in screen: `hoursEachOf` infers it.
   */
  hoursEach?: number;
  previousHours: number;
  todayHours: number;
}
```

Immediately after `HseRow`, add:

```ts
export interface ActivityItem {
  id: string;
  text: string;
  /** Today's list: it was done. Tomorrow's list: unused, always false. */
  done: boolean;
}

export interface AocRow {
  id: string;
  type: 'AOC' | 'AFH';
  description: string;
  date: string;
  actionBy: string;
  status: string;
}

export type LogKind = 'activity' | 'hse' | 'ptw' | 'note';

/** A timed line in "Today so far". Records what a person DID, not totals. */
export interface LogEntry {
  id: string;
  /** ISO instant. */
  at: string;
  kind: LogKind;
  text: string;
}

export type DailySectionKey =
  | 'weather'
  | 'manHours'
  | 'ptw'
  | 'hse'
  | 'activities'
  | 'aoc'
  | 'progress'
  | 'photos';
```

In `DailyReport`, after `photos`, add (all optional so every stored report still reads):

```ts
  /** The fill-in screen's lists. Absent on older reports: read them through `todayItemsOf` / `tomorrowItemsOf`. */
  todayItems?: ActivityItem[];
  tomorrowItems?: ActivityItem[];
  aoc?: AocRow[];
  aocNone?: boolean;
  log?: LogEntry[];
  /** Sections a person has said are right. Undefined means an older report, see `sectionStates`. */
  confirmed?: Partial<Record<DailySectionKey, true>>;
```

After the `DailyReport` interface add: `export type DailyPatch = Partial<Omit<DailyReport, 'date'>>;`

- [ ] **Step 4: Write `lib/daily-items.ts`:**

```ts
import type { ActivityItem, DailyReport, ManHourRow } from './types';

// "1. x", "2) x", "- x". The mark must be followed by whitespace so "2.5 m pipe" keeps its number.
const LIST_MARK = /^\s*(?:\d+\s*[.)]|[-•*])(?=\s)\s*/;

export function parseLegacyItems(text: string, prefix: string, done: boolean): ActivityItem[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(LIST_MARK, '').trim())
    .filter(Boolean)
    .map((t, i) => ({ id: `${prefix}-${i + 1}`, text: t, done }));
}

/** What a report says it did today. Legacy text was typed AFTER the fact, so it counts as done. */
export function todayItemsOf(r: Pick<DailyReport, 'todayItems' | 'activitiesToday'>): ActivityItem[] {
  return r.todayItems ?? parseLegacyItems(r.activitiesToday, 'lt', true);
}

export function tomorrowItemsOf(r: Pick<DailyReport, 'tomorrowItems' | 'activitiesTomorrow'>): ActivityItem[] {
  return r.tomorrowItems ?? parseLegacyItems(r.activitiesTomorrow, 'lm', false);
}

export function joinItems(items: ActivityItem[]): string {
  return items.map((it, i) => `${i + 1}. ${it.text}`).join('\n');
}

/**
 * The two legacy strings, derived, so `/print/daily` and old readers keep
 * working. Today prints only what was DONE: an unticked plan is not a fact.
 */
export function activityStrings(today: ActivityItem[], tomorrow: ActivityItem[]) {
  return {
    activitiesToday: joinItems(today.filter((i) => i.done)),
    activitiesTomorrow: joinItems(tomorrow),
  };
}

/** Hours each person worked, when the row divides evenly (the workbook: 24/3, 84/7, 12/1). */
export function inferHoursEach(r: Pick<ManHourRow, 'pobQty' | 'todayHours'>): number | undefined {
  return r.pobQty > 0 && r.todayHours > 0 && r.todayHours % r.pobQty === 0
    ? r.todayHours / r.pobQty
    : undefined;
}

export function hoursEachOf(r: ManHourRow): number {
  return r.hoursEach ?? inferHoursEach(r) ?? 0;
}

/**
 * Sentences this project has already used, newest report first, deduplicated
 * and minus what the open report already holds. Tapping one is the whole cost
 * of an activity that repeats.
 */
export function suggestActivities(reports: DailyReport[], taken: string[], limit = 8): string[] {
  const seen = new Set(taken.map((t) => t.trim().toLowerCase()));
  const out: string[] = [];
  const newestFirst = [...reports].sort((a, b) => b.date.localeCompare(a.date));
  for (const r of newestFirst) {
    for (const it of [...todayItemsOf(r), ...tomorrowItemsOf(r)]) {
      const key = it.text.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(it.text.trim());
      if (out.length >= limit) return out;
    }
  }
  return out;
}
```

- [ ] **Step 5: Run the script again.** Run: `node --import ./scripts/ts-resolve.mjs scripts/verify-daily-carry.ts`. Expected: six `ok` lines then `all checks passed`.

---

### Task 2: Carry-forward, patching with a log, and the autosave action

**Files:**
- Modify: `lib/mutations.ts` (`applyCreateDaily`, `applyPatchDaily`, imports)
- Modify: `lib/actions.ts` (add `patchDailyAction`; `saveDailyAction` is removed in Task 7)
- Modify: `scripts/verify-daily-carry.ts`

**Interfaces:**
- Consumes: Task 1 helpers and types.
- Produces: `applyCreateDaily(db, date): DailyReport` (now carries OPEN permits, tomorrow into today, hours each); `applyPatchDaily(db, date, patch, log?): DailyReport` (merges `confirmed`, appends `log`); `patchDailyAction(date, patch, log?): Promise<ActionResult>`

- [ ] **Step 1: Append failing checks** above the `// LATER TASKS` line in the verify script. Add to the imports `import { applyCreateDaily, applyPatchDaily } from '../lib/mutations.ts'; import type { Database } from '../lib/types.ts';` then:

```ts
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
  applyPatchDaily(db, '2026-03-11', { confirmed: { manHours: true }, activitiesToday: 'x' }, { id: 'l1', at: '2026-03-11T02:30:00.000Z', kind: 'hse', text: 'Near Miss +1' });
  const r = db.daily[0];
  assert.deepEqual(r.confirmed, { hse: true, manHours: true });
  assert.equal(r.activitiesToday, 'x');
  assert.deepEqual(r.log?.map((l) => l.id), ['l1']);
  applyPatchDaily(db, '2026-03-11', { hariKe: 5 });
  assert.equal(db.daily[0].log?.length, 1);
  assert.throws(() => applyPatchDaily(db, '2030-01-01', {}), /not found/);
});
```

- [ ] **Step 2: Run it, expect failure** (`office.hoursEach` undefined / `r.ptw` empty). Command as Task 1 Step 5.

- [ ] **Step 3: Implement.** In `lib/mutations.ts` change the type import to include `ActivityItem`, `DailyPatch`, `LogEntry`, `PtwRow` and add `import { inferHoursEach, tomorrowItemsOf } from './daily-items';`. Replace the `manHours` const in `applyCreateDaily` and the `report` literal so the function reads:

```ts
  const manHours: ManHourRow[] = last
    ? last.manHours.map((r) => {
        const hoursEach = r.hoursEach ?? inferHoursEach(r);
        return {
          ...r,
          hoursEach,
          previousHours: r.previousHours + r.todayHours,
          // Today opens as yesterday did: the same people for the same hours.
          todayHours: hoursEach !== undefined ? r.pobQty * hoursEach : 0,
        };
      })
    : getCatalogs(db).crew.map((c) => ({
        id: c.id,
        company: c.label,
        pobQty: 0,
        previousHours: 0,
        todayHours: 0,
      }));
```

and, before `const report`, add:

```ts
  // A permit that is still OPEN does not stop being open at midnight.
  const ptw: PtwRow[] = last
    ? last.ptw.filter((p) => p.status.trim().toUpperCase() === 'OPEN').map((p) => ({ ...p }))
    : [];
  // What yesterday planned for today is today's list, unticked. Weather,
  // photos, the log and every confirmation start empty on purpose.
  const todayItems: ActivityItem[] = last
    ? tomorrowItemsOf(last).map((it, i) => ({ id: `${date}-a${i + 1}`, text: it.text, done: false }))
    : [];
```

In the `report` literal use `ptw,` (instead of `ptw: []`) and after `activitiesTomorrow: '',` add `todayItems, tomorrowItems: [], aoc: [], log: [], confirmed: {},`. Leave `planPct: 0, actualPct: 0` with the comment `// no longer written: progress is read from weekly`.

Replace `applyPatchDaily` with:

```ts
export function applyPatchDaily(
  db: Database,
  date: string,
  patch: DailyPatch,
  log?: LogEntry
): DailyReport {
  const report = db.daily.find((d) => d.date === date);
  if (!report) throw new Error(`Daily report for ${date} not found`);
  const { confirmed, ...rest } = patch;
  Object.assign(report, rest);
  // Confirmations merge, so two rapid writes cannot un-confirm each other.
  if (confirmed) report.confirmed = { ...report.confirmed, ...confirmed };
  // The log entry rides in the SAME write as the change it describes, so the
  // timeline can never show something the report does not hold.
  if (log) report.log = [...(report.log ?? []), log];
  return report;
}
```

In `lib/actions.ts` extend the types import with `DailyPatch, LogEntry`, and add after `saveDailyAction`:

```ts
/**
 * Autosave for the fill-in screen. Unlike `saveDailyAction` it does NOT call
 * `refresh()`: the screen owns its own optimistic copy, and re-rendering the
 * whole page after every +1 tap is a second, staler source of truth (and the
 * refreshed payload can land behind a newer tap on the deployment).
 */
export async function patchDailyAction(
  date: string,
  patch: DailyPatch,
  log?: LogEntry
): Promise<ActionResult> {
  try {
    await mutateOpenDb((db) => applyPatchDaily(db, date, patch, log));
    updateTag('db');
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
```

- [ ] **Step 4: Run the script.** Expected: nine `ok` lines, `all checks passed`.

---

### Task 3: Section states and weekly progress

**Files:**
- Create: `lib/daily-status.ts`, `lib/daily-progress.ts`
- Modify: `lib/data.ts` (`OpenProjectStatus`, `getOpenProjectStatus`)
- Modify: `scripts/verify-daily-carry.ts`

**Interfaces:**
- Consumes: Task 1 helpers, `weekOfDate` (`lib/weeks.ts`), `shownDiff` (`lib/figures.ts`).
- Produces: `type SectionState = 'ready'|'same'|'look'|'empty'|'held'`; `SECTION_ORDER: DailySectionKey[]`; `sectionStates(report, progress): Record<DailySectionKey, SectionState>`; `lapsedPermits(report): PtwRow[]`; `daysLapsed(validity, date): number`; `readyCount(states): number`; `DailyProgress`; `dailyProgressFor(status, date): DailyProgress | null`; `getProjectStatus(id)` and `OpenProjectStatus.anchorEnd`.

- [ ] **Step 1: Append failing checks** (add imports `import { lapsedPermits, daysLapsed, readyCount, sectionStates } from '../lib/daily-status.ts'; import { dailyProgressFor } from '../lib/daily-progress.ts';`):

```ts
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
  // week 1 ends 2025-10-30, so 2025-11-29 is inside week 5 (Nov 27 to Dec 3 is week 5's block).
  const p = dailyProgressFor(STATUS, '2025-12-01');
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
```

- [ ] **Step 2: Run, expect failure** (module not found).

- [ ] **Step 3: Write `lib/daily-progress.ts`:**

```ts
import { shownDiff } from './figures';
import { weekOfDate } from './weeks';

/** The slice of `OpenProjectStatus` (lib/data.ts) this needs, so nothing client-side imports the data layer. */
export interface ProjectStatusLike {
  week: number;
  ready: boolean;
  weightsTotal: number;
  /** Week ONE's end date, as `weekOfDate` expects. */
  anchorEnd: string;
  byWeek: Record<number, { actual: number; plan: number }>;
}

export interface DailyProgress {
  state: 'ready' | 'held';
  week: number;
  actual: number;
  plan: number;
  variance: number;
  weightsTotal: number;
}

/**
 * A daily report does not ask for a percentage: what matters is the weekly
 * figure, so the day reads the week it falls in, and never a week beyond the
 * project's current one. While the weights do not close there is no figure
 * (lib/weight-gate.ts), the same rule as every other surface.
 */
export function dailyProgressFor(status: ProjectStatusLike | null, date: string): DailyProgress | null {
  if (!status) return null;
  if (!status.ready) {
    return { state: 'held', week: status.week, actual: 0, plan: 0, variance: 0, weightsTotal: status.weightsTotal };
  }
  const raw = status.anchorEnd ? weekOfDate(status.anchorEnd, date) : status.week;
  const week = Math.max(1, Math.min(raw, status.week));
  const fig = status.byWeek[week] ?? status.byWeek[status.week];
  if (!fig) return null;
  return {
    state: 'ready',
    week,
    actual: fig.actual,
    plan: fig.plan,
    variance: shownDiff(fig.actual, fig.plan),
    weightsTotal: status.weightsTotal,
  };
}
```

- [ ] **Step 4: Write `lib/daily-status.ts`:**

```ts
import { todayItemsOf } from './daily-items';
import type { DailyProgress } from './daily-progress';
import type { DailyReport, DailySectionKey, PtwRow } from './types';

export type SectionState = 'ready' | 'same' | 'look' | 'empty' | 'held';

/** The order on the sheet and in the hero meter. */
export const SECTION_ORDER: DailySectionKey[] = [
  'weather', 'manHours', 'ptw', 'hse', 'activities', 'aoc', 'progress', 'photos',
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** OPEN permits whose validity ended before the report's date. */
export function lapsedPermits(report: DailyReport): PtwRow[] {
  return report.ptw.filter(
    (p) => p.status.trim().toUpperCase() === 'OPEN' && ISO.test(p.validity) && p.validity < report.date
  );
}

export function daysLapsed(validity: string, date: string): number {
  return Math.round((Date.parse(date) - Date.parse(validity)) / DAY_MS);
}

/**
 * ONE answer per section, so the hero count, the chips and the proof cannot
 * disagree. Nothing is `ready` until a person said so, except what they entered
 * and what the app derives (progress).
 *
 * A report written before the fill-in screen has no `confirmed` at all: its
 * crew, permits, HSE and activities were typed by hand, so they count as
 * confirmed. AOC did not exist, so it is not.
 */
export function sectionStates(
  report: DailyReport,
  progress: DailyProgress | null
): Record<DailySectionKey, SectionState> {
  const c = report.confirmed ?? { manHours: true, ptw: true, hse: true, activities: true };
  const w = report.weather;
  const anyWeather = w.hujanDeras || w.hujanSedang || w.berawanMendung || w.cerahTerang;
  return {
    weather: anyWeather ? 'ready' : 'look',
    manHours: c.manHours ? 'ready' : report.manHours.some((r) => r.pobQty > 0) ? 'same' : 'empty',
    ptw: lapsedPermits(report).length > 0 ? 'look' : c.ptw ? 'ready' : report.ptw.length > 0 ? 'same' : 'empty',
    hse: c.hse || report.hseInput.some((r) => r.today > 0) ? 'ready' : 'same',
    activities: c.activities ? 'ready' : todayItemsOf(report).length > 0 ? 'same' : 'empty',
    aoc: c.aoc || report.aocNone || (report.aoc ?? []).length > 0 ? 'ready' : 'empty',
    progress: !progress ? 'empty' : progress.state === 'ready' ? 'ready' : 'held',
    photos: report.photos.some(Boolean) ? 'ready' : 'empty',
  };
}

export function readyCount(states: Record<DailySectionKey, SectionState>): number {
  return SECTION_ORDER.filter((k) => states[k] === 'ready').length;
}
```

- [ ] **Step 5: Patch `lib/data.ts`.** Add `anchorEnd: string;` to `OpenProjectStatus` (doc: "Week one's end date, so a day can find its week"). Split `getOpenProjectStatus` so the body lives in a new exported `getProjectStatus(id)`:

```ts
export async function getOpenProjectStatus(): Promise<OpenProjectStatus | null> {
  const id = await getActiveProjectId();
  if (!id) return null;
  return getProjectStatus(id);
}

/**
 * The same, for a NAMED project: the daily PDF is told which project it is for
 * and cannot ask. Reads the clock through `currentWeekOf`, so call it after a
 * request read.
 */
export async function getProjectStatus(id: string): Promise<OpenProjectStatus | null> {
  const db = buildProjectDashboardData(id)?.db;
  // ...the existing body from `if (!db || db.weeks.length === 0) return null;` down, unchanged...
}
```

In both `return` statements of the moved body add `anchorEnd: db.project.weekAnchorEndDate` (the not-ready return and the final return).

- [ ] **Step 6: Run the script.** Expected: all `ok`, `all checks passed`. If the week arithmetic assertion for `2025-12-01` differs, recompute by hand from `weekOfDate` (anchor `2025-10-30` is week 1's END, so week 5 spans 2025-11-27 to 2025-12-03) and fix the fixture date, not the function.

---

### Task 4: The screen shell (hook, fields, card, hero, log, composition, page)

**Files:**
- Create: `components/daily/useDailyReport.ts`, `components/daily/fields.tsx`, `components/daily/SectionCard.tsx`, `components/daily/DailyHero.tsx`, `components/daily/TodayLog.tsx`, `components/daily/DailyReportScreen.tsx`
- Modify: `app/daily/[date]/page.tsx`

**Interfaces:**
- Consumes: Tasks 1 to 3, `patchDailyAction`.
- Produces: `useDailyReport(initial)` returning `{ report, commit, retry, failed, pending, setPhotos, flush }`; `Commit = (patch: DailyPatch, log?: LogDraft) => void`; `newId(prefix)`; `CardProps`; `SectionCard`, `CardButton`, `sameLabel`; `NumField`, `TextField`, `Stepper`, `useHydrated`; `LogRow`.

- [ ] **Step 1: `components/daily/useDailyReport.ts`:**

```ts
'use client';

import { useCallback, useRef, useState } from 'react';
import { patchDailyAction } from '@/lib/actions';
import type { DailyPatch, DailyReport, LogEntry } from '@/lib/types';

export type LogDraft = Pick<LogEntry, 'kind' | 'text'>;
export type Commit = (patch: DailyPatch, log?: LogDraft) => void;

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

interface Failed {
  patch: DailyPatch;
  log?: LogEntry;
}

/**
 * The screen's one copy of the report.
 *
 * A change shows at once and is written in the background, ONE WRITE AT A TIME
 * and in the order it was made (the store is single-writer: two in flight can
 * land out of order). A write that fails puts back exactly what it changed and
 * leaves a "Try again". The ref is only touched in handlers, never in render.
 */
export function useDailyReport(initial: DailyReport) {
  const [report, setReport] = useState(initial);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<Failed | null>(null);
  const latest = useRef(initial);
  const failedRef = useRef<Failed | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const markFailed = useCallback((f: Failed | null) => {
    failedRef.current = f;
    setFailed(f);
  }, []);

  const write = useCallback(
    (patch: DailyPatch, log: LogEntry | undefined, before: DailyReport) => {
      setPending((n) => n + 1);
      queue.current = queue.current.then(async () => {
        try {
          const res = await patchDailyAction(before.date, patch, log);
          if (!res.ok) throw new Error(res.error);
          markFailed(null);
        } catch {
          // Put back only what this write changed.
          const cur = { ...latest.current } as unknown as Record<string, unknown>;
          for (const k of Object.keys(patch)) cur[k] = (before as unknown as Record<string, unknown>)[k];
          if (log) cur.log = (latest.current.log ?? []).filter((e) => e.id !== log.id);
          latest.current = cur as unknown as DailyReport;
          setReport(latest.current);
          markFailed({ patch, log });
        } finally {
          setPending((n) => n - 1);
        }
      });
    },
    [markFailed]
  );

  const run = useCallback(
    (patch: DailyPatch, log?: LogEntry) => {
      const before = latest.current;
      const next: DailyReport = {
        ...before,
        ...patch,
        confirmed: patch.confirmed ? { ...before.confirmed, ...patch.confirmed } : before.confirmed,
        log: log ? [...(before.log ?? []), log] : before.log,
      };
      latest.current = next;
      setReport(next);
      write(patch, log, before);
    },
    [write]
  );

  const commit = useCallback<Commit>(
    (patch, draft) => run(patch, draft ? { id: newId('log'), at: new Date().toISOString(), ...draft } : undefined),
    [run]
  );

  const retry = useCallback(() => {
    const f = failedRef.current;
    if (f) run(f.patch, f.log);
  }, [run]);

  // Photos are written by their own route; the screen only mirrors the list.
  const setPhotos = useCallback((photos: (string | null)[]) => {
    latest.current = { ...latest.current, photos };
    setReport(latest.current);
  }, []);

  /** Resolves true when every queued write has landed and none failed. For the PDF button. */
  const flush = useCallback(async () => {
    await queue.current;
    return failedRef.current === null;
  }, []);

  return { report, commit, retry, failed, pending, setPhotos, flush };
}
```

- [ ] **Step 2: `components/daily/fields.tsx`:**

```tsx
'use client';

import { m } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';

export const INPUT_CLS =
  'min-h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1 sm:min-h-9';

/** True once hydrated. Clock times are shown in the viewer's zone, which the server cannot know. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/** A number that commits on blur or Enter. Focus selects it, so typing over a shown 0 just works. */
export function NumField({
  value,
  onCommit,
  label,
  min = 0,
  max,
  step,
  className,
}: {
  value: number;
  onCommit: (n: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const raw = draft === '' ? min : Number(draft);
        const n = Math.min(max ?? Infinity, Math.max(min, Number.isFinite(raw) ? raw : min));
        setDraft(null);
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={cn(INPUT_CLS, 'text-right tabular-nums', className)}
    />
  );
}

/** Text that commits on blur (and Enter, when single-line). */
export function TextField({
  value,
  onCommit,
  label,
  placeholder,
  multiline,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft === null) return;
    const v = draft.trim();
    setDraft(null);
    if (v !== value) onCommit(v);
  };
  if (multiline) {
    return (
      <textarea
        aria-label={label}
        rows={2}
        placeholder={placeholder}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        className={cn(INPUT_CLS, 'resize-none', className)}
      />
    );
  }
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={cn(INPUT_CLS, className)}
    />
  );
}

const STEP_BTN =
  'flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-chart-1 transition-colors hover:bg-muted disabled:opacity-40';

export function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="flex items-center" role="group" aria-label={label}>
      <m.button
        type="button"
        {...pressMotion}
        className={STEP_BTN}
        aria-label={`Decrease ${label}`}
        disabled={value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
      >
        <Minus className="size-4" />
      </m.button>
      <span className="w-10 text-center text-lg font-semibold tabular-nums text-foreground">{value}</span>
      <m.button
        type="button"
        {...pressMotion}
        className={STEP_BTN}
        aria-label={`Increase ${label}`}
        onClick={() => onChange(value + 1)}
      >
        <Plus className="size-4" />
      </m.button>
    </div>
  );
}
```

- [ ] **Step 3: `components/daily/SectionCard.tsx`:**

```tsx
'use client';

import { AnimatePresence, m } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Expand } from '@/components/motion/Expand';
import { pressMotion } from '@/components/motion/Press';
import { buttonVariants } from '@/components/ui/button';
import type { SectionState } from '@/lib/daily-status';
import { MOTION } from '@/lib/design';
import type { DailyReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { Commit } from './useDailyReport';

/** The raw pairs `STATUS_LEGEND` in WbsTreeVisual uses. No colour of its own. */
const CHIP: Record<SectionState, { label: string; cls: string }> = {
  ready: { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700' },
  same: { label: 'Same as yesterday', cls: 'bg-blue-50 text-blue-700' },
  look: { label: 'Needs a look', cls: 'bg-amber-50 text-amber-700' },
  empty: { label: 'Empty', cls: 'bg-gray-100 text-gray-500' },
  held: { label: 'Held', cls: 'bg-gray-100 text-gray-500' },
};

/** The first report of a project has no yesterday to be the same as. */
export const sameLabel = (hasPredecessor: boolean) => (hasPredecessor ? 'Same as yesterday' : 'To confirm');

export interface CardProps {
  report: DailyReport;
  commit: Commit;
  state: SectionState;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  hasPredecessor: boolean;
}

export function CardButton({
  variant = 'outline',
  className,
  ...props
}: { variant?: 'default' | 'outline' } & Omit<ComponentProps<typeof m.button>, 'ref'>) {
  return (
    <m.button
      type="button"
      {...pressMotion}
      className={cn(buttonVariants({ variant }), 'min-h-11 flex-1 sm:min-h-9', className as string)}
      {...props}
    />
  );
}

export function SectionCard({
  id,
  icon,
  title,
  summary,
  state,
  chipLabel,
  open,
  onToggle,
  actions,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  state: SectionState;
  chipLabel?: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const chip = CHIP[state];
  return (
    <section
      id={`daily-${id}`}
      className={cn(
        'scroll-mt-4 rounded-lg border bg-card shadow-sm transition-colors duration-200 ease-ios',
        state === 'look' ? 'border-amber-300 bg-amber-50/40' : 'border-border'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`daily-${id}-body`}
        className="flex min-h-14 w-full items-center gap-3 p-3 text-left sm:p-4"
      >
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', chip.cls)}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block text-[13px] leading-snug text-muted-foreground">{summary}</span>
        </span>
        <AnimatePresence initial={false} mode="wait">
          <m.span
            key={`${state}:${chipLabel ?? ''}`}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: MOTION.duration * 0.6, ease: [...MOTION.ease] }}
            className={cn(
              'inline-flex h-7 w-28 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold',
              chip.cls
            )}
          >
            {chipLabel ?? chip.label}
          </m.span>
        </AnimatePresence>
        <m.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown className="size-4" />
        </m.span>
      </button>
      <Expand open={!open && !!actions}>
        <div className="flex flex-wrap gap-2 px-3 pb-3 sm:px-4 sm:pb-4">{actions}</div>
      </Expand>
      <Expand open={open}>
        <div id={`daily-${id}-body`} className="border-t border-border p-3 sm:p-4">
          {children}
        </div>
      </Expand>
    </section>
  );
}
```

- [ ] **Step 4: `components/daily/DailyHero.tsx`** (the `OverviewHero` surface, the meter and legend patterns copied from `WbsTreeVisual.tsx:542-616`):

```tsx
'use client';

import { m } from 'framer-motion';
import type { ReactNode } from 'react';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { SECTION_ORDER, type SectionState } from '@/lib/daily-status';
import { MOTION } from '@/lib/design';
import type { DailySectionKey } from '@/lib/types';
import { NumField } from './fields';

// The raw colours STATUS_LEGEND draws its meter with (emerald-500, blue-500, amber-400, gray-200).
const SEGMENT: Record<SectionState, string> = {
  ready: '#10b981',
  same: '#3b82f6',
  look: '#fbbf24',
  empty: '#e5e7eb',
  held: '#e5e7eb',
};

const LEGEND: { keys: SectionState[]; label: string; chip: string; dot: string }[] = [
  { keys: ['ready'], label: 'Ready', chip: 'text-emerald-700', dot: 'bg-emerald-500' },
  { keys: ['same'], label: 'To confirm', chip: 'text-blue-700', dot: 'bg-blue-500' },
  { keys: ['look'], label: 'Needs a look', chip: 'text-amber-700', dot: 'bg-amber-400' },
  { keys: ['empty', 'held'], label: 'Empty', chip: 'text-gray-500', dot: 'bg-gray-300' },
];

export default function DailyHero({
  weekday,
  subtitle,
  states,
  ready,
  hariKe,
  onHariKe,
  pending,
  failed,
  onRetry,
  pdf,
}: {
  weekday: string;
  subtitle: string;
  states: Record<DailySectionKey, SectionState>;
  ready: number;
  hariKe: number | null;
  onHariKe: (n: number) => void;
  pending: number;
  failed: boolean;
  onRetry: () => void;
  pdf: ReactNode;
}) {
  return (
    <section className="animate-rise-in overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-400">Daily report</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">{weekday}</h1>
          {subtitle && <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">{pdf}</div>
      </div>

      <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-end md:gap-8">
        <div className="shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Parts ready</p>
          <p className="mt-1 flex items-baseline gap-1.5 text-4xl font-semibold text-foreground">
            <AnimatedNumber value={ready} decimals={0} duration={600} />
            <span className="text-lg font-medium text-gray-400">of {SECTION_ORDER.length}</span>
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-[10px] bg-gray-100 sm:h-9" aria-hidden>
            {SECTION_ORDER.map((k) => (
              <m.div
                key={k}
                className="h-full flex-1"
                initial={false}
                animate={{ backgroundColor: SEGMENT[states[k]] }}
                transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {LEGEND.map((l) => {
              const n = SECTION_ORDER.filter((k) => l.keys.includes(states[k])).length;
              if (n === 0) return null;
              return (
                <span key={l.label} className={`flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium ${l.chip}`}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${l.dot}`} />
                  {l.label}
                  <span className="font-semibold tabular-nums text-gray-900">{n}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-2">
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Day no.</span>
            <NumField label="Day number" min={1} max={7} value={hariKe ?? 1} onCommit={onHariKe} className="w-16 text-center" />
          </label>
          <p aria-live="polite" className="min-h-5 text-[12px] font-medium text-gray-400">
            {failed ? (
              <button type="button" onClick={onRetry} className="text-red-500 underline underline-offset-2">
                Not saved. Try again
              </button>
            ) : pending > 0 ? (
              'Saving…'
            ) : (
              'All changes saved'
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: `components/daily/TodayLog.tsx`:**

```tsx
'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Camera, FileCheck2, ListChecks, ShieldCheck, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { MOTION } from '@/lib/design';
import type { LogKind } from '@/lib/types';
import { useHydrated } from './fields';

export interface LogRow {
  id: string;
  at: string;
  kind: LogKind | 'photo';
  text: string;
  thumb?: string;
}

const KIND: Record<LogRow['kind'], { label: string; Icon: typeof Camera; dot: string }> = {
  photo: { label: 'Photo', Icon: Camera, dot: 'bg-blue-500' },
  activity: { label: 'Activity', Icon: ListChecks, dot: 'bg-blue-500' },
  hse: { label: 'HSE', Icon: ShieldCheck, dot: 'bg-amber-400' },
  ptw: { label: 'Permit', Icon: FileCheck2, dot: 'bg-blue-500' },
  note: { label: 'Note', Icon: StickyNote, dot: 'bg-gray-400' },
};

const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function TodayLog({ rows }: { rows: LogRow[] }) {
  const hydrated = useHydrated();
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => b.at.localeCompare(a.at));
  const shown = all ? sorted : sorted.slice(0, 3);

  return (
    <section className="rounded-lg border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Today so far</h2>
        <span className="text-[12px] font-medium tabular-nums text-gray-400">{rows.length} logged</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
          Nothing logged yet. Photos, activities, HSE taps and permits added today appear here with their time.
        </p>
      ) : (
        <ol className="mt-3 ml-1.5 border-l-2 border-blue-100 pl-4">
          <AnimatePresence initial={false}>
            {shown.map((r) => {
              const { label, Icon, dot } = KIND[r.kind];
              return (
                <m.li
                  key={r.id}
                  layout="position"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={MOTION.spring}
                  className="relative mb-2 flex items-center gap-3 rounded-lg border border-border p-2.5"
                >
                  <span className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-card ${dot}`} />
                  {r.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumb} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                      <Icon className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-gray-400">
                      {hydrated ? timeOf(r.at) : '--:--'} · {label}
                    </span>
                    <span className="block text-[13px] font-medium leading-snug text-foreground">{r.text}</span>
                  </span>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}

      {sorted.length > 3 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 min-h-11 w-full rounded-lg text-[13px] font-semibold text-chart-1 transition-colors hover:bg-muted sm:min-h-9"
        >
          {all ? 'Show fewer' : `All ${sorted.length}`}
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 6: `components/daily/DailyReportScreen.tsx`** (imports the eight cards from Tasks 5 and 6; write this file last of the batch, and expect a compile error until those exist):

```tsx
'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { PressLink, pressMotion } from '@/components/motion/Press';
import SavePdfButton from '@/components/print/SavePdfButton';
import type { DailyProgress } from '@/lib/daily-progress';
import { readyCount, sectionStates, SECTION_ORDER } from '@/lib/daily-status';
import type { DailyReport, DailySectionKey } from '@/lib/types';
import { cn } from '@/lib/utils';
import ActivitiesCard from './cards/ActivitiesCard';
import AocCard from './cards/AocCard';
import HseCard from './cards/HseCard';
import ManHoursCard from './cards/ManHoursCard';
import PhotosCard from './cards/PhotosCard';
import ProgressCard from './cards/ProgressCard';
import PtwCard from './cards/PtwCard';
import WeatherCard from './cards/WeatherCard';
import DailyHero from './DailyHero';
import TodayLog, { type LogRow } from './TodayLog';
import { useDailyReport } from './useDailyReport';

export interface DailyScreenProps {
  initial: DailyReport;
  project: { name: string; location: string };
  weatherLabels: Record<string, string>;
  hasPredecessor: boolean;
  progress: DailyProgress | null;
  suggestions: string[];
  /** Photo path to the instant it was taken (or uploaded), for "Today so far". */
  photoTimes: Record<string, string>;
}

export default function DailyReportScreen(props: DailyScreenProps) {
  const { initial, project, weatherLabels, hasPredecessor, progress, suggestions } = props;
  const router = useRouter();
  const { report, commit, retry, failed, pending, setPhotos, flush } = useDailyReport(initial);
  const [open, setOpen] = useState<DailySectionKey | null>(null);
  const [times, setTimes] = useState(props.photoTimes);

  const states = useMemo(() => sectionStates(report, progress), [report, progress]);
  const ready = readyCount(states);

  // An upload is written by its own route and announced on the window. Mirror
  // the list, and stamp each new path with the moment it arrived.
  useEffect(() => {
    function onPhotos(e: Event) {
      const d = (e as CustomEvent).detail as { uploadUrl?: string; photos?: (string | null)[] } | null;
      if (d?.uploadUrl !== `/api/daily/${initial.date}/photos` || !Array.isArray(d.photos)) return;
      const photos = d.photos;
      setTimes((prev) => {
        const next = { ...prev };
        for (const p of photos) if (p && !next[p]) next[p] = new Date().toISOString();
        return next;
      });
      setPhotos(photos);
    }
    window.addEventListener('photos-updated', onPhotos);
    return () => window.removeEventListener('photos-updated', onPhotos);
  }, [initial.date, setPhotos]);

  const rows = useMemo<LogRow[]>(
    () => [
      ...(report.log ?? []),
      ...report.photos.flatMap((p, i) =>
        p && times[p] ? [{ id: `photo-${p}`, at: times[p], kind: 'photo' as const, text: `Photo ${i + 1}`, thumb: p }] : []
      ),
    ],
    [report.log, report.photos, times]
  );

  const weekday = new Date(`${report.date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  });

  const shared = (k: DailySectionKey) => ({
    report,
    commit,
    state: states[k],
    open: open === k,
    onToggle: () => setOpen((cur) => (cur === k ? null : k)),
    onOpen: () => setOpen(k),
    hasPredecessor,
  });

  const cards: Record<DailySectionKey, ReactNode> = {
    weather: <WeatherCard {...shared('weather')} labels={weatherLabels} />,
    manHours: <ManHoursCard {...shared('manHours')} />,
    ptw: <PtwCard {...shared('ptw')} />,
    hse: <HseCard {...shared('hse')} />,
    activities: <ActivitiesCard {...shared('activities')} suggestions={suggestions} />,
    aoc: <AocCard {...shared('aoc')} />,
    progress: <ProgressCard {...shared('progress')} progress={progress} />,
    photos: <PhotosCard {...shared('photos')} />,
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <PressLink
        {...pressMotion}
        href="/daily"
        onClick={() => router.refresh()}
        className="inline-flex min-h-11 items-center gap-2 text-muted-foreground transition-colors duration-200 ease-ios hover:text-foreground sm:min-h-0"
        aria-label="Back to daily reports"
      >
        <ArrowLeft className="size-5" />
        <span className="text-sm font-medium">Back</span>
      </PressLink>

      <DailyHero
        weekday={weekday}
        subtitle={[project.name, project.location].filter(Boolean).join(' · ')}
        states={states}
        ready={ready}
        hariKe={report.hariKe}
        onHariKe={(n) => commit({ hariKe: n })}
        pending={pending}
        failed={!!failed}
        onRetry={retry}
        pdf={
          <SavePdfButton
            url={`/api/pdf/daily/${report.date}`}
            filename={`Daily Report ${report.date}.pdf`}
            ariaLabel="Save Daily Report as PDF"
            beforeDownload={flush}
          />
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="animate-enter stagger-1 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:self-start">
          <TodayLog rows={rows} />
        </div>
        <div className="grid content-start items-start gap-3 md:grid-cols-2 lg:col-start-1 lg:row-start-1">
          {SECTION_ORDER.map((k, i) => (
            <div key={k} className={cn('animate-enter', `stagger-${Math.min(i + 2, 8)}`, open === k && 'md:col-span-2')}>
              {cards[k]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Rewrite `app/daily/[date]/page.tsx`'s `DailyDetail`.** Keep `generateStaticParams`, the report lookup and the not-found branch exactly as they are. Replace the imports of `ScrollReveal`, `DailyForm`, `PhotoUploadGrid` with:

```ts
import { getOpenJsonDb, getOpenProjectStatus, getWorkspace } from '@/lib/data';
import { suggestActivities } from '@/lib/daily-items';
import { dailyProgressFor } from '@/lib/daily-progress';
import DailyReportScreen from '@/components/daily/DailyReportScreen';
import type { Database, DailyReport } from '@/lib/types';
```

and replace the final `return (...)` of `DailyDetail` with:

```tsx
  // After getOpenJsonDb(), which read the project cookie: a request read has
  // happened, so the clock `getOpenProjectStatus` reads is allowed here.
  const status = await getOpenProjectStatus();
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <DailyReportScreen
        initial={report}
        project={{ name: db.project.name, location: db.project.workLocation }}
        weatherLabels={labels}
        hasPredecessor={db.daily.some((d) => d.date < date)}
        progress={dailyProgressFor(status, date)}
        suggestions={suggestActivities(db.daily.filter((d) => d.date !== date), [], 24)}
        photoTimes={photoTimesOf(db, report)}
      />
    </div>
  );
```

Add above `DailyDetail`:

```ts
/**
 * When each photo was taken, for "Today so far": the camera's time when it falls
 * on the report's own date, otherwise the moment it was uploaded (a gallery photo
 * from last week was not taken today).
 */
function photoTimesOf(db: Database, report: DailyReport): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of report.photos) {
    const meta = p ? db.photoMeta?.[p] : undefined;
    if (!p || !meta) continue;
    out[p] = meta.takenAt && meta.takenAt.slice(0, 10) === report.date ? meta.takenAt : meta.uploadedAt;
  }
  return out;
}
```

(`Database`/`DailyReport` come from `@/lib/types`; drop the type import if the file already has them.)

- [ ] **Step 8: Type-check** after Tasks 5 and 6 exist (see Task 8). Nothing to run yet.

---

### Task 5: Cards for Weather, Man Hours, Permit to Work, HSE

**Files:** Create `components/daily/cards/{Weather,ManHours,Ptw,Hse}Card.tsx`.

**Interfaces:**
- Consumes: `CardProps`, `SectionCard`, `CardButton`, `sameLabel`, `NumField`, `TextField`, `Stepper`, `newId`, `hoursEachOf`, `lapsedPermits`, `daysLapsed`, `DateField` (`@/components/ui/DateField`, props `value`, `onChange`, `placeholder`, `clearable`, `className`).
- Produces: default-exported components taking `CardProps` (plus `labels` for Weather).

- [ ] **Step 1: `WeatherCard.tsx`:**

```tsx
'use client';

import { CloudSun } from 'lucide-react';
import type { WeatherInfo } from '@/lib/types';
import { INPUT_CLS, TextField } from '../fields';
import { CardButton, SectionCard, type CardProps } from '../SectionCard';

const SLOTS = [
  ['hujanDeras', 'hujanDerasJam'],
  ['hujanSedang', 'hujanSedangJam'],
  ['berawanMendung', 'berawanMendungJam'],
  ['cerahTerang', 'cerahTerangJam'],
] as const;

export default function WeatherCard({
  report, commit, state, open, onToggle, labels,
}: CardProps & { labels: Record<string, string> }) {
  const w = report.weather;
  const patch = (p: Partial<WeatherInfo>) => commit({ weather: { ...w, ...p } });
  const picked = SLOTS.filter(([k]) => w[k]).map(([k]) => labels[k] ?? k);
  const summary = picked.length ? `${picked.join(' · ')} · ${w.waktuMulai} to ${w.waktuSelesai}` : 'Not entered yet';

  return (
    <SectionCard
      id="weather"
      icon={<CloudSun className="size-[18px]" />}
      title="Weather"
      summary={summary}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        picked.length === 0 ? (
          <div className="grid w-full grid-cols-2 gap-2">
            {SLOTS.map(([k]) => (
              <CardButton key={k} onClick={() => patch({ [k]: true } as Partial<WeatherInfo>)}>
                {labels[k] ?? k}
              </CardButton>
            ))}
          </div>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {SLOTS.map(([k, j]) => (
          <div key={k} className="flex min-h-11 items-center gap-3 rounded-lg border border-border px-3 py-1.5">
            <input
              type="checkbox"
              aria-label={labels[k] ?? k}
              checked={w[k]}
              onChange={(e) => patch({ [k]: e.target.checked } as Partial<WeatherInfo>)}
              className="size-5 shrink-0 rounded border-input accent-[var(--chart-1)]"
            />
            <span className="flex-1 text-sm text-foreground">{labels[k] ?? k}</span>
            <TextField
              label={`${labels[k] ?? k} hours`}
              placeholder="hrs"
              value={w[j]}
              onCommit={(v) => patch({ [j]: v.replace(/[^0-9.]/g, '') } as Partial<WeatherInfo>)}
              className="w-16 px-2 text-xs"
            />
          </div>
        ))}
      </div>
      <div className="mt-3 grid max-w-md grid-cols-2 gap-3">
        <label className="block text-xs font-medium text-muted-foreground">
          Start time
          <input type="time" value={w.waktuMulai} onChange={(e) => patch({ waktuMulai: e.target.value })} className={`${INPUT_CLS} mt-1`} />
        </label>
        <label className="block text-xs font-medium text-muted-foreground">
          End time
          <input type="time" value={w.waktuSelesai} onChange={(e) => patch({ waktuSelesai: e.target.value })} className={`${INPUT_CLS} mt-1`} />
        </label>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 2: `ManHoursCard.tsx`:**

```tsx
'use client';

import { m } from 'framer-motion';
import { Users, X } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import { hoursEachOf } from '@/lib/daily-items';
import type { ManHourRow, NonEffectiveRow } from '@/lib/types';
import { NumField, Stepper, TextField } from '../fields';
import { CardButton, SectionCard, sameLabel, type CardProps } from '../SectionCard';
import { newId } from '../useDailyReport';

const n0 = (n: number) => n.toLocaleString('en-US');

export default function ManHoursCard({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: CardProps) {
  const rows = report.manHours;
  const ne = report.nonEffective;
  const crewed = rows.filter((r) => r.pobQty > 0);
  const pob = rows.reduce((s, r) => s + r.pobQty, 0);
  const today = rows.reduce((s, r) => s + r.todayHours, 0);
  const cumulative = rows.reduce((s, r) => s + r.previousHours + r.todayHours, 0);

  const setRows = (next: ManHourRow[]) => commit({ manHours: next, confirmed: { manHours: true } });
  const setRow = (id: string, p: Partial<ManHourRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  // Counting heads is the whole job: today's hours follow from people × hours each.
  const setPob = (r: ManHourRow, n: number) => {
    const each = hoursEachOf(r);
    setRow(r.id, { pobQty: n, hoursEach: each || undefined, todayHours: each ? n * each : r.todayHours });
  };
  const setEach = (r: ManHourRow, n: number) => setRow(r.id, { hoursEach: n, todayHours: r.pobQty * n });
  const setNe = (id: string, p: Partial<NonEffectiveRow>) =>
    commit({ nonEffective: ne.map((r) => (r.id === id ? { ...r, ...p } : r)), confirmed: { manHours: true } });

  return (
    <SectionCard
      id="manHours"
      icon={<Users className="size-[18px]" />}
      title="Man Hours"
      summary={
        pob > 0
          ? `${crewed.length} ${crewed.length === 1 ? 'company' : 'companies'} · ${pob} POB · ${n0(today)} h today`
          : 'No crew entered yet'
      }
      state={state}
      chipLabel={state === 'same' ? sameLabel(hasPredecessor) : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { manHours: true } })}>Confirm</CardButton>
            <CardButton onClick={onOpen}>Change</CardButton>
          </>
        ) : state === 'empty' ? (
          <CardButton variant="default" onClick={onOpen}>Add crew</CardButton>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <TextField label="Company" placeholder="Company" value={r.company} onCommit={(v) => setRow(r.id, { company: v })} />
              <m.button
                type="button"
                {...pressMotion}
                aria-label={`Remove ${r.company || 'company'}`}
                onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-bad sm:size-9"
              >
                <X className="size-4" />
              </m.button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <Stepper label={`${r.company || 'company'} people`} value={r.pobQty} onChange={(n) => setPob(r, n)} />
              <span className="text-sm text-muted-foreground">×</span>
              <NumField label={`${r.company || 'company'} hours each`} value={hoursEachOf(r)} onCommit={(n) => setEach(r, n)} className="w-16" />
              <span className="text-sm text-muted-foreground">h each</span>
              <span className="ml-auto text-sm font-semibold tabular-nums text-foreground">{n0(r.todayHours)} h</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
              <span>Previous</span>
              <NumField label={`${r.company || 'company'} previous hours`} value={r.previousHours} onCommit={(n) => setRow(r.id, { previousHours: n })} className="w-24 text-xs" />
              <span className="ml-auto">Total {n0(r.previousHours + r.todayHours)} h</span>
            </div>
          </div>
        ))}
        <CardButton
          className="w-full flex-none border-dashed text-chart-1"
          onClick={() => setRows([...rows, { id: newId('mh'), company: '', pobQty: 0, hoursEach: 8, previousHours: 0, todayHours: 0 }])}
        >
          Add company
        </CardButton>
        <p className="text-[12px] font-medium text-muted-foreground">
          {pob} people · {n0(today)} h today · {n0(cumulative)} h so far
        </p>
      </div>

      <h3 className="mb-2 mt-5 text-sm font-semibold text-foreground">Non Effective Working Hours</h3>
      <div className="space-y-2">
        {ne.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-foreground">{r.cause}</span>
              <div className="flex items-center gap-2">
                <NumField label={`${r.cause} today`} value={r.today} onCommit={(n) => setNe(r.id, { today: n })} className="w-16" />
                <span className="text-[12px] text-muted-foreground">h today</span>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <TextField label={`${r.cause} remark`} placeholder="Remark" value={r.remark} onCommit={(v) => setNe(r.id, { remark: v })} />
              <span className="shrink-0 text-[12px] text-muted-foreground">Cumm. {r.previous + r.today}</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 3: `PtwCard.tsx`:**

```tsx
'use client';

import { m } from 'framer-motion';
import { FileCheck2 } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import DateField from '@/components/ui/DateField';
import { daysLapsed, lapsedPermits } from '@/lib/daily-status';
import type { PtwRow } from '@/lib/types';
import { TextField } from '../fields';
import { CardButton, SectionCard, sameLabel, type CardProps } from '../SectionCard';
import { newId, type LogDraft } from '../useDailyReport';

const DATE_CLS =
  'min-h-11 min-w-0 rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1 sm:min-h-9';

const dateLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function PtwCard({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: CardProps) {
  const rows = report.ptw;
  const lapsed = lapsedPermits(report);
  const openCount = rows.filter((r) => r.status.trim().toUpperCase() === 'OPEN').length;

  const setRows = (next: PtwRow[], log?: LogDraft) => commit({ ptw: next, confirmed: { ptw: true } }, log);
  const setRow = (id: string, p: Partial<PtwRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    setRows(
      [...rows, { id: newId('ptw'), description: '', type: 'Cold Work', pwtNo: '', pa: '', issued: '', validity: '', status: 'OPEN' }],
      { kind: 'ptw', text: 'Permit added' }
    );
    onOpen();
  };
  const closeLapsed = () =>
    setRows(
      rows.map((r) => (lapsed.some((l) => l.id === r.id) ? { ...r, status: 'CLOSED' } : r)),
      { kind: 'ptw', text: `Closed ${lapsed.map((l) => l.pwtNo || 'permit').join(', ')}` }
    );

  const summary = lapsed[0]
    ? `${openCount} open · validity ended ${dateLabel(lapsed[0].validity)}, ${daysLapsed(lapsed[0].validity, report.date)} days ago`
    : openCount > 0
      ? `${openCount} open`
      : rows.length > 0
        ? `${rows.length} recorded, none open`
        : 'No permits recorded';

  return (
    <SectionCard
      id="ptw"
      icon={<FileCheck2 className="size-[18px]" />}
      title="Permit to Work"
      summary={summary}
      state={state}
      chipLabel={state === 'same' ? sameLabel(hasPredecessor) : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'look' ? (
          <>
            <CardButton variant="default" onClick={closeLapsed}>Close it</CardButton>
            <CardButton onClick={onOpen}>Extend validity</CardButton>
          </>
        ) : state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { ptw: true } })}>Confirm</CardButton>
            <CardButton onClick={onOpen}>Change</CardButton>
          </>
        ) : state === 'empty' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { ptw: true } })}>None today</CardButton>
            <CardButton onClick={add}>Add permit</CardButton>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No permits recorded for this day.</p>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
            <TextField multiline label="Description" placeholder="Description" value={r.description} onCommit={(v) => setRow(r.id, { description: v })} className="sm:col-span-2" />
            <TextField label="Type" placeholder="Type" value={r.type} onCommit={(v) => setRow(r.id, { type: v })} />
            <TextField label="PWT No" placeholder="PWT No" value={r.pwtNo} onCommit={(v) => setRow(r.id, { pwtNo: v })} />
            <TextField label="PA" placeholder="PA" value={r.pa} onCommit={(v) => setRow(r.id, { pa: v })} />
            <TextField label="Status" placeholder="Status" value={r.status} onCommit={(v) => setRow(r.id, { status: v })} />
            <DateField value={r.issued} onChange={(v) => setRow(r.id, { issued: v })} placeholder="Issued" clearable className={DATE_CLS} />
            <DateField value={r.validity} onChange={(v) => setRow(r.id, { validity: v })} placeholder="Validity" clearable className={DATE_CLS} />
            <m.button
              type="button"
              {...pressMotion}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              className="min-h-11 justify-self-start text-xs text-muted-foreground transition-colors hover:text-bad sm:min-h-9"
            >
              Remove permit
            </m.button>
          </div>
        ))}
        <CardButton className="w-full flex-none border-dashed text-chart-1" onClick={add}>Add permit</CardButton>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 4: `HseCard.tsx`:**

```tsx
'use client';

import { m } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import type { HseRow } from '@/lib/types';
import { NumField } from '../fields';
import { CardButton, SectionCard, sameLabel, type CardProps } from '../SectionCard';

export default function HseCard({ report, commit, state, open, onToggle, onOpen, hasPredecessor }: CardProps) {
  const rows = report.hseInput;
  const hits = rows.filter((r) => r.today > 0);
  const setRow = (id: string, p: Partial<HseRow>) =>
    commit({ hseInput: rows.map((r) => (r.id === id ? { ...r, ...p } : r)), confirmed: { hse: true } });
  // A tap is a fact with a time; a typed total is a correction and is not logged.
  const plusOne = (r: HseRow) =>
    commit(
      { hseInput: rows.map((x) => (x.id === r.id ? { ...x, today: x.today + 1 } : x)), confirmed: { hse: true } },
      { kind: 'hse', text: `${r.activity} +1` }
    );

  return (
    <SectionCard
      id="hse"
      icon={<ShieldCheck className="size-[18px]" />}
      title="HSE Input"
      summary={hits.length ? hits.map((r) => `${r.activity} ${r.today}`).join(' · ') : 'All zero today'}
      state={state}
      chipLabel={state === 'same' ? sameLabel(hasPredecessor) : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { hse: true } })}>Confirm</CardButton>
            <CardButton onClick={onOpen}>Change</CardButton>
          </>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3">
            <span className="min-w-0 flex-1 basis-40 text-sm font-medium text-foreground">{r.activity}</span>
            <span className="text-[12px] text-muted-foreground">Previous {r.previous}</span>
            <NumField label={`${r.activity} today`} value={r.today} onCommit={(n) => setRow(r.id, { today: n })} className="w-16" />
            <m.button
              type="button"
              {...pressMotion}
              onClick={() => plusOne(r)}
              aria-label={`Add one ${r.activity}`}
              className="min-h-11 rounded-lg border border-border bg-card px-3 text-sm font-semibold text-chart-1 transition-colors hover:bg-muted sm:min-h-9"
            >
              +1
            </m.button>
            <span className="w-16 text-right text-[12px] font-medium text-foreground">Cumm. {r.previous + r.today}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
```

---

### Task 6: Cards for Daily Activities, AOC, Progress, Photos

**Files:** Create `components/daily/cards/{Activities,Aoc,Progress,Photos}Card.tsx`.

**Interfaces:**
- Consumes: as Task 5, plus `todayItemsOf`, `tomorrowItemsOf`, `activityStrings`, `DailyProgress`, `PlanActualBar` (default export of `@/components/ui/PlanActualBar`, props `actual`, `plan`), `PhotoUploadGrid` (default export of `@/components/weekly/PhotoUploadGrid`, props `photos`, `uploadUrl`).
- Produces: default-exported cards (`ActivitiesCard` also takes `suggestions: string[]`, `ProgressCard` also takes `progress: DailyProgress | null`).

- [ ] **Step 1: `ActivitiesCard.tsx`:**

```tsx
'use client';

import { m } from 'framer-motion';
import { Check, ListChecks, X } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { activityStrings, todayItemsOf, tomorrowItemsOf } from '@/lib/daily-items';
import type { ActivityItem } from '@/lib/types';
import { INPUT_CLS, TextField } from '../fields';
import { CardButton, SectionCard, type CardProps } from '../SectionCard';
import { newId, type LogDraft } from '../useDailyReport';
import { cn } from '@/lib/utils';

const has = (items: ActivityItem[], text: string) =>
  items.some((i) => i.text.trim().toLowerCase() === text.trim().toLowerCase());

export default function ActivitiesCard({
  report, commit, state, open, onToggle, onOpen, suggestions,
}: CardProps & { suggestions: string[] }) {
  const today = todayItemsOf(report);
  const tomorrow = tomorrowItemsOf(report);
  const [todayDraft, setTodayDraft] = useState('');
  const [tomorrowDraft, setTomorrowDraft] = useState('');
  const unticked = today.filter((i) => !i.done).length;
  const done = today.length - unticked;

  const save = (t: ActivityItem[], m2: ActivityItem[], log?: LogDraft, confirm?: boolean) =>
    commit({ todayItems: t, tomorrowItems: m2, ...activityStrings(t, m2), ...(confirm ? { confirmed: { activities: true as const } } : {}) }, log);

  // What is added during the day is something DONE; what came from yesterday's plan waits to be ticked.
  const addToday = (text: string) => {
    const v = text.trim();
    if (!v || has(today, v)) return;
    save([...today, { id: newId('at'), text: v, done: true }], tomorrow, { kind: 'activity', text: v });
    setTodayDraft('');
  };
  const addTomorrow = (text: string) => {
    const v = text.trim();
    if (!v || has(tomorrow, v)) return;
    save(today, [...tomorrow, { id: newId('am'), text: v, done: false }]);
    setTomorrowDraft('');
  };
  const tick = (it: ActivityItem) =>
    save(
      today.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)),
      tomorrow,
      it.done ? undefined : { kind: 'activity', text: it.text }
    );

  const todaySuggest = suggestions.filter((s) => !has(today, s) && !has(tomorrow, s)).slice(0, 6);
  const unfinished = today.filter((i) => !i.done && !has(tomorrow, i.text));
  const tomorrowSuggest = suggestions.filter((s) => !has(tomorrow, s) && !has(today, s)).slice(0, 4);

  const chip = (text: string, onTap: () => void, key: string) => (
    <m.button
      key={key}
      type="button"
      {...pressMotion}
      onClick={onTap}
      className="min-h-11 max-w-full truncate rounded-lg border border-border bg-card px-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:min-h-9"
    >
      + {text}
    </m.button>
  );

  const list = (items: ActivityItem[], isToday: boolean) => (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
          {isToday && (
            <m.button
              type="button"
              {...pressMotion}
              role="checkbox"
              aria-checked={it.done}
              aria-label={`Done: ${it.text}`}
              onClick={() => tick(it)}
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors sm:size-9',
                it.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border bg-card text-transparent'
              )}
            >
              <Check className="size-4" />
            </m.button>
          )}
          <TextField
            label="Activity"
            value={it.text}
            onCommit={(v) => {
              const edit = (arr: ActivityItem[]) => arr.map((x) => (x.id === it.id ? { ...x, text: v } : x));
              if (isToday) save(edit(today), tomorrow);
              else save(today, edit(tomorrow));
            }}
          />
          <m.button
            type="button"
            {...pressMotion}
            aria-label={`Remove ${it.text}`}
            onClick={() => (isToday ? save(today.filter((x) => x.id !== it.id), tomorrow) : save(today, tomorrow.filter((x) => x.id !== it.id)))}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-bad sm:size-9"
          >
            <X className="size-4" />
          </m.button>
        </div>
      ))}
    </div>
  );

  return (
    <SectionCard
      id="activities"
      icon={<ListChecks className="size-[18px]" />}
      title="Daily Activities"
      summary={today.length || tomorrow.length ? `${done} of ${today.length} done · ${tomorrow.length} planned for tomorrow` : 'Nothing planned yet'}
      state={state}
      chipLabel={state === 'same' ? (unticked > 0 ? `${unticked} to tick` : 'To confirm') : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { activities: true } })}>Confirm</CardButton>
            <CardButton onClick={onOpen}>Tick and change</CardButton>
          </>
        ) : state === 'empty' ? (
          <CardButton variant="default" onClick={onOpen}>Add activity</CardButton>
        ) : undefined
      }
    >
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="h-2 w-2 rounded-full bg-chart-1" />
        Today
      </h3>
      {list(today, true)}
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Add a today activity"
          value={todayDraft}
          onChange={(e) => setTodayDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addToday(todayDraft)}
          placeholder="What was done today"
          className={INPUT_CLS}
        />
        <CardButton variant="default" className="flex-none px-4" onClick={() => addToday(todayDraft)}>Add</CardButton>
      </div>
      {todaySuggest.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{todaySuggest.map((s) => chip(s, () => addToday(s), `t-${s}`))}</div>}

      <h3 className="mb-2 mt-5 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Tomorrow
      </h3>
      {list(tomorrow, false)}
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Add a tomorrow activity"
          value={tomorrowDraft}
          onChange={(e) => setTomorrowDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTomorrow(tomorrowDraft)}
          placeholder="What is planned for tomorrow"
          className={INPUT_CLS}
        />
        <CardButton variant="default" className="flex-none px-4" onClick={() => addTomorrow(tomorrowDraft)}>Add</CardButton>
      </div>
      {(unfinished.length > 0 || tomorrowSuggest.length > 0) && (
        <div className="mt-2">
          {unfinished.length > 0 && <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Not done yet today</p>}
          <div className="flex flex-wrap gap-2">
            {unfinished.map((i) => chip(i.text, () => addTomorrow(i.text), `u-${i.id}`))}
            {tomorrowSuggest.map((s) => chip(s, () => addTomorrow(s), `m-${s}`))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 2: `AocCard.tsx`:**

```tsx
'use client';

import { m } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import DateField from '@/components/ui/DateField';
import type { AocRow } from '@/lib/types';
import { INPUT_CLS, TextField } from '../fields';
import { CardButton, SectionCard, type CardProps } from '../SectionCard';
import { newId } from '../useDailyReport';

const DATE_CLS =
  'min-h-11 min-w-0 rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground transition-colors hover:border-muted-foreground/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-chart-1 sm:min-h-9';

export default function AocCard({ report, commit, state, open, onToggle, onOpen }: CardProps) {
  const rows = report.aoc ?? [];
  const setRows = (next: AocRow[]) => commit({ aoc: next, aocNone: false, confirmed: { aoc: true } });
  const setRow = (id: string, p: Partial<AocRow>) => setRows(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => {
    setRows([...rows, { id: newId('aoc'), type: 'AOC', description: '', date: report.date, actionBy: '', status: 'OPEN' }]);
    onOpen();
  };

  return (
    <SectionCard
      id="aoc"
      icon={<TriangleAlert className="size-[18px]" />}
      title="Area of Concern"
      summary={rows.length > 0 ? `${rows.length} raised` : report.aocNone ? 'None today' : 'Nothing raised yet'}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'empty' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ aoc: [], aocNone: true, confirmed: { aoc: true } })}>None today</CardButton>
            <CardButton onClick={add}>Add</CardButton>
          </>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing raised for this day.</p>}
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-1 gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
            <select
              aria-label="Type"
              value={r.type}
              onChange={(e) => setRow(r.id, { type: e.target.value as AocRow['type'] })}
              className={INPUT_CLS}
            >
              <option value="AOC">AOC (Area of Concern)</option>
              <option value="AFH">AFH (Ask for Help)</option>
            </select>
            <DateField value={r.date} onChange={(v) => setRow(r.id, { date: v })} placeholder="Date" className={DATE_CLS} />
            <TextField multiline label="Description" placeholder="Description" value={r.description} onCommit={(v) => setRow(r.id, { description: v })} className="sm:col-span-2" />
            <TextField label="Action by" placeholder="Action by" value={r.actionBy} onCommit={(v) => setRow(r.id, { actionBy: v })} />
            <TextField label="Status" placeholder="Status" value={r.status} onCommit={(v) => setRow(r.id, { status: v })} />
            <m.button
              type="button"
              {...pressMotion}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
              className="min-h-11 justify-self-start text-xs text-muted-foreground transition-colors hover:text-bad sm:min-h-9"
            >
              Remove
            </m.button>
          </div>
        ))}
        <CardButton className="w-full flex-none border-dashed text-chart-1" onClick={add}>Add area of concern</CardButton>
      </div>
    </SectionCard>
  );
}
```

- [ ] **Step 3: `ProgressCard.tsx`:**

```tsx
'use client';

import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import PlanActualBar from '@/components/ui/PlanActualBar';
import type { DailyProgress } from '@/lib/daily-progress';
import { SectionCard, type CardProps } from '../SectionCard';

const pct = (n: number) => `${n.toFixed(2)}%`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;

export default function ProgressCard({
  state, open, onToggle, progress,
}: CardProps & { progress: DailyProgress | null }) {
  const held = progress?.state === 'held';
  const ready = progress?.state === 'ready';
  const devCls = !ready || Math.abs(progress.variance) < 0.005 ? 'text-gray-700' : progress.variance < 0 ? 'text-red-500' : 'text-emerald-600';

  return (
    <SectionCard
      id="progress"
      icon={<TrendingUp className="size-[18px]" />}
      title="Progress"
      summary={
        ready
          ? `Week ${progress.week} · Actual ${pct(progress.actual)} · Plan ${pct(progress.plan)}`
          : held
            ? 'Held until the weights reach 100%'
            : 'No plan yet'
      }
      state={state}
      open={open}
      onToggle={onToggle}
    >
      {ready ? (
        <div className="space-y-3">
          <PlanActualBar actual={progress.actual} plan={progress.plan} />
          <dl className="divide-y divide-gray-200">
            <div className="flex items-baseline justify-between py-2"><dt className="text-sm text-muted-foreground">Actual</dt><dd className="text-sm font-semibold tabular-nums text-chart-1">{pct(progress.actual)}</dd></div>
            <div className="flex items-baseline justify-between py-2"><dt className="text-sm text-muted-foreground">Plan</dt><dd className="text-sm font-semibold tabular-nums text-chart-2">{pct(progress.plan)}</dd></div>
            <div className="flex items-baseline justify-between py-2"><dt className="text-sm text-muted-foreground">Deviation</dt><dd className={`text-sm font-semibold tabular-nums ${devCls}`}>{signed(progress.variance)}</dd></div>
          </dl>
          <p className="text-[13px] leading-snug text-muted-foreground">
            From the weekly report, not typed here.{' '}
            <Link href={`/weekly/${progress.week}/summary`} className="font-semibold text-chart-1">Open week {progress.week}</Link>
          </p>
        </div>
      ) : held ? (
        <p className="text-[13px] leading-snug text-muted-foreground">
          The weights total {progress.weightsTotal.toFixed(2)}%, so no figure is shown anywhere yet.{' '}
          <Link href={`/weekly/${progress.week}/weights`} className="font-semibold text-chart-1">Open Weights</Link>
        </p>
      ) : (
        <p className="text-[13px] leading-snug text-muted-foreground">This project has no plan yet, so there is no weekly figure to read.</p>
      )}
    </SectionCard>
  );
}
```

- [ ] **Step 4: `PhotosCard.tsx`:**

```tsx
'use client';

import { Camera } from 'lucide-react';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import { CardButton, SectionCard, type CardProps } from '../SectionCard';

export default function PhotosCard({ report, state, open, onToggle, onOpen }: CardProps) {
  const n = report.photos.filter(Boolean).length;
  return (
    <SectionCard
      id="photos"
      icon={<Camera className="size-[18px]" />}
      title="Photos"
      summary={`${n} of ${report.photos.length} photos`}
      chipLabel={n > 0 ? `${n} of ${report.photos.length}` : undefined}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={n === 0 ? <CardButton variant="default" onClick={onOpen}>Add photo</CardButton> : undefined}
    >
      <PhotoUploadGrid photos={report.photos} uploadUrl={`/api/daily/${report.date}/photos`} />
    </SectionCard>
  );
}
```

---

### Task 7: The daily list and the daily PDF read weekly figures; retire the old form

**Files:**
- Modify: `app/daily/page.tsx`, `components/daily/DailyReportsView.tsx`, `app/print/daily/[date]/page.tsx`, `components/print/DailyPrintReport.tsx`, `lib/actions.ts`
- Delete: `components/daily/DailyForm.tsx`

- [ ] **Step 1: The list.** In `components/daily/DailyReportsView.tsx` replace `planPct: number; actualPct: number;` in `DailyListItem` with `progress: { plan: number; actual: number } | 'held' | null;` and replace the `<p ...>Plan ... Actual ...</p>` with:

```tsx
              <p className="text-sm text-muted-foreground sm:pr-4">
                {d.progress === 'held'
                  ? 'Figures held'
                  : d.progress
                    ? `Plan ${d.progress.plan.toFixed(0)}% · Actual ${d.progress.actual.toFixed(0)}%`
                    : ''}
              </p>
```

In `app/daily/page.tsx` import `getOpenProjectStatus` and `dailyProgressFor`, read `const status = await getOpenProjectStatus();` right after `const db = await getOpenJsonDb();`, and map each row with `progress: listProgress(status, d.date)` instead of `planPct`/`actualPct`, using:

```ts
function listProgress(status: Awaited<ReturnType<typeof getOpenProjectStatus>>, date: string) {
  const p = dailyProgressFor(status, date);
  if (!p) return null;
  return p.state === 'held' ? ('held' as const) : { plan: p.plan, actual: p.actual };
}
```

- [ ] **Step 2: The PDF.** In `components/print/DailyPrintReport.tsx` add the prop `progress: DailyProgress | null` (type import only) and replace the two `<td>` cells with:

```tsx
              <td className="rpt-num">{progress?.state === 'ready' ? `${progress.plan.toFixed(2)}%` : '-'}</td>
              <td className="rpt-num">{progress?.state === 'ready' ? `${progress.actual.toFixed(2)}%` : '-'}</td>
```

In `app/print/daily/[date]/page.tsx` add `import { getActiveProjectId } from '@/lib/projects'; import { getProjectStatus } from '@/lib/data'; import { dailyProgressFor } from '@/lib/daily-progress';`, and after `if (!report) notFound();`:

```tsx
  // Named by the URL, like the report itself: headless Chromium has no cookie.
  const statusId = projectId ?? (await getActiveProjectId());
  const progress = dailyProgressFor(statusId ? await getProjectStatus(statusId) : null, date);
```

then pass `progress={progress}` to `<DailyPrintReport .../>`.

- [ ] **Step 3: Retire the old form.** `git rm components/daily/DailyForm.tsx`. Run `grep -rn "DailyForm\|saveDailyAction" app components lib` and confirm the only hits left are the definition of `saveDailyAction`; delete that function from `lib/actions.ts` (and any import that becomes unused).

---

### Task 8: Prove it

**Files:** the spec (amend), `AGENTS.md` (one section).

- [ ] **Step 1: Logic.** Run `node --import ./scripts/ts-resolve.mjs scripts/verify-daily-carry.ts`. Expected: every line `ok`, `all checks passed`, exit 0.

- [ ] **Step 2: Types.** Create `<scratchpad>/tsconfig.daily.json`:

```json
{
  "extends": "E:/Figtries/Prototype/Report/tsconfig.json",
  "compilerOptions": { "noEmit": true, "incremental": false },
  "include": [
    "E:/Figtries/Prototype/Report/next-env.d.ts",
    "E:/Figtries/Prototype/Report/app/**/*.ts",
    "E:/Figtries/Prototype/Report/app/**/*.tsx",
    "E:/Figtries/Prototype/Report/components/**/*.ts",
    "E:/Figtries/Prototype/Report/components/**/*.tsx",
    "E:/Figtries/Prototype/Report/lib/**/*.ts",
    "E:/Figtries/Prototype/Report/types/**/*.ts"
  ]
}
```

Run `npx tsc -p <scratchpad>/tsconfig.daily.json`. Expected: no errors in files this plan touched. Fix any (typical: the `m.button` prop spread in `CardButton`, computed weather keys).

- [ ] **Step 3: Lint** the touched files: `npx eslint components/daily components/print/DailyPrintReport.tsx lib/daily-items.ts lib/daily-status.ts lib/daily-progress.ts app/daily`. Fix anything new (the old `set-state-in-effect` errors were in the deleted form).

- [ ] **Step 4: Build.** `NEXT_DIST_DIR=.next-verify npx next build > <scratchpad>/build.log 2>&1; echo "exit $?"`. Expected `exit 0`. If it fails on "Uncached data was accessed outside of Suspense", the read that needs a `<Suspense>` is `getOpenProjectStatus()` or `getProjectStatus()` in one of the two pages.

- [ ] **Step 5: Look.** Start `preview_start` `{name: "dev-preview"}`. Make a fresh report through the real "New" button on `/daily` (pick a date after the newest report so it carries), then `node scripts/shoot.mjs http://localhost:<port>/daily/<date> <scratchpad>/daily-390.png 390 900`, again at `768 1000` and `1440 1000`. Read each PNG. Check: the hero uses the app's surface, chips are equal width, nothing overflows horizontally at 390px (`document.documentElement.scrollWidth === 390`), cards go two-up at 768px, the log is a right column at 1440px.

- [ ] **Step 6: Press.** With a script in the scratchpad (`createRequire('E:/Figtries/Prototype/Report/package.json')('puppeteer-core')`), on the fresh report: assert the chip on Man Hours reads "Same as yesterday", press Confirm and assert it reads "Ready" and the hero count went up; press +1 on a HSE row (open the card first) and assert "Today so far" gained a line; add an activity from a suggestion chip; tick a planned item; reload the page and assert all of it persisted; assert the network shows `POST` for each change and NO full-page RSC refresh between them. Then `git checkout -- data/db.json` and remove the test report if it sits anywhere else.

- [ ] **Step 7: PDF.** Save the daily PDF for that date through the real button (headless CDP, `Browser.setDownloadBehavior { behavior: 'allow' }`, click once after hydration) and assert the file lands and the Progress row shows figures or "-", never "0.00%" from the retired fields.

- [ ] **Step 8: Amend the spec** so it says what was built: hours each (`ManHourRow.hoursEach`, `todayHours = pobQty × hoursEach`, carried and inferred), progress week = `min(weekOfDate(anchorEnd, date), status.week)` (the current week of the project, not "latest with actuals"), the photo time rule (camera time on the report's own date, else upload time), "the log records taps and additions, not totals", and the known trade-off (a carried day nobody touched still carries its hours, which is why `same` exists). Add a short "Daily reports" section to `AGENTS.md` (5 to 8 lines: the principle, the state rules living in `lib/daily-status.ts`, progress is weekly, no `refresh()` on autosave, log is what a person did).

- [ ] **Step 9: Commit** only the files this plan touched, one `git add <path>` each, then `git diff --cached --name-only` and read the diff. Message in the repo's voice, ending with the attribution line from the session:

```
The daily report opens as yesterday already filled in: crew at their hours, open permits, yesterday's plan as today's list, each part one press to confirm, with a timed "Today so far" and progress read from weekly

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

Do not push until the user says so.
