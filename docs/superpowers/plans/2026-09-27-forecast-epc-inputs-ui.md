# Forecast EPC inputs and screens (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let people give the forecast the two things only they know (the next date from a vendor, the site or the client; what waits for what), and show the forecast and the app's own checks where people work: Data Overall and the dashboard card.

**Architecture:** Five nullable columns on `wbs_nodes`, read by `lib/dashboard-db.ts` into `WbsItem.forecast` / `WbsItem.waitsFor`, written by two actions. A server-built, serialisable `ForecastView` (`lib/forecast-view.ts`) feeds a strip in `OverallMap` (the reminder-list pattern already there) and a `ForecastBlock` inside `ActivityPanel`. The dashboard card names the path and the Earned Schedule reason.

**Spec:** `docs/superpowers/specs/2026-09-27-forecast-epc-design.md` (Plan A: `2026-09-27-forecast-epc-engine.md`, shipped).

## Decisions made while reading the code (27 Sep 2026)

1. **The typed date lives on the ACTIVITY, not on the week's progress row.** A `leaf_progress` row is the app's record that somebody answered that week (`buildWorklist` reads it); writing one to hold a vendor date would mark the activity "filled in" when nobody checked its progress. So `wbs_nodes` carries `forecast_date`, `forecast_source`, `forecast_rung`, `forecast_week` (the week it was given in; the engine ignores it for earlier weeks) and `waits_for` (JSON ids). The history of a slipping vendor date is not kept yet; that needs a table, which is a deployment question.
2. **C1 is fixable from the panel, C2 and C3 are shown, not auto-fixed.** C1 ("Use Construction") goes through the existing `pickKind` / `setWorkKindAction` path and the panel shows the figure before and after first (`changeFor`). C2's fix (a row keeping only its own rungs) would restate past weeks through `applyProgressMethod`: on 2.1 it would turn the typed 99% into 0% for weeks 37 and 38. Until a history-safe restatement exists, C2 and C3 are explained, not applied.
3. No new screen. The strip copies `ReminderLens` / `ReminderList`; the panel block copies `FactTile`'s surface and the "Change" pill.

## Global Constraints

- Only confirmed `waitsFor` links enter the forecast; suggestions are shown, labelled, and confirmed by a press.
- Nothing changes without a press, and the panel's one Save at the foot is not repurposed: the forecast rows have their own Save / Cancel, like a budget.
- English copy, no em dash in visible strings, touch targets ≥ 44px, native inputs inside lists.
- New columns: drizzle migration (checked to be `ADD COLUMN`), local `data/report.db` backed up and child rows counted, `data/seed.db` migrated and checkpointed, `EXPECTED_COLUMNS` in `lib/db-snapshot.ts`.
- Pressing tests run LOCALLY; the deployment is only read and screenshotted (it holds the user's real project).

## Tasks

### Task 1: Columns
- Modify `lib/schema.ts` (`wbsNodes`: `forecastDate`, `forecastSource`, `forecastRung`, `forecastWeek`, `waitsFor`), generate `data/migrations/0014_*.sql`, migrate local + seed, append five lines to `EXPECTED_COLUMNS`.
- Verify: `pragma table_info(wbs_nodes)` shows the five on both files; child-row counts unchanged.

### Task 2: Read and write
- `lib/types.ts`: `WbsItem.forecast?: { date; source; rungId; week }`; drop `LeafSnapshot.forecast`.
- `lib/dashboard-db.ts`: map the columns (JSON-parse `waits_for`, ignore malformed).
- `lib/forecast-read.ts`: typed = `item.forecast` when `item.forecast.week <= week`.
- `lib/progress-sqlite.ts`: `setLeafForecastSqlite(projectId, nodeId, value | null, week)`, `setWaitsForSqlite(projectId, nodeId, ids)`; both refuse ids outside the project, non-leaves and self-links.
- `lib/actions.ts`: `setLeafForecastAction`, `setWaitsForAction` through `sqliteWrite`.
- Verify: `scripts/verify-forecast.ts` (fixture moves to `item.forecast`, plus an earlier week ignores a date given later) and `scripts/verify-forecast-store.ts` (fixture copy of `data/report.db`: write both, read back through `buildProjectDashboardData`, refuse a foreign id).

### Task 3: The view
- `lib/forecast-view.ts`: `buildForecastView(db, week)` → `{ finishWeek, finishDate, lastWeek, path, toCheck, leaves, options, bulkWeeks }`, each leaf with finish / plan finish (date + week), basis, source, on-path, next rung (label + planned date from the linear rule), typed, confirmed and suggested links, and its issues (C1 with the ladder, shape and after-figure; C2 keep list; C3 typed vs ladder).
- Verify: on the Samberah fixture, the strip lists 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.3, 4.1 with their reasons; 2.4's next question is its finish (lumpsum), 2.3's is "On site"; 3.1's C1 fix shows 50.0% → 15.0%.

### Task 4: Data Overall
- `app/weekly/[week]/overall/page.tsx`: build the view when `gate.ok`, pass `forecast` to `OverallMap`.
- `components/weekly/OverallMap.tsx`: `ForecastStrip` in the header under the reminders (finish week against contract, the activity that sets it, "N to check" opening the list, each line "Open ›" into the panel); hand the leaf's view and the options to the panel.
- `components/weekly/ForecastBlock.tsx` in `ActivityPanel` after `FinishNotice`: issue notices (C1 with "Use X" and the figure after; C2, C3 explained), "Forecast finish W · plan W", the next date (DateField + Vendor / Site / Client + Save / Cancel; "Back to plan" when one is set), waits for (confirmed list or the suggestion with Confirm; Change opens native checkboxes).

### Task 5: Dashboard card
- `app/page.tsx`: under the badge, "Set by <activity>" (and "through …" for a longer path), the Earned Schedule line when it disagrees, and "N dates to add in Data Overall ›" when the path runs on plan dates.

### Task 6: Prove it
- Proof scripts, type-check, `next build` (exit code to a file).
- Local dev server on the local project: press every new control (set a date, back to plan, confirm links, change links, use a kind) and read the state before and after; screenshots desktop + 390px.
- Push, wait for the deployment, read-only screenshots of Data Overall W38 (strip open, one panel open) and the dashboard card, desktop + 390px.
