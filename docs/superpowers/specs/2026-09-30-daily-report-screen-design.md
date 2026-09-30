# Daily report: the fill-in screen (slice 1 of 3)

Decided 30 Sep 2026 in a brainstorm with the mockups of `entry-shape` (A cards,
B steps, C today log). Chosen: **A plus the timed "Today so far" list from C.**
Slice 2 (Excel export) and slice 3 (Excel import) follow and are only sketched
here so slice 1 does not paint them into a corner.

## Why

The form built so far is the client's Excel moved onto a phone: every day the
field engineer types each block again, although a daily report is about 90% the
same as yesterday's. The field engineer is the one accountable owner of the
report (who feeds them differs per project), so this is designed for ONE person,
not for roles. The pain named was all of it: activities, man hours, PTW, HSE,
photos, progress figures and typing on a phone.

The principle: **today opens as yesterday, already filled in, and a person only
corrects what differs.** Nothing counts as ready until a person said so, except
what they entered or what the app derives.

## The Excel it must eventually leave as (slices 2 and 3)

One standard format for every project, exactly the supplied file
`PRGG-00-G0-RPT-003_DAILY PROGRESS REPORT`: header (date, Hari ke-, contractor,
contract no, location, company, document no, two logos), weather, 1 Man Hours
plus Non Effective Hours, 2 PTW, 3 HSE Input, 4 Daily Activities (today |
tomorrow), 5 Area of Concern / Ask for Help, 6 Progress Summary (plan, actual,
deviation), signatures (images), 7 photos. Only logos, names and the responsible
signatories vary per project. Slice 1 adds the one block the app never had
(AOC/AFH) so the data model already covers the whole sheet.

## Scope of slice 1

The screen at `/daily/[date]`, the carry-forward rules that fill it, the new
AOC/AFH block, the timed log, and progress read from weekly. NOT in slice 1:
Excel export/import (the PDF button stays until slice 2 replaces it), WhatsApp
paste, the daily list's own redesign (it only changes where its two percentages
come from).

## Data (`lib/types.ts`, still the per-project JSON record; no new table)

All additions are optional so every stored report still reads.

- `todayItems?: ActivityItem[]`, `tomorrowItems?: ActivityItem[]` where
  `ActivityItem = { id, text, done }`. Reading a report without them splits the
  legacy `activitiesToday` / `activitiesTomorrow` on line breaks (stripping a
  leading "1." style number). The two strings keep being WRITTEN (joined, one
  numbered line per item) so `/print/daily` and old readers keep working until
  slice 2.
- `aoc?: AocRow[]`, `aocNone?: boolean` where
  `AocRow = { id, type: 'AOC' | 'AFH', description, date, actionBy, status }`
  (the sheet's columns: Type, Description, Date, Action by, Status).
- `ManHourRow.hoursEach?: number`. Hours each person works per day; when set,
  `todayHours = pobQty × hoursEach` (the workbook's formula: 8 office, 12 site).
  It is what lets a day be filled by counting heads. Rows without it infer it
  when the hours divide evenly (`inferHoursEach`).
- `log?: LogEntry[]` where
  `LogEntry = { id, at (ISO), kind: 'activity' | 'hse' | 'ptw' | 'note', text }`.
  The log records what a person DID (a tap, an addition), never totals: a typed
  correction is not logged. Photos are NOT logged here: their time is the
  camera's `takenAt` when it falls on the report's own date, otherwise the
  `uploadedAt` the photo route already writes in `photoMeta`.
- `confirmed?: Partial<Record<DailySectionKey, true>>`.
- `DailySectionKey = 'weather' | 'manHours' | 'ptw' | 'hse' | 'activities' |
  'aoc' | 'progress' | 'photos'`. Non Effective Hours lives inside the Man Hours
  card, as it does on the sheet.

`planPct` and `actualPct` stop being written. Everything that showed them (the
report, the daily list, `/print/daily`) reads weekly instead, see below.

## Carry-forward on create (`applyCreateDaily`)

Already done and kept: Non Effective and HSE counters. Man hours changed: POB
carries, previous grows by yesterday's today, and today opens at
`pobQty × hoursEach` instead of 0. Added:

- PTW rows whose status is still OPEN come along.
- Yesterday's `tomorrowItems` become today's `todayItems`, unticked. Items left
  unticked at the end of a day are offered again as suggested tomorrow items.
- Weather is NOT carried: it is entered every day.
- Photos and the log start empty. `confirmed` starts empty.

## Section states

A pure function `sectionStates(report, ctx)` in `lib/daily-status.ts`, one
answer per section, so the hero count, the chips and the tests cannot disagree:

| State | Chip | Meaning |
|---|---|---|
| ready | Ready | confirmed, or entered, or derived and available |
| same | Same as yesterday | carried content that nobody has confirmed |
| look | Needs a look | a rule flags it, see below |
| empty | Empty, None today | nothing yet |
| held | Held | progress only: the weights have not closed |

Rules: Weather is `ready` once any condition is picked, else `look`. Man Hours,
PTW and HSE are `same` while carried and unconfirmed, and any edit confirms.
PTW is `look` while an OPEN permit's validity is before the report date (the
supplied file has one OPEN permit valid to 23 Nov 2025 on a 12 Mar 2026 report:
109 days). Daily Activities is `same` ("N to tick") until confirmed. AOC is
`ready` with rows or "None today". Photos is `ready` with at least one photo
(chip "N of 6"). Progress is `ready` when `weightGate(...).ok`, else `held`. The
hero counts `ready` out of 8.

## Progress is weekly, never typed daily

The user's ruling: what matters is the weekly percentage, so the daily report
does not ask for one. The Progress card is read-only and shows the figures of
week `min(weekOfDate(anchorEnd, date), status.week)`, where `status.week` is the
project's current week (`getOpenProjectStatus`, pinned or by the dates): the week
the date falls in, never a week beyond the one the project is in.
Figures are `GrandTotal.planPct` / `deviationPct` and actual on the one scale
(never `targetWF`), drawn with `PlanActualBar` (blue actual over thin red plan),
and printed as "Week N", with `fmtPct`. While `weightGate` fails the card says
"Held until the weights reach 100%" and shows no figure, the same rule as every
other surface. Slice 2 writes these same figures into the sheet's Progress
Summary cells; slice 3 ignores those cells on import.

## Save model

No Save button. Each section commits when it changes: Confirm, +1, add or
remove a row, a text field on blur. `patchDailyAction(date, patch, logs)` applies
the patch and appends the log entries in the SAME `mutateOpenDb`, so the timeline
can never show something the report does not hold, and it does NOT `refresh()`.
The client keeps an optimistic copy with ONE write in flight; changes made
meanwhile merge into the next write instead of one round trip per tap (nine
quick changes became five writes in the press test). A failed batch puts back
exactly what it changed and shows "Not saved. Try again". The hero says "Saving…"
and then "All changes saved". Back and Save PDF wait for the queue, and
`beforeunload` guards while anything is unsaved: the first press test reloaded
before the queue drained and lost four changes. The "Leave without saving?"
dialog goes with the button. Writes stay awaited server actions (the store is
single-writer, see CLAUDE.md), reads stay in the RSC page.

Known trade-off: a day that is created and never touched still carries its
crew's hours into the cumulative. That is what the "Same as yesterday" chip and
its Confirm exist to make visible; a closed day is set to zero people.

## Screen

`app/daily/[date]/page.tsx` keeps its Suspense and `connection()` handling and
hands a `DailyReportScreen` client component the report plus the derived
figures. `DailyForm.tsx` is retired once the screen replaces it.

- **Hero**: date, project, Day no. control (unchanged behavior), a segmented
  meter of the 8 sections, the ready count, and the PDF button until slice 2.
- **Today so far**: the timed log, newest first, capped at 3 with "All N".
  Photos appear in it by `uploadedAt`. Under the hero on a phone, a sticky right
  column from `lg`.
- **Section cards**: eight, each a summary line and a status chip, opening in
  place. The quick-add lives inside its own card: camera in Photos, "+ Add" with
  suggestion chips in Daily Activities (suggestions are the sentences already
  used in this project's earlier reports, most recent first, deduplicated), +1
  per row in HSE, "+ Add permit" in PTW. Cards that are `same` or `look` show
  their two actions (Confirm / Change, Close it / Extend validity) without
  opening.

## Look

Nothing new. The app's own surfaces: cards are `rounded-lg border-border
bg-card shadow-sm`, the hero uses the `OverviewHero` surface in
`components/weekly/WbsTreeVisual.tsx` (white to gray-50, segmented meter, tinted
count pills, micro-labels). The blue gradient of the sketch is NOT used: it was
a new colour. Status chips are fixed-width rounded rectangles (not capsules) in
the palette pairs `statusOf` / `STATUS_LEGEND` already define. Buttons are
`components/ui/button`, font Inter, labels capital-first, no em dash in copy,
touch targets at least 44px, nothing that appears only on hover, and English
copy (the report data stays as typed).

## Motion

Entrance on load is CSS keyframes (`Reveal`, `animate-enter`, `stagger-N`),
never framer-motion `initial` in server HTML. Framer-motion (`m`, `MOTION`) only
for what a person's action causes: a card opening and closing (`Expand`), the
chip changing (`Swap`), the meter segments filling, hours counting up
(`CountUp` / `AnimatedNumber`), and a log entry arriving (`AnimatePresence`).
Presses use `Press`. Eight cards is under the ~20 limit, so per-card motion is
fine; rows inside a card stay plain elements. Radix is not used per row: native
inputs and selects inside the cards, and any Dialog loads through
`next/dynamic`. `/print/*` stays free of both.

## Responsive

390px: one column. `md`: the cards in two columns. `lg`: cards left, the log a
sticky column on the right. Checked with `scripts/shoot.mjs` at 390px, 768px and
desktop, not by extracted text.

## Verification

1. `scripts/verify-daily-carry.ts`: build a small database by hand and assert
   the carry-forward rules and every `sectionStates` row above, including the
   109-day PTW.
2. Type-check with the filtered tsconfig, `next build` to a file with its exit
   code echoed (never through a pipe).
3. Screenshots at 390px, 768px and desktop, looked at.
4. Press the real buttons and assert state before and after: Confirm on Man
   Hours, +1 on HSE, add an activity from a suggestion, tick and untick, add a
   photo, reload and see it persisted.

## Slices 2 and 3, for the record

- **Export** fills the supplied file as a template instead of redrawing it, so
  logos, merges, fonts, column widths, formulas and page setup stay the client's
  own. The header, logos, names and signatures come from project details. The
  template has fixed row capacity (activities 8, man hours 3 plus a spare, one
  PTW row), so growth needs an answer that does not break merges. There is no
  LibreOffice on the development machine: "exact" is proved by comparing the
  output's structure (merges, styles, widths, images, formulas) against the
  template. The daily PDF button becomes Export Excel.
- **Import** reads the same cells back, one file or a whole folder at once (the
  sample folder holds December to July), in date order so the "previous" man
  hours chain builds itself. Progress cells are ignored: weekly is the source.
- The meaning of the sheet's "Hari ke-" cell against the app's Day no. control is
  settled in slice 2 with the workbook open.
