# Completion forecast the way an EPC planner makes one — design

27 Sep 2026. Decided with the user in one session, from the deployed project
(RTC, PHSS Semberah) at week 38. EPC is the first INDUSTRY PROFILE: the app's
users are energy-industry companies, and each sector will later get its own
profile chosen at project creation (not built here).

## What was wrong

The Forecast card is `computeHealth` in `lib/analysis.ts`: week + (100 −
actual) / average % per week over the last 4 weeks. At W38 it read **Week 56,
16 weeks earlier**: (52.66 − 42.08) / 4 = 2.64 %/wk, 47.34 / 2.64 = 17.9 wk.

- **It measures data entry, not site work.** Actual was 0 until W25, +40.1 at
  W26 (backfill), flat, +10.7 at W36 (Engineering by Solar ticked 100% at once,
  work done Feb–May). At W40 the window passes W36, PO 2.1 fell 100→99 at W37,
  the pace goes negative and the card goes blank. Nothing happened on site.
- **Weight is money, not time.** Procurement is 69.72% of the weight. The
  finish is set by Consumable Retrofit fab (W46–63) → shipment (W58–72) →
  installation (W68–70) → commissioning (W70–72), worth ~14 points together. The
  15-point lead is in Solar material, which is not on that path.
- Same data, three methods: 4-week pace **W56**, Earned Schedule **W65**
  (ES 42.26, SPI(t) 1.11), activity by activity **W72**.

And the data under it had problems nobody could see: Preparation Work and
Installation tagged Engineering, Commissioning tagged Procurement, 2.2/2.4/2.5
untagged; PO, Fab & RTS and Shipment rows EACH carrying the whole procurement
ladder; 2.1 at 99% by a typed override over a 75% ladder; no links between
activities (dates overlap, `lib/chains.ts` infers none).

## Decisions

1. **Bottom-up, schedule-driven forecast is the forecast.** Every remaining
   activity gets a forecast finish from the status date; the project finishes
   when the last one does; the card names the chain that sets it. The S-curve
   stays the measurement. Earned Schedule is shown only as a second opinion.
2. **The app finds everything itself.** Every finding above becomes a rule the
   app runs on any project (checks C1–C5 below). Nothing depends on someone
   reading the data by hand.
3. **Everything is asked in Data Overall's ActivityPanel, through the helper
   that is already there** (work kind → ladder → ticks). Two small additions,
   one fix. No new screen, no form.
4. **Only a person knows two things**: when the next rung happens according to
   the outside party (vendor, site, client: shutdown, permit, review), and what
   waits for what. Both are prefilled; left alone, the forecast follows the plan
   and says so. The app never invents a date.
5. **No numeric range.** A P50/P80 needs a risk model this data cannot support
   yet; a range made up from nothing breaks "app computes, user decides".
   Instead the card says how much of the path is evidence and how much is plan.

## The engine (`lib/forecast.ts`, pure)

Status date D = end of the viewed week. Per leaf: planned start PS, planned
finish PF, duration = PF − PS + 1 days, pct from `lib/progress.ts` (never its
own), ladder + ticks, typed forecast (date, source, rung), waitsFor.

**Push from predecessors.** For each A in waitsFor(B):
`push = max(0, FF(A) − max(PF(A), PS(B)))`. A planned gap is float (a slip
smaller than the gap moves nothing); a planned overlap keeps its offset (a
slip moves B by the slip). This is what stops the plan's own overlaps raising
false alarms. `push(B)` = the largest over its predecessors.

**Forecast finish FF(B):**

| State | FF |
|---|---|
| pct = 100 | the week it reached 100 (from the log) |
| not started | start = max(PS + push, D) (a start that should have happened lands today); FF = start + duration |
| in progress, typed date on a rung | that rung = typed date; the rungs after it keep their planned share of the duration (weight share, the same linear rule as the plan curve) |
| in progress, qty method | D + remaining qty ÷ rate, rate = qty done ÷ weeks since first recorded movement (robust to bulk entry) |
| in progress, otherwise | D + (1 − pct) × duration |
| any, push > 0 | at least PF + push |

A rung whose planned date has passed and has no typed date keeps its planned
slice of the duration, counted from D, and the activity is listed as needing a
date (C5) when it is on the path: optimistic, and said to be.

**Project**: finish = max FF; driving chain = walk back from that leaf through
its DRIVING predecessor: the one with the largest `FF(A) − max(PF(A), PS(B) −
1)`, followed while that value is ≥ −3 days (`MAX_GAP` in `lib/chains.ts`), so
an on-time planned overlap still reads as the path. Ties: latest in plan order.
Only CONFIRMED waitsFor links are used; suggestions never enter the sum.
Contract end = the last week. The weight gate still holds the card.

**Second opinion (Earned Schedule).** ES = fractional week at which the plan
curve equals the current actual; SPI(t) = ES / week; IEAC(t) = last week ÷
SPI(t). When it differs from the bottom-up finish by ≥ 2 weeks, the card
explains why from the By-section split: where the lead or lag sits, and whether
those activities lie on the driving chain.

**Confidence**: each step of the driving chain is labelled typed (vendor/site/
client), measured (qty rate, done) or assumed (plan), and the card counts them.

## The EPC profile (`lib/forecast-epc.ts`)

The only EPC-specific file. Phase order Engineering → Procurement →
Construction → Commissioning; rung names per kind (PO: po, purchase order;
Fabrication: fabrication, manufacturing; RTS: rts, ready to ship; On site:
shipment, delivery, arrival, on site); default waitsFor suggestions:
construction rows wait for the procurement rows whose last rung is On site;
commissioning rows wait for construction rows; within procurement, a row
holding later rungs waits for the sibling holding earlier rungs of the SAME
subject (name minus rung words: "Material Solar", "Consumable Retrofit").
Suggestions are shown for confirmation, never applied in silence.

## Checks the app runs (`lib/forecast-checks.ts`)

| # | Rule | Shown |
|---|---|---|
| C1 | Work kind disagrees with the WBS heading above it (`guessWorkKind` on the heading), or is empty where the heading names one | Data Overall strip + panel, with the suggested kind |
| C2 | Sibling rows of one kind each carry the whole ladder while their names name different rungs → suggest each holds only its own rungs | strip + panel |
| C3 | A typed percent differs from what its own ticked ladder gives | panel |
| C4 | A week adds ≥ 5 points after ≥ 3 weeks that added nothing (bulk entry) | card, confidence line |
| C5 | Unfinished activities on the driving chain with no typed date | strip "Forecast needs N dates", each one press away |

C1 and C2 change figures when accepted (2.1 goes 99% → 100%), so the panel
shows before → after and the user presses Save; carried across with
`applyProgressMethod`, never through it.

## Data Overall (ActivityPanel), in order

1. **Work kind?** (exists) + the C1/C2 suggestion when it applies.
2. **Rung ticks** (exist).
3. **New: next rung, when?** One date, prefilled with the rung's planned date,
   source Vendor / Site / Client. Left alone = plan. When that rung is ticked
   the question moves to the next. Qty rows are not asked (rate is measured);
   typed-percent rows are asked "finish when?".
4. **New: waits for.** Prefilled from the EPC profile, confirmed once.
5. **Result line**: "Forecast finish W63 · plan W63".

Above the map: one strip in the Weights-strip pattern listing C1, C2, C5.

## Dashboard, Summary, print

The Forecast card: week and date, against contract, the driving chain by name,
confidence count, the Earned Schedule sentence when it disagrees, and a link to
the Data Overall strip. `WeekAnalysis` and the printed `forecastSentence` read
the same result. The 4-week pace figure elsewhere stays as a display figure;
only the forecast stops using it.

## Storage

- `leaf_progress.forecast_date`, `forecast_source` ('vendor' | 'site' |
  'client' | 'plan'), `forecast_rung`: per week, so a vendor date slipping week
  after week is visible in the week log; read as the latest row ≤ week that
  carries one; 'plan' with no date = back to plan.
- `wbs_nodes.waits_for`: JSON array of node ids; dangling ids ignored on read.

Both are plain nullable columns: drizzle migration for local + `seed.db`
(then checkpoint), `EXPECTED_COLUMNS` in `lib/db-snapshot.ts` for the
deployment. Check the generated SQL is `ADD COLUMN`, not a table rebuild; copy
the database first and count child rows after. `lib/dashboard-db.ts` must map
the new columns and each leaf's planned dates into `Database` (the adapter has
dropped columns before).

## Proof

`scripts/verify-forecast.ts`, on a hand-built plan with Samberah's 11 leaves,
dates, weights and W38 progress:

- bottom-up finish W72, chain 2.4 → 2.5 → 3.3 → 4.1 (suggested links accepted)
- with no links confirmed (the deployment today): W72, set by 4.1
- ES ≈ 42.26, IEAC(t) W65, and the explanation names Engineering by Solar and
  Fabrication and RTS Material Solar as the off-path lead
- vendor date on 2.4 typed 4 weeks late → finish W76 through the chain
- a slip smaller than a planned gap moves nothing
- C1 flags 3.1, 3.3, 4.1 and suggests 2.2/2.4/2.5; C2 flags 2.1 → keep PO
  issued and 2.3 → keep On site; C3 flags 2.1 (99 vs 75); C4 finds W26 and
  W36; C5 lists 2.4, 2.5, 3.3, 4.1
- the old formula's W56 is gone and the card never goes blank at W40

Then `next build`, the deployment, and screenshots at 390px and desktop, with
the panel's new lines PRESSED and the card re-read after.

## Order of work

Two plans. **Plan A** (`docs/superpowers/plans/2026-09-27-forecast-epc-engine.md`):
engine + EPC profile + checks with the proof script, then the dashboard,
Summary and print switch to it (copy corrected, layout unchanged). **Plan B**,
written after the user picks from 2–3 rendered variants of the panel lines,
the strip and the card: storage, the write path, and the UI, because those
three change together.

## Not in this

Industry picker and the other energy sectors (remind the user when this
ships); Monte Carlo P50/P80; delays from daily reports; the pace figure
elsewhere; baseline versioning (board 18).

## Addendum, 27 Sep 2026: simpler to use, sharper figure

Asked for after seeing the first panel: "ditambah dikit aja biar forecastnya
tajam, tapi jangan ribet". Three changes, and nothing else.

1. **No earlier than plan without evidence.** A started activity with no
   typed date and no measured quantity rate finishes at
   `max(plan finish, status + remaining share × duration)`. A ticked rung is
   a step of fixed weight, not a pace: Samberah's 3.3 had "Material on site"
   ticked in W38 and read W41 against a plan of W59 to W62. Later stays
   automatic; earlier needs a date from the vendor, the site or the client,
   or a quantity rate. Project finish unchanged at W72.
2. **Links in one press.** The per-activity Confirm is gone. "Link" in the
   forecast strip over the map takes EPC order's offer for every activity
   nobody has answered (`unansweredLinks`). `waits_for` stores `[]` for
   "waits for nothing", so NULL means only "never asked" and a cleared row
   is not relinked.
3. **One card in the panel.** Finish (big), blue forecast over thin red plan
   on one scale, one sentence saying why (`ForecastReason`: done, typed,
   measured, pushed by a named late link, behind, plan), then the next
   stage's date and what it waits for, each late link carrying its own
   "N wk late". Proof: `scripts/verify-forecast.ts`.
