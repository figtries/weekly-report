# Weights: budget is the only input

Agreed 24 Sep 2026, in chat, one decision at a time. Replaces the 14 Sep rule
"a row is set by its PRICE or by its SHARE" (AGENTS.md, Setup, weights).

## Why

The Weights screen had a % / IDR toggle on every row. The % in the box was a
share of the row's PARENT; the % on the right ("Weight here") was a share of
the whole SPK. Two different percents on one row, and the toggle read as
unexplained. Rows nobody had touched also carried an even share of whatever
was left, which the user read as "something is filled in that nobody filled".

## The rules

1. **One input: the budget, in money.** The toggle goes. The screen never
   writes `workstep_factor` again; the `percent` field leaves
   `updateRowTextAction`.
2. **The percent on the right is `budget / base x 100`**, where the base is the
   row's POOL: its nearest ancestor with a budget of its own, or the contract.
   A reporting unit carrying its own contract always draws on the contract
   (SPK-007 inside 1.4). Labelled "of 5.2" / "of contract".
3. **That percent can be typed.** It is converted to money
   (`round(pct / 100 x base)`, whole units, because the app never shows a
   fraction of one) and the MONEY is saved. Change a budget and the percent
   moves with it.
4. **No budget = 0%.** A leaf nobody budgeted weighs nothing. A heading with no
   budget of its own is the sum of its rows. There is no even share anywhere,
   including a project with no budgets at all: every leaf is 0 and the report
   has no plan until budgets exist. That consequence is the user's, and the
   screen reminds instead of guessing.
5. **The cap is refused, in both directions.**
   - The budgets drawing on a pool may not exceed it (contract included, when
     a signed contract value exists).
   - A pool may not be lowered below what already draws on it; the same for
     the contract value in Project details.
   - The refusal names the figure: "Only IDR 20 000 is left in 5.2".
   - An edit that does not make an existing overrun WORSE is allowed, so
     Gundih's inherited 140% headings stay editable.
   - Enforced in `updateRowTextAction` (Weights, Data Overall's activity
     panel, the planner) and `updateProjectFieldAction`. Paste-from-Excel and
     structural moves are bulk operations and are not blocked; the card
     reports "over by X".
6. **Report weight is `leaf budget / contract x 100`**, leaves only.

## Existing data

- A stored `workstep_factor` (Gundih's IFR / IFA / AFC, RTC's Engineering rows)
  is still READ as a budget: `parent's own budget x factor`. Nothing is
  migrated; the row shows the money, and the first edit saves a price and
  clears the factor.
- Gundih is locked (`weight_basis = 'boq'`): its stored weights and db.json
  reports do not move. Its Weights screen follows the new derivation.
- Unlocked projects' stored `bobot` is re-synced once after a deploy restores
  the snapshot (`pragma user_version`), so the reports follow the new rule
  without waiting for the next edit.

## Screen

- Row: money box (IDR prefix, placeholder "Budget"), percent box (% suffix,
  a thin bar under it for the same share), one caption: "of 5.2 · 0.80% of
  project"; a heading without its own budget adds "rows take IDR X".
- A refused edit is reverted and the reason is said ON THE ROW, not only at
  the top of the page. The same check runs live while typing.
- Card pills: "N of M activities budgeted", "IDR X left", "Over by X",
  "Fully shared out". "Rows state N%" goes.
- Hero: under 100% is a reminder (warn), naming the activities with no budget
  as pressable rows. Over 100% stays red (only inherited data can get there).

## Verified by

`scripts/verify-weights.ts` and `scripts/verify-weights-screen.ts` rewritten
for the rules above; pressing the real screen on a fixture copy (type a
budget, type a percent, exceed the pool, lower a heading); screenshots at
desktop and 390px; `next build`; deployment Ready.
