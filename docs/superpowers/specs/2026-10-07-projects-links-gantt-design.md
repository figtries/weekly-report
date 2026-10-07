# Projects: links between activities, and a Gantt that explains its dates — design

7 Oct 2026. Decided with the user in one session, from a Primavera P6 brief he
supplied (Gantt bars, relationship types, lag, float, critical path, baseline)
and three rounds of rendered variants. The brief was the reference; what ships
is the simpler subset below, in plain words, because the app is used by people
aged 22 to 60 who are not schedulers.

Scope is the Projects page only (planner sheet, Gantt, row panel). Progress,
Data Overall's screen, the reports and the exports do not change. The forecast
ENGINE does change, so that the forecast reads the same links the planner
makes.

## Why

The forecast can only be as good as its logic, and the logic was in the wrong
place. Links were made in Data Overall's activity panel, one at a time, during
the weekly update; the planner only GUESSED links from dates (`lib/chains.ts`)
and never stored them, so the planner's Gantt and the forecast could disagree
about the same plan. On 7 Oct 2026 Data Overall became read-only for links
(commit 11287f1) and the picker left it. This design is where they are made now:
with the plan, by whoever builds it.

## Decisions (locked in the session)

1. **Three ways, no fourth.** After it finishes (FS), After it starts (SS),
   Finishes after it finishes (FF). Start-to-finish is not offered: rarely used
   and the one most often misread.
2. **A wait of 0 days or more.** No negative wait (lead): an overlap is written
   as "After it starts + N days", which reads plainly; the P6 brief itself warns
   that leads make a plan hard to trace.
3. **No scheduler jargon on screen.** FS/SS/FF, lag, float, critical, driving,
   predecessor and successor never appear in the UI. The words are:

   | Concept | On screen |
   |---|---|
   | FS / SS / FF | After it finishes / After it starts / Finishes after it finishes |
   | Lag | Wait N days |
   | Total float | Can slip N days |
   | Critical | Sets the project finish |
   | Driving | Sets the date |
   | Predecessors / Successors | Waits for / Holds up |

   The codes stay in code and in this spec.
4. **Plan dates are typed, never computed.** P6 computes every date from logic;
   here the plan is a promise somebody typed, so logic CHECKS it and ASKS. A
   conflict is offered a move; declined, the link is still saved and the
   conflict stays visible (red, and listed in Check).
5. **Guesses become suggestions.** The date-chain guess (`inferChains`) and EPC
   order's guess (`unansweredLinks` in `lib/forecast-epc.ts`) are merged into
   one "Suggested" list per activity, each applied by its own press. No
   one-press "link the whole plan" (built and removed on 27 Sep 2026 because
   nothing showed what it had done). Shifting followers uses STORED links only.
6. **Gantt look: variant A** ("Tenang"). Bars keep their package colour; the
   activities that set the project finish get a red OUTLINE; "can slip" is a
   dashed grey tail with "+N days"; the contract is a thin grey bar beneath.
7. **Arrows: all drawn thin; the pressed bar's light up.** Pressing a bar makes
   its own arrows dark and thick and fades the rest; pressing empty space
   restores.
8. **Links are made in two places**: the row's ⋯ panel (phone and desktop), and
   by dragging between bar ends on the Gantt (desktop with a mouse only).
9. **"Lock as contract" is in scope.** It creates the contractual baseline,
   which no project has yet (all four carry only `active`). Versioned revisions
   stay board item 18.
10. **Calendar days only.** No working-day calendar, no holidays. Said plainly
    in this spec; the app never claims to match P6.

## Data

**No schema change.** Everything lives in columns and tables the deployed
snapshot already has, so `ensureSchema` and the snapshot restore are untouched.

- **Links**: `wbs_nodes.waits_for`, JSON, on the activity that waits (the
  successor). The shape becomes an array of `{ id, type, wait }`, where `type`
  is `'FS' | 'SS' | 'FF'` and `wait` an integer ≥ 0. A legacy entry that is a
  bare string id reads as `{ id, type: 'FS', wait: 0 }`; the column is
  rewritten in the new shape only when that activity's links are next saved.
  NULL keeps its meaning (nobody asked yet: suggestions are offered); `[]`
  means "waits for nothing", and suggestions are not offered again.
  Ten rows hold links today; all keep working.
- **One parser**: `parseLinks(raw): StoredLink[]` in one module, used by every
  reader that today does `parseIds` / `string[]` (`lib/dashboard-db.ts`,
  `lib/forecast.ts`, `lib/forecast-view.ts`, `lib/forecast-read.ts`,
  `lib/forecast-checks.ts`, `lib/forecast-epc.ts`, `lib/types.ts`). Anything
  malformed reads as no links, never as an error (today's rule).
- **Writer**: `setWaitsForSqlite` takes `StoredLink[]` and refuses, on the
  server, a link to itself, to an unknown id, to a summary row, a duplicate
  pair, and any link that closes a loop.
- **Activities only.** A summary row (a branch) has no links. When a row stops
  being a leaf (something is indented under it) its links and every link
  pointing at it are dropped, in `renumber()` (both copies, `lib/sheet-structure.ts`
  and `lib/paste-actions.ts`) — the stale-flag family of `isMilestone`. Deleting
  a row strips it from every other row's `waits_for`.
- **Contract**: a `baselines` row with `kind = 'contractual'`, `reason`
  required, `approvedAt` = now, `approvedBy` NULL until login exists (board 22),
  and one `node_schedules` row per scheduled leaf copied from the active
  baseline. At most one per project from the app.

## Computation — `lib/chains.ts`, evolved

`lib/chains.ts` already holds the network: `Link`, `computeFloat` (a backward
pass) and `shiftPreview`. It is extended rather than replaced. `inferChains`
stays, demoted to a suggestion source. Pure: no database, no React.

Dates are ISO days, inclusive; `dur = finish − start + 1`. For a link A → B:

| Way | Holds when |
|---|---|
| FS, wait w | B.start ≥ A.finish + 1 + w |
| SS, wait w | B.start ≥ A.start + w |
| FF, wait w | B.finish ≥ A.finish + w |

A milestone is an event at the end of its date: FS INTO a milestone holds when
M.date ≥ A.finish + w (no +1); FS OUT of a milestone uses M.date as A.finish.

Per activity, on PLAN dates (the active baseline):

- **slack of a link** = B's side minus the bound. `< 0` is a **conflict**,
  `= 0` makes A **"Sets the date"** for B (several can), `> 0` is a link that
  holds with room.
- **Why sentence**, one per activity, from the link with the least slack:
  - slack 0, FS: "Starts 13 Apr because PFD finishes 12 Apr."
  - slack 0, SS: "Starts 20 Apr, 7 days after PFD starts."
  - slack 0, FF: "Finishes 17 May, 6 days after HAZOP finishes."
  - slack > 0: "Starts 20 Apr; PFD would allow 13 Apr."
  - conflict: "Starts 13 Apr, before PFD finishes (20 Apr)." (red)
  - no links: "Not linked yet. Its dates are typed."
- **Reaches the finish**: an activity whose plan finish is the project's last
  finish and that holds nothing up, or one that holds up something that
  reaches the finish. Only these get a "can slip" figure.
- **Can slip** (total float) = latest allowed finish − plan finish, where the
  latest allowed finish is the project finish for a finishing activity and
  otherwise the minimum, over successors that reach the finish, of:
  FS: LS(B) − 1 − w · SS: LS(B) − w + dur(A) − 1 · FF: LF(B) − w,
  with LS(B) = LF(B) − dur(B) + 1.
- **Sets the project finish** = reaches the finish and can slip ≤ 0.
  `SheetRow.isCritical` (read by the `critical` bar-style condition) now comes
  from here instead of from the inferred chain.
- **Does not reach the finish**: no figure. The chip reads "Nothing waits for
  this yet" (no successor) or "Not linked through to the finish yet". This
  replaces today's rule in `computeFloat`, which gave an unlinked row float up
  to the project finish ("+200 days"): with stored links that figure would be a
  lie told about a row nobody has linked yet.
- **Loops**: refused on write. On read (legacy or hand-edited data), the link
  that closes a loop is ignored and named in Check.

`shiftPreview` is generalised to the three ways and to stored links: given a
row whose dates moved, it returns the followers that would now conflict and the
smallest move that clears each, cascading, duration kept. It never moves a row
EARLIER.

### Forecast (`lib/forecast.ts`)

Reads `StoredLink[]` instead of ids. A late predecessor pushes per way:
FS forecast start ≥ its forecast finish + 1 + w; SS forecast start ≥ its
forecast start + w; FF forecast finish ≥ its forecast finish + w. The
`DRIVING_SLACK_DAYS` tolerance existed because links were guessed from dates
with weekend gaps; with explicit links and waits the bound is exact and the
tolerance goes. `scripts/verify-forecast.ts`, `verify-forecast-store.ts` and
`verify-priority-actions.ts` (its "Slips N wk" reads the forecast) are re-run;
any figure that moves is explained in the plan, not silently updated.

## Gantt (`components/projects/GanttChart.tsx`)

- **Bars**: unchanged shapes (task bar in its bar-style colour, summary
  bracket, milestone diamond).
- **Sets the project finish**: a 2px red outline around the bar or diamond,
  drawn ABOVE whatever paint the rules chose, so no rule can hide it.
- **Can slip**: a dashed grey line from the bar's end to its latest allowed
  finish, a short end tick, and "+N days". Nothing for a row without a figure.
- **Contract**: a 4px grey bar beneath the bar, only once a contract exists.
- **Conflict**: the link's arrow red and dashed, a red "!" at the bar's start,
  and a pale red band over the overlap.
- **Today**: a blue dashed vertical line.
- **Arrows**: FS from the right end to the left end, SS left to left, FF right
  to right, as elbows; "+N days" near the entering end when the wait is > 0.
  All thin grey; links on the finish-setting path a darker grey; the pressed
  bar's arrows dark and thick with the rest faded. With a group collapsed, an
  arrow to a hidden row ends on the group's bracket.
- **Legend** gains Sets the project finish, Can slip, Contract, Conflict, Today.
- **One SVG layer for all arrows**, not a component per row (the
  "Radix per screen, never per row" rule; 185 rows on Merbau).

### Drag to link (desktop, `(pointer: fine)` only)

Handles appear at both ends of a hovered activity bar (none on summaries).
Dragging from a handle draws a dashed line that follows the pointer; the
nearest bar end under it lights up. The ends decide the way: right → left FS,
left → left SS, right → right FF. On release a small card reads "P&ID waits for
PFD · After it finishes · Wait [0] days" with the way changeable, Save and
Cancel. A drag that would loop shows "Would loop back: A → B → A" and Save is
off. Esc or a release on empty space cancels. Bars themselves are not draggable
(they are not today either), so the two gestures cannot be confused. On touch
there are no handles; the panel is the way.

## Row panel (`components/projects/RowMenu.tsx`)

- The ⋯ menu of an activity gains a first entry, **Links: Waits for N · Holds
  up N**, which switches the same panel to a Links view with a Back control.
  Summaries do not get it.
- Top: the why sentence and ONE chip: Sets the project finish / Can slip N days
  / Nothing waits for this yet / Not linked through to the finish yet, or the
  red conflict sentence. "N days later than contract" under it once a contract
  exists and the finish differs.
- **Waits for**: each link as name, a native `<select>` of the three ways, a
  "Wait __ days" number input (integer, ≥ 0), and ✕. A predecessor with slack 0
  carries "Sets the date".
- **+ Add what it waits for**: a search box over activities. The row itself is
  absent; a row that would close a loop is shown disabled with "Would loop back
  through X".
- **Suggested**: the merged guesses, each with "Use". Shown only while the
  activity's links are NULL.
- **Holds up**: the same, for successors (writing goes to each successor's
  `waits_for`).
- **Nothing is saved before Save**; Cancel discards. Native inputs only: the
  lists can be long.

## Conflicts

Two triggers: a Save (panel or drag card) that creates a conflict, and a date
edit after which a follower conflicts. Both show the existing `ShiftPreview`
surface, now fed by stored links: "PFD now finishes 20 Apr. P&ID waits for it
but starts 13 Apr. Move P&ID and 2 after it by 8 days?", the rows that would
move, and the plan weeks that change. **Move N rows** applies the smallest
moves; **Keep dates** leaves the dates, and the link stays saved.

A standing conflict shows in four places: a red ! in the sheet row, the Gantt
markers above, the red sentence in the panel, and ONE strip over the planner,
"2 activities start before what they wait for", naming them, each pressable
(the Weights strip pattern). It is also a finding in Check (`lib/analysis.ts`).
"Nothing waits for this yet" is a per-row chip only, never a strip: at the
start every row is unlinked, and a strip would shout before anyone had done
anything.

## Lock as contract

A button beside Details in the Projects header, shown while the project has no
contractual baseline. Its dialog says what it does — "Copies today's plan of
146 activities as the contract. The plan stays editable; the contract never
moves." — and asks for a reason (required). Save writes the baseline and its
schedules in one transaction. Afterwards the button is replaced by "Contract
locked 7 Oct 26"; there is no unlock in the app. The weekly plan curve keeps
reading the ACTIVE baseline: reports, Data Overall and the dashboard do not
change.

## Out of scope

Start-to-finish links, negative waits, working calendars and holidays,
constraints, links between projects, Level of Effort, early/late/remaining bars
as separate bars, more than one comparison baseline, baseline revisions (board
18), actual start/finish on the Gantt, a "Waits for" column in the sheet (B in
the session; codes, desktop only), and any change to Data Overall's screen.

## Verifying

- `scripts/verify-schedule-logic.ts` on a hand-built plan: each way's bound
  with and without a wait; milestone in and out; Sets the date (incl. two at
  once); can slip and the finish-setting path; no figure off the finish;
  conflicts; loop refusal and loop-on-read; legacy string links read as FS + 0;
  leaf-to-summary drops links; delete strips links.
- The three forecast-reading verify scripts above, plus SS/FF/wait cases.
- Pressed, not rendered: panel Save and Cancel, Use on a suggestion, the drag
  card on desktop, both answers to a conflict, Lock — each asserting state
  before and after, read back after a reload.
- `scripts/shoot.mjs` at 390px and desktop, looked at.
- `next build` to a file, exit code echoed, before any push.
