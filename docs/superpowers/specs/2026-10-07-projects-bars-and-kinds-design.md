# Projects: bars that read the plan, and the kind of work set while planning — design

7 Oct 2026, the second session of the day on Projects. Decided with the user
from his Primavera P6 brief (twelve bar types, eight shape variations) and two
rounds of rendered variants. His instruction for the brief: "amati, tiru,
modifikasi" — not a copy of P6, but what P6 does, made simpler where P6 makes
people think.

Follows `2026-10-07-projects-links-gantt-design.md` (links, Gantt variant A,
Lock as contract), which is built and not yet pushed.

## Why

Three things he saw on the Projects page:

1. **The links have no menu.** They open only from the `⋯` on a row, which is
   exactly the hiding place `SheetToolbar` was written to end.
2. **Bar styles is raw.** An ordered rule list (When / Colour / Shape, first
   match wins) asks a planner to design a legend. The P6 bar types he expected
   (actual, remaining, baseline, float, % complete) are not there at all.
3. **The plan is not the source of everything yet.** The kind of work
   (Engineering, Procurement, Construction, Commissioning) is asked in Data
   Overall during the weekly update, so a plan can be built without anyone
   saying what each activity IS. "Semua harus jelas, based on plan."

## Decisions (locked in the session)

1. **Twelve P6 bar types become one bar and four marks.**
   - Planned + Actual + % Complete + Remaining + Current → ONE bar: the plan's
     dates, split into the kind's stages, solid where done.
   - Current/Remaining past the plan + Negative float → **Forecast**: a red
     hatched extension past the plan finish, labelled "+N d".
   - Baseline → **Contract**: the thin grey bar under a task (exists).
   - Float + Late bar → **Can slip**: the dashed tail (exists).
   - Critical → the red outline on rows that set the project finish (exists,
     always drawn, not a mark).
   - User defined → the target date hatch (exists, drawn only once passed).
   - Early bar, necking: dropped. The plan is already checked against its
     links, and the app counts calendar days.
2. **What P6 does not do, and we do.**
   - A bar shows the STAGES of its work (IFR / IFA / AFC; PO, Fab, RTS, On
     site), solid as each is ticked. A P6 bar is one undivided slab.
   - Pressing a bar says, in one sentence, its plan, how much is done, when it
     finishes, how late and WHY, and its contract dates.
   - Days are written at the end of a mark ("+7 d"), never counted off a grid.
   - No setup: marks are on or off, colours are picked from a swatch.
3. **Bars is its own menu.** A `Bars` button in the planner toolbar opens one
   panel: *Colour bars by* (Kind of work / Package / One colour), a swatch per
   colour that the planner may change freely, and the four marks on/off. The
   Bar styles dialog, its rule editor and its two presets are removed.
4. **Default colour is Kind of work**, so E → P → C reads from the colours.
5. **The kind of work is set while planning, and ONLY there.** The row panel
   in Projects asks "What kind of work is this?" (the same picker Data Overall
   uses today, construction's nine disciplines included). Data Overall SHOWS
   the kind and its stages are ticked there; to change the kind, its button
   takes you to that row in the planner. "Kalo mau ubah arahin kesana, jadi
   jelas semuanya dan berkorelasi."
6. **Set on a heading, it applies to the rows under it**: every row under it
   with no kind, or still carrying the heading's previous kind. A row given a
   different kind of its own is left alone. A row added under a heading takes
   its kind. Indent and move do not change a kind: it is a fact about the work,
   not about where it sits.
7. **Links get a toolbar button** beside Bars, acting on the selected row,
   disabled like Indent and Delete when nothing is selected.
8. **Data Overall shows links only when there are some**, read only, with no
   button.

## What the user sees

### Planner toolbar

`… | Indent  Outdent  Delete | Expand all  Undo | Links  Bars | Find a row`

- **Links** opens the existing `LinksPanel` for the selected row (the same
  panel the `⋯` opens; the `⋯` entry stays).
- **Bars** opens the Bars panel. Lazy, warmed when idle, as the Links panel is.
  The old "Bar styles" button over the Gantt goes.

### Bars panel

- **Colour bars by** — a segmented control: Kind of work · Package · One colour.
  "Package" is offered only when the plan has two or more packages (the
  existing `pickPreset` test: a colour that cannot tell rows apart says nothing).
- **Colours** — one swatch per thing coloured: each kind (Engineering,
  Procurement, Construction, Commissioning, Other), each package, or the one
  colour. A press opens a palette of the planner's EIGHT existing tokens
  (`--plan-1`…`--plan-6`, black, grey) — one token source, no new palette.
  Red and amber are not offered: red is the forecast's and amber the target's,
  and a red bar would hide its own red hatch.
  Defaults: Engineering indigo, Procurement fuchsia, Construction teal,
  Commissioning sky, Other grey. Package colours default to today's
  `colorGroup` assignment.
- **Show on the timeline** — four switches, each with its mark drawn and one
  sentence:
  - Done · "Solid part = ticked so far" · default ON
  - Forecast · "Red hatch = days past the plan" · default ON
  - Contract · "Thin grey line = the locked dates" · listed only once a
    contract is locked · default ON
  - Can slip · "Dashed = days it may move" · default OFF
- Every change saves at once (as the Bar styles dialog did) and the Gantt
  follows. The legend under the Gantt is built from what is on.

### Row panel (the `⋯`, phone and desktop)

- A new entry: **"Kind of work: Engineering"** (or "Kind of work: not set").
  It opens a view holding the existing `WorkKindPicker` (its suggestions, its
  nine construction disciplines) and, under it, the bar this row will get.
  One Save at the foot, the panel's own, as in Data Overall.
- On a heading the view says what it will touch: "Applies to the 12 rows under
  it that have no kind of their own."
- Changing the kind of a row with progress follows the existing rule
  (`applyProgressMethod`): progress is carried across, never zeroed.
- A milestone stays a milestone through its own switch in the same panel; it
  is not a kind.

### The bar

- **Stages.** A task's bar is cut into its kind's rungs, each as wide as its
  weight, so the solid length IS the Done percentage. Done rungs are solid in
  the bar's colour, the rest are its tint. A rung's label is written inside
  when it fits (≥ 28 px), otherwise left to the sentence.
  - A row that IS one rung (named "IFR", the picker's `gate` shape) is one
    segment carrying that label.
  - Quantity and typed-percent rows are one segment filled to their percent.
  - Procurement's bar carries a small flag at its finish: the on-site date.
- Heading: the black bracket. Milestone: the diamond (black).
- **Forecast** (when on): a red hatched extension from the plan finish to the
  forecast finish, "+N d" after it. Nothing when the forecast is on plan.
- **Contract**, **Can slip**, the red outline and the target hatch draw as they
  do today.
- Done and Forecast are read as of the project's CURRENT week, from the same
  functions Data Overall uses (`lib/progress.ts` through the rollup,
  `forecastFromDb`), so the planner cannot disagree with Data Overall. With no
  progress yet, bars are plain.

### Pressing a bar

The strip over the sheet that already names the selected row ("1.1.1.3 Piping
… 56 d · 23 Mar 26 → 17 May 26") carries the sentence:

> Plan 23 Mar → 17 May · Done 60% (IFR, IFA) · Finishes 24 May, 7 days late
> because it waits for Process Design Basis · Sets the project finish ·
> Contract 18 Mar → 12 May

Each clause appears only when it has something to say. The "because" is the
forecast's own reason (`ForecastLeafView`), never a new one.

### Data Overall

- **Kind set in the plan:** the activity panel opens straight on its stages
  ("How far has it got?"). Above them, "Kind of work · Procurement" (with the
  discipline for construction) and a **Change in plan** button.
- **Kind not set:** "Kind of work not set in the plan" and a **Set in plan**
  button. Meanwhile the row is filled in as a typed percent, which is always
  allowed.
- Both buttons go to `/projects/<id>#row=<nodeId>&open=kind`: the planner
  selects the row, opens its ancestors, scrolls to it and opens the kind view.
  A hash, not a searchParam, because a searchParam under `cacheComponents`
  needs its own `<Suspense>` and fails the build otherwise.
- **"What has to finish before this one?"** shows only when the activity waits
  for something, read only, with no button. The forecast card stays.

## Data

- **Kind: no new column.** `wbs_nodes.work_kind` stays the one store, now also
  written on headings. The ladder (rungs and weights) is still written per
  activity through `setWorkKindSqlite`. A new action applies a heading's kind
  to its rows under rule 6 in one transaction. The add-row path reads the
  nearest heading's kind and writes the new row's ladder.
- **Bars: one new column,** `projects.bar_view` (JSON text, null = defaults):

  ```ts
  interface BarView {
    colourBy: 'kind' | 'package' | 'one';
    marks: { done: boolean; forecast: boolean; contract: boolean; slip: boolean };
    colours: { kind: Record<string, BarPaint>; package: Record<string, BarPaint>; one: BarPaint };
  }
  ```

  Migration + one line in `EXPECTED_COLUMNS` + `seed.db` migrated and
  checkpointed, as AGENTS.md prescribes for a column.
- **Retired, not dropped:** `bar_styles` and `projects.bar_preset` stop being
  read. Dropping a table is the drizzle rebuild that has deleted child rows
  here before; they cost nothing left in place.
- **Bar facts** travel as their own prop beside the sheet, not inside
  `SheetRow`, because the planner owns its rows once seeded
  (`planner-sheet-owns-its-rows`): `Map<nodeId, { donePct, rungs: {label,
  weight, done}[], forecastFinish, reason }>`, built server-side in a new
  `lib/bar-facts.ts` from the project's current week. A kind change returns the
  row's new facts with the sheet.
- `lib/bar-styles.ts` (rule list, `resolveBar`, presets) is replaced by
  `lib/bar-view.ts`: defaults, the colour a row gets, the segments of its bar.
  Pure, no React, no database.

## Removed

`BarStyleEditor.tsx`, `lib/bar-style-actions.ts`, the rule engine in
`lib/bar-styles.ts`, the "Bar styles" button; the kind picker and its Change
in Data Overall's `ActivityPanel` (replaced by the read-only line and the link);
the empty-state text and Set/Change in plan button of the links section in
`ForecastBlock`.

## Verifying

- `scripts/verify-bar-view.ts` (new): colour per mode, defaults and overrides;
  segments add to the bar's width and the solid part equals Done % for every
  shape; heading kind applies under rule 6 and spares a row with its own kind;
  a row added under a heading takes its kind.
- On the largest plan in the database: every leaf's planner Done % equals Data
  Overall's figure, and its forecast finish equals Data Overall's.
- Pressed, not rendered: Links in the toolbar opens the selected row's links;
  each Bars switch and swatch changes the Gantt and survives a reload; setting
  a heading's kind recolours its rows; Data Overall's Change in plan lands on
  the planner with that row's kind view open. `scripts/shoot.mjs` at 390 px and
  desktop, looked at.
- Projects page measured A/B against a baseline build with
  `scripts/verify-projects-perf.mjs`, same session.
- `next build` to a file, exit code echoed.
- AGENTS.md: the Projects and Data Overall paragraphs updated to say the kind
  is set in the plan and the bar is the plan's.

## Out of scope

Working-day calendars, P6's early/late/necking bars, colouring headings by
kind, setting the kind of several selected rows at once, and anything pushed
before he says yes.
