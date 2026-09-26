# Dashboard that tells the truth about the week — design

26 Sep 2026. Decided with the user in one session, from a breakdown of every
card on the dashboard against week 36 of the deployed project (RTC, PHSS
Semberah). Preview approved as rendered mockups (desktop + 390px).

## What was wrong

The same week read two ways. `computeGrandTotal` returns ACTUAL divided by the
total weight but PLAN and VARIANCE in raw project points. While weights closed
at 100 the two agreed; the deployed project's weights total 70.79%, and:

| Screen | Actual | Plan | Deviation |
|---|---|---|---|
| Dashboard hero, Detail | 51.09 | 34.98 | +16.11 |
| Dashboard chart, Data Overall, Summary, header chip, sidebar card | 51.09 | 24.76 | 11.40 |

On Data Overall 51.09 − 24.76 is not 11.40. Five smaller defects rode along: a
finished item listed as a laggard at −0.00%, "+-15.57%" / "−6.0×" in the look
ahead when ahead, "the plan demands" naming a figure that is not the plan's,
By section summing to 70.79 instead of 100, and money priced against the typed
contract value while every weight is measured against the project budget.

## Decisions

1. **No figure until the weights close.** Every progress figure (dashboard,
   Summary, Detail, S-Curve, Data Overall totals, PDF, sidebar card, header
   chip) waits until BOTH hold: leaf weights total 100% (±0.01, the same test
   `validateWeek` already used) AND no non-milestone leaf weighs 0. In their
   place: the total so far, the activities without a budget, one press to
   Weights. Filling in progress stays open — site facts are not held hostage
   to office work, and every figure appears from them the moment weights close.
   This REVERSES the 24 Sep rule that showed figures against whatever the
   budgets reached. No exemption for locked BOQ projects: Gundih, the only
   one, is being removed.
2. **One formula.** Plan and deviation are percent of the total weight, like
   actual. `GrandTotal.planPct` / `deviationPct`; section and item shares are
   divided by the total weight too.
3. **A figure you can recompute on screen must recompute.** Differences are
   taken between the ROUNDED figures shown (`lib/figures.ts`): deviation =
   shown actual − shown plan, SPI = shown actual ÷ shown plan, added this week
   = shown actual − last week's shown actual. Parts that add up to a shown
   total are apportioned by largest remainder, so By section, the lead's
   contributors, Work spread and What moved sum exactly to the figure they
   explain.
4. **Money is priced against the project budget**, the denominator of every
   weight, not the typed contract value (which is only compared with it).
5. **The dashboard tells the week.** Work spread carries a Week N block: added
   this week against plan added, lead change (last week → this week), and what
   moved (up to three, by contribution, with status before → after; backwards
   in red; "N more" to Data Overall). Legend rows say "+1 this week".
6. **Plan is a bar, not a tick.** Everywhere a red tick marked plan on a blue
   bar (dashboard lists, sidebar card, Data Overall, Summary PlanBar, week
   log), plan becomes a thin red bar under the blue one on the same scale.
   A plan of 0% had drawn a tick glued to the bar's start that read as a stray
   mark.
7. **Smaller fixes.** Why the project sits here: variance below −0.005 only;
   when nothing is behind it names what carries the lead. Look ahead: "Reached
   · already X past it". Velocity line: "Finishing by week N needs X% per
   week". Forecast gets a week-1 → now → forecast → contract-end track. What is
   urgent says "Ready to issue" when only warnings remain.
