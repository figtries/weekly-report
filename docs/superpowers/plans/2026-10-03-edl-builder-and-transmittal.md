# EDL builder and transmittal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the EDL/VDRL builder with one page of free headings (optional sub-headings, three ways to start, no numbering gate) and add recording one transmittal for many documents.

**Architecture:** A pure, script-testable model (`lib/builder-model.ts`) holds the builder's state and turns it into the `DraftGroup[]` the existing `writeDraft` already stores; the page only draws it. Transmittals reuse one stage writer shared with `saveStage`, and the "what goes next / what is out" facts are computed once on the server from the same rule as Outstanding.

**Tech Stack:** Next.js (cacheComponents), React 19, framer-motion (`MOTION` in `lib/design.ts`), drizzle + better-sqlite3, shadcn/Radix Dialog (lazy), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-03-edl-builder-and-transmittal-design.md`

## Global Constraints

- App copy in English, capital-first labels, no em dash (U+2014) in any visible string.
- One pill size per column; colours from tokens `bad`/`warn`/`ok`/`primary`.
- Page entrances: CSS keyframes (`.animate-enter`, `stagger-*`); motion after hydration: framer-motion with `MOTION.duration`/`MOTION.ease`, height + opacity, `AnimatePresence initial={false}`, no per-row cascade.
- Touch targets ≥ 44px (`min-h-11`); correct at 390px and desktop; inputs 16px on phones (`text-base md:text-sm`).
- Lazy overlays: `next/dynamic` + their own `<Suspense fallback={null}>`; Radix auto-focus deferred two frames (copy `ExportExcelDialog`).
- No new tables or columns. A heading holds documents OR sub-headings, never both.
- Verify scripts run as `node --import ./scripts/ts-resolve.mjs scripts/<name>.ts` on a fixture copy, never on `data/report.db`.
- Never commit `data/db.json`. Ask before `git push`.

## File map

- Create `lib/builder-model.ts`: builder state types and pure operations (headings, rows, sub-headings, numbering, conversion to/from outline, paste and draft).
- Create `scripts/verify-builder-model.ts`: proves the model.
- Modify `lib/register-seed.ts`: `DraftGroup.documents` carries `kind` and `planIfr`; IFR plan row written for new documents.
- Modify `lib/register.ts`: `getRegisterOutline`, `getRegisterSources`, `ballOf` (shared by `openStateOf`), `next`/`out` on `DocumentCard`; `getNumbering` falls back to the project initial.
- Modify `lib/register-shared.ts`: `OutlineHeading`, `RegisterSource`, `DocumentCard.next/out`.
- Create `app/api/register/outline/route.ts`: GET outline of a source project.
- Create `scripts/verify-edl-builder.ts`: proves storage, outline and sources.
- Modify `lib/doc-actions.ts`: `writeStage` shared writer, `recordTransmittal`.
- Create `scripts/verify-transmittal.ts`.
- Rewrite `components/dokumen/RegisterBuilder.tsx`; create `components/dokumen/BuilderHeadingCard.tsx`, `components/dokumen/NumberingDialog.tsx`.
- Create `components/dokumen/TransmittalDialog.tsx`; modify `components/dokumen/RegisterTools.tsx`, `RegisterWorkbench.tsx`, the four `app/dokumen/[week]/*/page.tsx`.

---

### Task 1: Builder model

**Files:**
- Create: `lib/builder-model.ts`
- Test: `scripts/verify-builder-model.ts`

**Interfaces:**
- Consumes: `nextNumber`, `NumberingRule` (`lib/register-numbering.ts`); `templateFor` (`lib/register-template.ts`); `tidyName` (`lib/tidy-name.ts`); `PastePlan` (`lib/register-paste.ts`); `DraftGroup` (`lib/register-seed.ts`, extended in Task 2).
- Produces:
  ```ts
  export type Kind = 'Doc' | 'Dwg';
  export interface BuilderRow { id: string; title: string; kind: Kind; docNo: string; auto: boolean; planIfr: string; picked: boolean; fromSource: boolean }
  export interface BuilderSub { id: string; name: string; rows: BuilderRow[] }
  export interface BuilderHeading { id: string; name: string; locked: boolean; existing: number; rows: BuilderRow[]; subs: BuilderSub[] }
  export interface OutlineHeading { name: string; documents: { title: string; kind: Kind }[]; subheadings: { name: string; documents: { title: string; kind: Kind }[] }[] }
  export function headingSuggestions(register: RegisterKind): string[];
  export function subSuggestions(register: RegisterKind, heading: string): string[];
  export function newHeading(name: string): BuilderHeading;
  export function rowsFromText(text: string): BuilderRow[];          // one row per non-empty line
  export function addSub(h: BuilderHeading, name: string): BuilderHeading; // first sub takes h.rows
  export function fromOutline(outline: OutlineHeading[]): BuilderHeading[]; // picked + fromSource
  export function fromPaste(plan: PastePlan): BuilderHeading[];
  export function renumber(hs: BuilderHeading[], rule: NumberingRule, taken: string[]): BuilderHeading[];
  export function toDraftGroups(hs: BuilderHeading[]): DraftGroup[];
  export function countDocuments(hs: BuilderHeading[]): number;      // picked rows with a title
  ```

- [ ] **Step 1: Write the failing test** `scripts/verify-builder-model.ts`

```ts
/**
 * The builder's model, proved without a browser.
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-builder-model.ts
 */
import {
  addSub, countDocuments, fromOutline, fromPaste, headingSuggestions, newHeading,
  renumber, rowsFromText, subSuggestions, toDraftGroups,
} from '../lib/builder-model.ts';
import { defaultRule } from '../lib/register-numbering.ts';
import { parseRegisterPaste } from '../lib/register-paste.ts';

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};

console.log('suggestions come from the template');
check('EDL headings', headingSuggestions('edl'), ['GENERAL', 'PROCESS', 'CIVIL', 'MECHANICAL', 'PIPING', 'ELECTRICAL', 'INSTRUMENT']);
check('GENERAL subs', subSuggestions('edl', 'GENERAL'), ['Execution Plan', 'Procedure']);
check('ELECTRICAL subs start with', subSuggestions('edl', 'ELECTRICAL')[0], 'Electrical Calculation & Study');
check('VDRL has no headings', headingSuggestions('vdrl'), []);

console.log('\nrows from typed or pasted lines');
const rows = rowsFromText('Project Execution Plan\n\n  Project Quality Plan  \n');
check('two rows, trimmed', rows.map((r) => r.title), ['Project Execution Plan', 'Project Quality Plan']);
check('typed rows are picked Doc', rows.map((r) => [r.picked, r.kind, r.fromSource]), [[true, 'Doc', false], [true, 'Doc', false]]);

console.log('\na first sub-heading takes the heading\'s documents');
let general = { ...newHeading('GENERAL'), rows };
general = addSub(general, 'Execution Plan');
check('heading rows emptied', general.rows.length, 0);
check('sub holds them', general.subs[0].rows.length, 2);
general = addSub(general, 'Procedure');
check('second sub starts empty', general.subs[1].rows.length, 0);
general.subs[1].rows = rowsFromText('Document Control Procedure');

console.log('\nnumbers follow the project rule');
const instrument = { ...newHeading('INSTRUMENT'), rows: rowsFromText('Control Valve Datasheet\nInstrument Location Layout') };
instrument.rows[1].kind = 'Dwg';
const numbered = renumber([general, instrument], defaultRule('JPI'), []);
check('execution plan numbers', numbered[0].subs[0].rows.map((r) => r.docNo), ['JPI-GN-DRE-001', 'JPI-GN-DRE-002']);
check('procedure number', numbered[0].subs[1].rows[0].docNo, 'JPI-GN-DGS-001');
check('instrument numbers', numbered[1].rows.map((r) => r.docNo), ['JPI-IN-DDS-001', 'JPI-IN-GDW-001']);
const continued = renumber([instrument], defaultRule('JPI'), ['JPI-IN-DDS-004']);
check('sequence continues past taken', continued[0].rows[0].docNo, 'JPI-IN-DDS-005');
const hand = renumber([{ ...instrument, rows: [{ ...instrument.rows[0], docNo: 'X-1', auto: false }] }], defaultRule('JPI'), []);
check('hand-typed number kept', hand[0].rows[0].docNo, 'X-1');

console.log('\ndraft groups: heading path, or heading and sub');
const groups = toDraftGroups(numbered);
check('paths', groups.map((g) => g.path), [['GENERAL', 'Execution Plan'], ['GENERAL', 'Procedure'], ['INSTRUMENT']]);
check('kinds kept', groups[2].documents.map((d) => d.kind), ['Doc', 'Dwg']);
check('count', countDocuments(numbered), 5);

console.log('\nunticked rows from a source are left out');
const copied = fromOutline([{ name: 'Instrument & Control', documents: [{ title: 'Instrument Index', kind: 'Doc' }, { title: 'DCS / ESD Panel Layout', kind: 'Dwg' }], subheadings: [] }]);
check('copied rows are picked and from source', copied[0].rows.map((r) => [r.picked, r.fromSource]), [[true, true], [true, true]]);
copied[0].rows[1].picked = false;
check('unpicked dropped', toDraftGroups(renumber(copied, defaultRule('JPI'), []))[0].documents.map((d) => d.title), ['Instrument Index']);

console.log('\npaste: depth 1 is a heading, a deeper leaf is a sub-heading');
const pasted = fromPaste(parseRegisterPaste('A\tGENERAL\nA.2\tPROCEDURE\nA.2.1\tGeneral Prosedur\nWPP-GN-DGS-001\tDocument Control Procedure\nB\tELECTRICAL\nWPP-EL-GDW-001\tSingle Line Diagram\tDwg'));
check('headings', pasted.map((h) => h.name), ['GENERAL', 'ELECTRICAL']);
check('general sub', pasted[0].subs.map((s) => s.name), ['General Prosedur']);
check('pasted number kept, not auto', pasted[0].subs[0].rows.map((r) => [r.docNo, r.auto]), [['WPP-GN-DGS-001', false]]);
check('electrical row on heading', pasted[1].rows.map((r) => [r.title, r.kind]), [['Single Line Diagram', 'Dwg']]);

if (failures.length) { console.log(`\n${failures.length} FAILED`); process.exit(1); }
console.log('\nall passed');
```

- [ ] **Step 2: Run it, expect failure** — `node --import ./scripts/ts-resolve.mjs scripts/verify-builder-model.ts` → fails: cannot find `lib/builder-model.ts`.

- [ ] **Step 3: Implement `lib/builder-model.ts`**

```ts
/**
 * The EDL/VDRL builder's state, kept out of React so a script can prove it
 * (3 Oct 2026, spec 2026-10-03-edl-builder-and-transmittal-design.md).
 *
 * A heading holds documents OR sub-headings, never both: the Data screen shows
 * only leaf categories as groups, so documents left on a heading that also has
 * sub-headings would vanish from it. The first sub-heading therefore TAKES the
 * heading's documents.
 */
import { nextNumber, type NumberingRule } from './register-numbering';
import type { PastePlan } from './register-paste';
import type { DraftGroup } from './register-seed';
import { templateFor } from './register-template';
import type { RegisterKind } from './schema';
import { tidyName } from './tidy-name';

export type Kind = 'Doc' | 'Dwg';
export interface BuilderRow { id: string; title: string; kind: Kind; docNo: string; auto: boolean; planIfr: string; picked: boolean; fromSource: boolean }
export interface BuilderSub { id: string; name: string; rows: BuilderRow[] }
export interface BuilderHeading { id: string; name: string; locked: boolean; existing: number; rows: BuilderRow[]; subs: BuilderSub[] }
export interface OutlineHeading {
  name: string;
  documents: { title: string; kind: Kind }[];
  subheadings: { name: string; documents: { title: string; kind: Kind }[] }[];
}

let seq = 0;
const uid = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;
export const kindOf = (raw: string | null | undefined): Kind => (raw ?? '').trim().toLowerCase().startsWith('dw') ? 'Dwg' : 'Doc';

/** GENERAL, then the sections under DETAIL ENGINEERING: the headings an EPC EDL starts from. */
export function headingSuggestions(register: RegisterKind): string[] {
  const out: string[] = [];
  for (const band of templateFor(register)) {
    if (band.sections.length > 0 && band.name !== 'GENERAL') out.push(...band.sections.map((s) => s.name));
    else if (band.sections.length > 0) out.push(band.name);
  }
  return out;
}

/** GENERAL offers its sections; a discipline offers its groups. Title case, as typed sub-headings are. */
export function subSuggestions(register: RegisterKind, heading: string): string[] {
  const key = heading.trim().toUpperCase();
  for (const band of templateFor(register)) {
    if (band.name.toUpperCase() === key) return band.sections.map((s) => tidyName(s.name));
    const section = band.sections.find((s) => s.name.toUpperCase() === key);
    if (section) return section.groups.map(tidyName);
  }
  return [];
}

export function newRow(title: string, kind: Kind = 'Doc', fromSource = false): BuilderRow {
  return { id: uid(), title, kind, docNo: '', auto: true, planIfr: '', picked: true, fromSource };
}

export function newHeading(name: string, locked = false, existing = 0): BuilderHeading {
  return { id: uid(), name: name.trim(), locked, existing, rows: [], subs: [] };
}

export function rowsFromText(text: string): BuilderRow[] {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((t) => newRow(t));
}

export function addSub(h: BuilderHeading, name: string): BuilderHeading {
  const sub: BuilderSub = { id: uid(), name: name.trim(), rows: h.subs.length === 0 ? h.rows : [] };
  return { ...h, rows: h.subs.length === 0 ? [] : h.rows, subs: [...h.subs, sub] };
}

export function fromOutline(outline: OutlineHeading[]): BuilderHeading[] {
  return outline.map((o) => ({
    ...newHeading(o.name),
    rows: o.documents.map((d) => newRow(d.title, d.kind, true)),
    subs: o.subheadings.map((s) => ({ id: uid(), name: s.name, rows: s.documents.map((d) => newRow(d.title, d.kind, true)) })),
  }));
}

/** Depth 1 is a heading; any deeper category becomes a sub-heading of its depth-1 ancestor, named by itself. */
export function fromPaste(plan: PastePlan): BuilderHeading[] {
  const out: BuilderHeading[] = [];
  let current: BuilderHeading | null = null;
  for (const c of plan.categories) {
    const rows = c.documents.map((d) => ({ ...newRow(d.title, kindOf(d.kind), true), docNo: d.docNo ?? '', auto: !d.docNo }));
    if (c.depth === 1 || !current) {
      current = { ...newHeading(c.name), rows };
      out.push(current);
    } else if (rows.length > 0 || c.depth >= 2) {
      // Only leaves carry documents in a register; an intermediate level with
      // none (A.2 PROCEDURE above A.2.1) is folded away.
      if (rows.length > 0) current.subs.push({ id: uid(), name: c.name, rows });
    }
  }
  return out.map((h) => (h.rows.length > 0 && h.subs.length > 0 ? addSubFirst(h) : h));
}

/** A pasted heading with both: its own documents go into a sub-heading named after it. */
function addSubFirst(h: BuilderHeading): BuilderHeading {
  return { ...h, rows: [], subs: [{ id: uid(), name: h.name, rows: h.rows }, ...h.subs] };
}

export function renumber(hs: BuilderHeading[], rule: NumberingRule, taken: string[]): BuilderHeading[] {
  const used = [...taken];
  const number = (heading: string, group: string | null) => (r: BuilderRow): BuilderRow => {
    if (!r.picked || !r.title.trim() || !r.auto) {
      if (r.picked && r.docNo) used.push(r.docNo);
      return r;
    }
    const docNo = nextNumber(rule, heading, group ?? r.title, r.kind, used);
    used.push(docNo);
    return { ...r, docNo };
  };
  return hs.map((h) => ({
    ...h,
    rows: h.rows.map(number(h.name, null)),
    subs: h.subs.map((s) => ({ ...s, rows: s.rows.map(number(h.name, s.name)) })),
  }));
}

const keep = (r: BuilderRow) => r.picked && r.title.trim() !== '';
const toDoc = (r: BuilderRow) => ({ docNo: r.docNo.trim() || null, title: r.title.trim(), kind: r.kind, planIfr: r.planIfr || null });

export function toDraftGroups(hs: BuilderHeading[]): DraftGroup[] {
  const out: DraftGroup[] = [];
  for (const h of hs) {
    if (h.subs.length === 0) out.push({ path: [h.name], documents: h.rows.filter(keep).map(toDoc) });
    for (const s of h.subs) out.push({ path: [h.name, s.name], documents: s.rows.filter(keep).map(toDoc) });
  }
  return out;
}

export function countDocuments(hs: BuilderHeading[]): number {
  return hs.reduce((n, h) => n + h.rows.filter(keep).length + h.subs.reduce((m, s) => m + s.rows.filter(keep).length, 0), 0);
}
```

- [ ] **Step 4: Run the test, expect "all passed".** (Task 2 widens `DraftGroup`; until then `tsc` may flag `kind`/`planIfr`, the script runs regardless.)
- [ ] **Step 5: Commit** `git add lib/builder-model.ts scripts/verify-builder-model.ts && git commit -m "Builder model: headings, optional sub-headings, numbers, draft groups (proved by script)"`

### Task 2: Storage, outline, sources, prefix

**Files:**
- Modify: `lib/register-seed.ts` (`DraftGroup`, `writeDraft`, `writeCategories`)
- Modify: `lib/register.ts` (`getRegisterOutline`, `getRegisterSources`, `getNumbering`)
- Modify: `lib/register-shared.ts` (`RegisterSource`)
- Create: `app/api/register/outline/route.ts`
- Test: `scripts/verify-edl-builder.ts`

**Interfaces:**
- Produces: `DraftGroup.documents: { docNo: string | null; title: string; kind?: 'Doc' | 'Dwg' | null; planIfr?: string | null }[]`; `getRegisterOutline(projectId: string, register: RegisterKind): OutlineHeading[]`; `getRegisterSources(currentProjectId: string, register: RegisterKind): RegisterSource[]` with `RegisterSource = { projectId: string; name: string; documents: number; headings: number }`; `GET /api/register/outline?project=<id>&register=edl|vdrl` → `OutlineHeading[]`.

- [ ] **Step 1: Write `scripts/verify-edl-builder.ts`** (fixture copy via `copyDbFixture`; set `REPORT_DB_PATH` before importing `lib/sqlite.ts`, as `verify-register-seed.ts` does):
  - insert project `builder-test` with `clientName`/`contractorName`;
  - `writeDraft` with groups `[['GENERAL','Execution Plan'] x2 docs, ['INSTRUMENT'] 1 Dwg doc with planIfr '2026-10-20']`;
  - assert: 3 categories, GENERAL has parent null and one child; documents 3; the Dwg doc has `kind === 'Dwg'`; it has exactly one `doc_stages` row, stage `IFR`, `plan_submit_date === '2026-10-20'`, `submitted === false`; the other two have no stage rows;
  - second `writeDraft` adding one doc to `['INSTRUMENT']` → categories still 3, documents 4;
  - `getRegisterOutline('pdemo-merbau','edl')` → 10 headings, 51 documents, 0 sub-headings, every document has `kind` Doc or Dwg;
  - `getRegisterSources('builder-test','edl')` includes `pdemo-merbau` with 51 documents and 10 headings, and excludes `builder-test`.
- [ ] **Step 2: Run, expect failure** (`getRegisterOutline` not exported; planIfr not written).
- [ ] **Step 3: Implement.**
  - `register-seed.ts`: widen `DraftGroup` as above; in `writeDraft` pass `kind: d.kind ?? null, planIfr: d.planIfr ?? null`; in `writeCategories`, after inserting a NEW document, when `planIfr` is an ISO date insert `{ id: randomUUID(), documentId: newId, stage: 'IFR', order: STAGE_ORDER.indexOf('IFR'), planSubmitDate: planIfr, submitted: false }` into `schema.docStages`. Updated (matched-by-number) documents do not touch stages.
  - `register.ts` `getRegisterOutline`: load categories + documents (ordered by `order`); roots = `parentId === null`; for each root, `documents` = docs directly on it, `subheadings` = every LEAF descendant (no children) other than the root, named by itself, with its docs, in tree order; `kind` via `kindOf` from `lib/builder-model.ts` (import the pure function, it imports nothing server-only).
  - `getRegisterSources`: `select project_id, count(*)` from documents where register matches and project ≠ current, join project names, heading count = roots in `doc_categories`; sort by name.
  - `getNumbering`: `suggestedPrefix: detectPrefix(taken) ?? (project?.alias?.trim() || project?.docNoPrefix?.split('-')[0] || '')`.
  - `app/api/register/outline/route.ts`:
    ```ts
    import { NextResponse } from 'next/server';
    import { getRegisterOutline } from '@/lib/register';
    export async function GET(req: Request) {
      const url = new URL(req.url);
      const project = url.searchParams.get('project') ?? '';
      const register = url.searchParams.get('register') === 'vdrl' ? 'vdrl' : 'edl';
      if (!project) return NextResponse.json({ error: 'project is required' }, { status: 400 });
      return NextResponse.json(getRegisterOutline(project, register), { headers: { 'Cache-Control': 'no-store' } });
    }
    ```
- [ ] **Step 4: Run both verify scripts, expect all passed;** run `npx tsc --noEmit -p` (filtered config, see memory) → 0.
- [ ] **Step 5: Commit.**

### Task 3: Builder page

**Files:**
- Rewrite: `components/dokumen/RegisterBuilder.tsx`
- Create: `components/dokumen/BuilderHeadingCard.tsx`, `components/dokumen/NumberingDialog.tsx`
- Modify: `components/dokumen/RegisterWorkbench.tsx` (pass `sources`, `existing`), the four pages (`getRegisterSources`)

**Interfaces:**
- `RegisterBuilder` props: `{ projectId; register; clientName; contractorName; hasDocuments; existing: { name: string; documents: number; subheadings: string[] }[]; numbering: { rule: NumberingRule | null; taken: string[]; suggestedPrefix: string }; sources: RegisterSource[]; onClose?: () => void }`.
- `BuilderHeadingCard` props: `{ heading: BuilderHeading; register: RegisterKind; onChange(h: BuilderHeading): void; onRemove(): void }`.
- `NumberingDialog` props: `{ open; onOpenChange; rule: NumberingRule; headings: string[]; onSave(rule: NumberingRule): void }` (local only; persisted with Save).

- [ ] **Step 1: Start step.** Three cards (`grid sm:grid-cols-3`): Copy from another project (lists `sources`; none → card disabled with "No other project has an EDL yet"), Paste from Excel (Textarea + "From an Excel file" using the existing `readRegisterFile` file path; mapping shown only when `plan.problems.length > 0` or title column is null), Start empty. `hasDocuments` skips this step. Choosing Copy fetches `/api/register/outline?project=…&register=…` (GET, retry once, error line with "Try again" per memory "never read through a server action").
- [ ] **Step 2: Build step.** State `headings: BuilderHeading[]` (+ `existing` as `newHeading(name, true, documents)` with their sub-headings), `rule` (saved or `defaultRule(suggestedPrefix)`), `client`/`contractor`. Derived `numbered = useMemo(() => renumber(headings, rule, taken), …)`. Sections: "What goes in this EDL?" chips (`headingSuggestions` + any heading not in suggestions) and an input "+ Your own heading" (Enter adds); Numbers line with "Change" opening `NumberingDialog` (lazy, own Suspense); names card only when `!clientName || !contractorName`; one `BuilderHeadingCard` per heading; sticky bar with `AnimatedNumber` count and "Save to the register". VDRL: same page, headings are vendor packages, no template suggestions (`headingSuggestions('vdrl')` is empty), the input reads "+ Package" and the question "Which vendor packages?".
- [ ] **Step 3: Motion.**
  ```tsx
  const swap = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: MOTION.duration, ease: MOTION.ease } };
  <AnimatePresence mode="wait" initial={false}>{step === 'start' ? <m.div key="start" {...swap}>…</m.div> : <m.div key="build" {...swap}>…</m.div>}</AnimatePresence>
  // heading cards
  <AnimatePresence initial={false}>{numbered.map((h) => (
    <m.div key={h.id} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
      transition={{ duration: MOTION.duration, ease: MOTION.ease }} style={{ contain: 'layout paint', overflow: 'hidden' }}>
      <BuilderHeadingCard … /></m.div>))}</AnimatePresence>
  ```
  Unticking a chip whose heading has typed rows asks first (`ConfirmDialog`). Locked (existing) headings cannot be unticked.
- [ ] **Step 4: `BuilderHeadingCard`.** Header: name, "N documents" (locked: "N existing · M new"), ⋯ (`DropdownMenu`, one per card is fine: ≤ ~15 cards) with Rename / Remove (not for locked). Rows grid `grid-cols-[22px_minmax(0,1fr)_5.75rem_9.5rem_8.5rem]` (checkbox column only when any row `fromSource`), phone: title full width, then kind + number + plan on a second line. Kind = two-button segmented control (black on/white off, `transition-colors duration-200 ease-ios`). Number = mono input; editing sets `auto:false`. Plan IFR = `input type="date"`. Add box: textarea-like input, Enter adds one row, paste with newlines adds many (`rowsFromText`); new row animates `initial={{opacity:0,y:8}} animate={{opacity:1,y:0}}` (that row only). Sub-headings: "+ Sub-heading" opens chips from `subSuggestions` + "Your own" input; `addSub`. Each sub shows its name with a grey bar, its rows, its own add box.
- [ ] **Step 5: Save.** `start(async () => { if (ruleChanged || !numbering.rule) await saveNumbering({ projectId, register, rule }); const r = await addFromDraft({ projectId, register, groups: toDraftGroups(numbered), clientName: client, contractorName: contractor }); … })`; on success call `onClose?.()` or `router.refresh()`; errors in the existing `errorBanner`. Save disabled when `countDocuments === 0` and no new headings, or names missing.
- [ ] **Step 6: Wire props.** Pages call `getRegisterSources(projectId, register)`; `RegisterWorkbench` takes `sources` and derives `existing` from `tree` (root name, `documents`, leaf names). Remove `existingSections` and the old views.
- [ ] **Step 7: Verify by pressing** (scratch puppeteer like `press-outstanding.mjs`, on project `asdasd` which has no EDL, then delete what was written by `projectId` in SQL): start empty, tick GENERAL + INSTRUMENT, type 2 rows, add sub-heading Procedure, type 1 row, set a Plan IFR, Save; assert DB rows and that EDL Data shows them. Copy from Merbau into `asdasd`, untick one, Save, assert 50 documents. Screenshot 1440 and 390. CDP trace at 390 with CPU 4x while ticking a heading and adding a row: no frame > 33 ms.
- [ ] **Step 8: Commit.**

### Task 4: Transmittal

**Files:**
- Modify: `lib/register.ts` (`ballOf`, `openStateOf` uses it, `getRegisterCards` adds `next`/`out`), `lib/register-shared.ts` (`DocumentCard`)
- Modify: `lib/doc-actions.ts` (`writeStage`, `saveStage` uses it, `recordTransmittal`)
- Create: `components/dokumen/TransmittalDialog.tsx`; Modify: `RegisterTools.tsx`, `RegisterWorkbench.tsx`
- Test: `scripts/verify-transmittal.ts`

**Interfaces:**
- `DocumentCard.next: DocStage | null` (stage to send when the ball is ours; null when out or complete); `DocumentCard.out: { stage: DocStage; since: string | null; days: number | null } | null`.
- `recordTransmittal(input: { projectId: string; register: RegisterKind; direction: 'out' | 'in'; date: string; letter: string; items: { documentId: string; stage: string; code?: string }[] }): Promise<ActionResult>`.
- Pure core for the script: `writeTransmittal(input)` in `lib/register-seed.ts`'s neighbour `lib/transmittal-write.ts` (no Next imports), called by the action.

- [ ] **Step 1: Test** `scripts/verify-transmittal.ts` on a fixture of `pdemo-merbau`: pick 3 documents whose `next` is not null at the last week; `writeTransmittal({direction:'out', date:'2026-10-05', letter:'MRB-TRM-O-0999', items})` → each stage row `submitted`, `submittedAt === '2026-10-05'`, all share ONE transmittal id with `no === 'MRB-TRM-O-0999'`, direction `out`; then `direction:'in'` with codes APP/AWC/RWC → `returnedAt`, `returnCode` set, one inbound transmittal; `in` for a stage never sent throws "not sent"; empty letter throws; plan dates untouched.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement.** `ballOf(rows, loaded)` returns `{ furthest, latest, out: boolean }`; `openStateOf` calls it (no behaviour change; re-run `scripts/verify-*` that touch the register). `next`: `rows[furthest + 1]?.stage`, else the next weighted stage after `latest.stage` in `loaded.weights`, else (nothing sent) the first weighted stage; null when out or when the latest is approved at the last weighted stage. `writeStage(tx, documentId, stage, patch)` upserts a `doc_stages` row (insert with `order: STAGE_ORDER.indexOf(stage)`); `saveStage` and `writeTransmittal` both use it. `recordTransmittal` = `beforeWrite()` → `ownedDocuments` → `writeTransmittal` → `refreshRegister()`.
- [ ] **Step 4: Dialog.** Copy `ExportExcelDialog`'s shell (`dialog-soft`, `scrim-soft`, deferred focus, `sm:max-w-2xl`). Direction: two large toggle buttons ("We sent documents" / "Documents came back"). Date (`type="date"`, default today) + Letter (required, mono). Search. List: `out` mode = cards with `next && !out`, outstanding first in `obstacles` order with the same pill words as `OutstandingBlock`, then the rest; row = `CheckBox`, pill, title, `NativeSelect` stage defaulting to `next`. `in` mode = cards with `out`, longest `days` first; row = `CheckBox`, "N days out", title, stage label, `NativeSelect` code (APP/AWC/RWC, default APP). Footer: "N documents in this letter" · Cancel · Save (disabled until letter + ≥1 ticked). List height animates with framer-motion when switching direction (`AnimatePresence mode="wait"`, opacity only). On success close and `router.refresh()`.
- [ ] **Step 5: Wire.** `RegisterTools` gets `onTransmittal`; button "Record transmittal" (outline) beside Add/Export; `RegisterWorkbench` lazy-mounts the dialog like `ExportExcelButton` (preload on pointerdown/focus, own Suspense).
- [ ] **Step 6: Verify by pressing** on a fixture-free path: record an outbound letter for 2 Merbau documents at week 30, check Summary's Outstanding/With the client change, then revert with SQL (delete the transmittal and restore the stage fields saved before). Screenshot 1440/390.
- [ ] **Step 7: Commit.**

### Task 5: Final gate

- [ ] Run all touched verify scripts, filtered `tsc`, `eslint` on changed files, `next build` into a throwaway `NEXT_DIST_DIR` (restore `tsconfig.json` after).
- [ ] Re-shoot Summary, Data and the builder at 1440 and 390 and look at them.
- [ ] Update memory `doc-control-open-thread.md`; ask the user before pushing.
