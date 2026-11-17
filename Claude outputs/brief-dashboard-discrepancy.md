# Brief — Dashboard headline disagrees with Data Overall / Weekly (Gundih)

**Type:** bug / trust-critical (the app's headline number is not internally consistent)
**Scope:** ONE issue. Diagnose the root cause, fix the smallest thing that makes the app show a single number per (project, week), stop. Do not roam into neighbouring board items.

---

## The symptom (Gundih / CPP, `legacy_json_id`, week 36 of 60)

Three screens, same project, same selected week, three-way disagreement — and it is a **two-vs-one split**:

| Screen | Actual | Plan (this week) |
|---|---|---|
| **Dashboard** (front page) | **68.20 %** | **72.57 %** (schedule index 0.940) |
| Data Overall → Update progress (wk 36) | 67.15 % | 71.93 % (deviation −4.78 %) |
| Weekly Progress → Report → Summary (wk 36) | 67.15 % | 71.93 % (Behind 4.78 %) |

**Data Overall and the Weekly Report AGREE (67.15 % / 71.93 %). The Dashboard is the outlier.** Both the actual AND the plan are shifted on the Dashboard, by about the same direction (+1.05 pts actual, +0.64 pts plan). That "both series shifted together" shape points at a **different week boundary / different week being read**, or a **different rollup path**, on the Dashboard only — not at a data-entry error.

---

## HARD CONSTRAINTS — read before touching anything

1. **Do NOT move Gundih's signed number.** Per `AGENTS.md` → *"Which store a project reads, and which one it writes"*: Gundih stays on `db.json` on purpose; the two stores differ by up to 12.85 pts week-by-week, and *"moving a signed report onto a different number is not a migration — it moves when board item 08 reconciles it deliberately."* **This task is NOT board item 08.** The goal is that the app presents **one consistent number per (project, week) from a single origin** — not to reconcile stores and not to change what Gundih's report prints.

2. **Single origin is law.** Per `AGENTS.md` → *"Progress has one origin"* and the `buildOverallMap` / dashboard "COMPUTES NOTHING" rule: every percentage must come from `lib/rollup.ts` (via `lib/progress.ts`). If the Dashboard and the weekly screens reach the number through **different functions, a different week, or a different carry-forward rule**, that difference IS the bug. The fix is to make them share one origin for a given (project, week), not to add a correction.

3. **One item, finish it, stop.** Per `AGENTS.md` → *"The user briefs by number… Do one item, finish it, stop."* Do not refactor the dashboard, do not touch board item 08, do not "tidy" adjacent code.

4. **Token discipline** (`AGENTS.md` final section): Grep/Glob to the exact spot, read only the line ranges you need, targeted patches, no full-file rewrites, no re-reading files you just edited.

---

## Diagnosis first — REPORT before you fix

Do NOT write a fix until you can state, in one paragraph, exactly why the two paths produce different numbers. Work it out from the code and the data, not by guessing.

### Read (targeted)
- `lib/data.ts` — `getOpenDb` / `getOpenWeekRollup` / `getOpenSCurveSeries`. Which of these feeds the **Dashboard**, and which feeds **Data Overall** and the **Weekly Report Summary**? Are they the same rollup for the same week?
- `lib/legacy-bridge.ts` — `jsonKeyFor()` / which store Gundih resolves to on each path (confirm the Dashboard and the weekly screens both land on `db.json` for a `legacyJsonId` project, or find that one of them does not).
- `lib/rollup.ts` — `computeGrandTotal` (the weekly grand total) vs whatever the Dashboard front page sums.
- `lib/dashboard-db.ts` — its **carry-forward** rule (a leaf with no row this week holds its last value) and how it picks `currentWeek` ("the last week anybody recorded anything"). Compare to how the weekly screens pick the selected week.
- Whichever component renders the Dashboard headline + S-curve endpoint, and the one behind Data Overall (`components/weekly/OverallMap.tsx` over `lib/overall-map.ts`) and the Weekly Summary.

### Prime hypotheses (rank + confirm/kill each against the Gundih data)
1. **Off-by-one / different week.** The Dashboard reports its **latest reported week** (`currentWeek`) or an S-curve endpoint, while the weekly screens report the **selected week 36**. If `currentWeek` ≠ 36 (e.g. a later partial week exists), the Dashboard is answering a different question with the same "Week 36" label. Both plan and actual shifting together is consistent with this. **Check first.**
2. **Carry-forward vs fall-to-zero.** `lib/dashboard-db.ts` carries a leaf forward; the `db.json` weekly read may let later-week leaves fall back to zero (this is exactly the store-divergence `AGENTS.md` describes). If the Dashboard and the weekly screens read Gundih through **different carry rules**, they will disagree even on the same week.
3. **Different plan-curve evaluation date.** Plan differs by 0.64 pts. `targetWF` reads each week row's own `endDate`; if the Dashboard evaluates the plan at a different week-end than the weekly screens, plan (and the derived deviation/SPI) drift. Cross-check with the `weekAnchorEndDate` = week-one's-end rule in `AGENTS.md`.
4. **Two rollup origins.** Confirm neither the Dashboard nor Data Overall re-derives a total locally instead of calling `lib/rollup.ts`.

### Use the tools the repo already has
- `scripts/verify-weekly-store.ts` — this already compares the stores week-by-week for Gundih; run it and read what it says about week 36 specifically.
- `/api/health/db` — confirm which file/store is actually being read on the running instance before theorising.
- To see the screens: `scripts/shoot.mjs <url> <out.png> [w] [h]` (the Browser pane never composites here, so `computer{screenshot}` fails — use the script and actually look at the PNG, desktop and 390px).

---

## Definition of done
- A one-paragraph root-cause statement: which path, which week/rule, why the numbers differ.
- The **Dashboard** and **Data Overall** and the **Weekly Report Summary** show the **same Actual and the same Plan for the same (project, week)** — reached by making them share one origin (fix the week selection / carry rule / rollup call), **not** by nudging a figure.
- Gundih's printed/`db.json` figures are unchanged (the signed report still prints what it printed). If the only way to align the screens would move Gundih's number, STOP and report that it needs board item 08 — do not do it here.
- No new second data path introduced.

## Verify (per repo conventions)
- Re-run `scripts/verify-weekly-store.ts` and confirm week 36 aligns between the paths you touched.
- `scripts/shoot.mjs` the Dashboard and Data Overall at desktop + 390px; confirm the headline numbers now match and nothing else moved.
- `next build` before pushing (write output to a file and echo `$?`; never verify a build through a pipe — see `AGENTS.md`). Both prior failures in related features were build-time-only.
- Work on branch `v2-foundation`; leave `main` untouched.

## Guardrail
If mid-diagnosis you find the disagreement is genuinely the db.json↔SQLite store divergence (board item 08) and not a presentation/week/rollup bug, **do not fix it** — write up what you found and hand it back. Changing a signed number is a deliberate, numbered decision, not a bug fix.
