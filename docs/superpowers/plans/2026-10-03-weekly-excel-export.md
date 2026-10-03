# Weekly Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One "Export Excel" button on the weekly report that writes a workbook in the exact look of `contoh.xlsx` (minus Data Overall and logos), filled with the app's own figures, with the sheets chosen in a pop-up per work package.

**Architecture:** A build script lifts the sample's skin (styles, theme, four sheet kinds, the S-curve chart) into a generated TS module. A pure gatherer turns one week of the open project into an export input using only the existing readers (rollup, `summariseUnits`, S-curve series, photos). A writer clones the skin sheets per selection, writes values (never formulas), one chart per S-Curve sheet and the photos, and zips it with JSZip. A route serves it; a dialog in `WeekTabs` replaces the PDF button.

**Tech Stack:** Next.js (this repo's version, see AGENTS.md), JSZip, ExcelJS (verification only), Radix Dialog via shadcn, `node --experimental-strip-types` scripts like the existing `scripts/verify-*.ts`.

**Spec:** `docs/superpowers/specs/2026-10-03-weekly-excel-export-design.md`

**A note on code in this plan.** The repo's token discipline (AGENTS.md) wins over pasting the whole implementation twice. Each task fixes the files, the exact interfaces, the data shapes and the assertions that prove the task; the implementation is written straight into the files.

## Global Constraints

- Look = `contoh.xlsx`; content = the app. Where they differ the app wins (spec decision 6).
- Every cell is a value. No formula is written anywhere in the export.
- Percent cells are fractions (`0.0707` for 7.07%) carrying the sample's own number formats.
- `shownDiff` for MINGGU INI and VARIANCE; `apportion` for the Summary's per-package WF columns so each adds to its printed total (`lib/figures.ts`).
- Work packages are exactly `summariseUnits(roots).rows` (units, else SPK tags, else top branches), named as written.
- Sheet names ≤ 31 chars, unique, without `[]:*?/\`.
- No logo picture, no `Data Overall`, no external link, no defined name other than print areas and print titles, no `calcChain`.
- App copy in English (dialog), sheet content in the sample's Indonesian.
- `/print/*` untouched; the PDF route stays, unlinked.
- The Dialog is loaded through `next/dynamic`; rows ≥ 44 px; validation shows only after Export is pressed.
- Weight gate: figure sheets refused (route) and locked (dialog) while `weightGate(items).ok` is false; Documentation stays available.

---

### Task 1: Data plumbing the export needs

**Files:**
- Modify: `lib/types.ts` (WbsItem), `lib/dashboard-db.ts` (map `unit_contract_no`)
- Modify: `lib/rollup.ts` (SummaryRow gains `key`; new `packageOfNodes`)
- Modify: `lib/scurve.ts` (new `buildPackageSCurves`)

**Interfaces (produces):**
```ts
// lib/types.ts, WbsItem
unitContractNo?: string | null;

// lib/rollup.ts
export interface SummaryRow { key: string; /* the anchor's key: node id for unit/branch, the "(SPK-###)" tag for spk */ ... }
/** node id -> key of the package the node is credited to (nearest anchor, itself included); nodes above every anchor are absent. */
export function packageOfNodes(roots: RollupNode[]): Map<string, string>;

// lib/scurve.ts
/** Per package key, the same rows buildSCurveSeries gives the project: planPct = targetWF / bobot * 100, actualPct = curProgressPct, null after currentWeek. */
export function buildPackageSCurves(db: Database, upToWeek: number): Map<string, SCurveRow[]>;
```

- [ ] Step 1: add the field and its mapping (`unitContractNo: n.unitContractNo` beside `unitLabel` in `dashboard-db.ts`).
- [ ] Step 2: add `key` to the `Group` and to each row in `summariseUnits`; export `packageOfNodes` built on the same `summaryAnchors` so anchor logic stays in one place.
- [ ] Step 3: `buildPackageSCurves` loops the same weeks and rollups as `buildSCurveSeries` and reads `summariseUnits` per week.
- [ ] Step 4: covered by Task 2's verify script (it asserts these against the screens' figures). Run `npx tsc -p tsconfig.verify.json` (or the repo's filtered tsconfig, see memory "verification quirks").
- [ ] Step 5: commit `Weekly export plumbing: unit contract no reaches WbsItem, summary rows carry their package key, per-package S-curves`.

### Task 2: The gatherer

**Files:**
- Create: `lib/xlsx/weekly-input.ts`
- Create: `scripts/verify-weekly-xlsx.ts` (first half: input assertions)

**Interfaces (produces):**
```ts
export type PercentRow = {
  bobot: number;                 // fraction
  prevProgress: number; prevWF: number;
  thisProgress: number; thisWF: number;
  curProgress: number; curWF: number;
  target: number; variance: number;
};
export interface DetailLine {
  kind: 'root' | 'heading' | 'package' | 'activity';
  wbs: string; text: string;     // text already indented 3 spaces per depth
  vol: number | null; satuan: string | null;
  figures: PercentRow | null;    // activities only; headings/packages carry bobot only
  bobot: number | null;
}
export interface WeeklyPackage { key: string; label: string; code: string | null; contractNo: string | null; sheetSuffix: string }
export interface WeeklyExportInput {
  week: number; periodText: string; periodEnd: string;  // "22 July 2026 s/d 28 July 2026", ISO end
  project: { name: string; contractNo: string; customer: string; documentNoWeekly: string;
             signatureLeft: { company: string; name: string }; signatureRight: { company: string; name: string } };
  packages: WeeklyPackage[];
  summary: { rows: Array<{ no: number; text: string } & PercentRow>; total: PercentRow };
  detail: { overall: { lines: DetailLine[]; total: PercentRow }; byPackage: Map<string, { lines: DetailLine[]; total: PercentRow }> };
  scurve: { overall: SCurveRow[]; byPackage: Map<string, SCurveRow[]>; weekEnds: string[] /* ISO, index = week, 0 = start */ };
  photos: string[];              // stored photo paths, slot order, empties removed
}
export interface WeeklySelection { documentation: boolean; summary: boolean; detail: string[]; scurve: string[] } // 'overall' or package keys
export function gatherWeeklyExport(db: Database, json: Database, week: number): WeeklyExportInput;
export function parseSelection(q: URLSearchParams): WeeklySelection;   // ?doc=1&sum=1&det=overall,<key>&sc=...
export function selectionQuery(s: WeeklySelection): string;
export function sheetSuffix(label: string, code: string | null, taken: Set<string>): string;
```

Rules inside: Summary text = `label` upper case; per-package WF columns apportioned to the grand total; package Detail divides bobot and WF by the package bobot, omits nodes credited to another package, heading bobot = sum of included leaves; activities with `hasRealQuantity` show their own vol/satuan else `1`/`Ls`.

- [ ] Step 1: write `scripts/verify-weekly-xlsx.ts` part 1 for Merbau and PHSS Samberah (read `data/report.db` through `copyDbFixture`): summary rows equal `summariseUnits` rounded; each WF column of `summary.rows` sums to `summary.total` at 2 decimals; `detail.overall.total` equals `computeGrandTotal`; every `byPackage` total bobot = 1 and its `curProgress` = that package's Summary `curProgressPct / 100` at 2 decimals; `scurve.overall` equals `buildSCurveSeries(db, week)`; `sheetSuffix` caps at 31 and de-duplicates; `parseSelection(selectionQuery(s))` round-trips.
- [ ] Step 2: run it, see it fail (module missing).
- [ ] Step 3: implement `weekly-input.ts`.
- [ ] Step 4: run it, all PASS on both projects.
- [ ] Step 5: commit.

### Task 3: The skin

**Files:**
- Create: `scripts/build-weekly-skin.ts` (arg: path to `contoh.xlsx`)
- Create (generated): `lib/xlsx/weekly-skin.ts` (`export const WEEKLY_SKIN_B64 = [...].join('')`, as `daily-template.ts`)

The skin zip holds: `xl/styles.xml`, `xl/theme/theme1.xml`, `skin/documentation.xml`, `skin/summary.xml`, `skin/scurve.xml`, `skin/detail.xml` (the four sheet XMLs with shared strings converted to inline strings, `<drawing>`/`<legacyDrawing>`/`r:id` on `pageSetup` removed, Summary trimmed to A1:K22, S-Curve trimmed to B1:P35 (data block regenerated), Detail trimmed to rows 1-15 plus one sample row of each kind), `skin/chart.xml` (chart1 with its series refs and caches left as markers), and `skin/map.json`: the style id per cell for each row kind (detail: root/heading/package/activity/total; summary: data/spacer/total), the row heights, the print setup per kind, and the photo anchor grid.

- [ ] Step 1: write the script; it prints what it dropped (pictures, sheets, external links, names) and the byte size.
- [ ] Step 2: run it against `E:\Pa Singgih\...\W45\contoh.xlsx` (read-only; copy to scratch first).
- [ ] Step 3: verify part 2: the skin unzips, has the four sheets, `styles.xml`, the chart, and no `<pic>`, no `externalLink`, no `definedName`.
- [ ] Step 4: commit script + generated module.

### Task 4: Writer: Summary and Detail

**Files:**
- Create: `lib/xlsx/weekly-export.ts` (`buildWeeklyWorkbook(input, selection, photoBytes): Promise<{ bytes: Buffer; fileName: string; sheets: string[] }>`)
- Create: `lib/xlsx/weekly-sheets.ts` (one writer per sheet kind; returns sheet XML + its parts)

Workbook parts written from scratch: `[Content_Types].xml`, `_rels/.rels`, `docProps/app.xml`, `docProps/core.xml`, `xl/workbook.xml` (sheets in spec order, print areas and print titles as defined names), `xl/_rels/workbook.xml.rels`, `xl/styles.xml` and theme from the skin.

- [ ] Step 1: verify part 3: build with everything selected for Merbau; read back with ExcelJS; sheet names in order; Summary A2/A3/A4 and every data cell equal the input; Detail Overall row count = lines + header; every Detail value equals its line; Grand Total equals `detail.overall.total`; per-package Detail sheets present and closing at 100%; no cell has a formula.
- [ ] Step 2: run, fail.
- [ ] Step 3: implement.
- [ ] Step 4: run, pass; also on PHSS Samberah.
- [ ] Step 5: commit.

### Task 5: S-Curve sheets with a real chart

**Files:**
- Modify: `lib/xlsx/weekly-sheets.ts` (S-Curve writer), `lib/xlsx/weekly-export.ts` (drawing + chart parts per sheet)

Each S-Curve sheet: title, Weeks, Period, signatures, its own data block beside the print area (week no, week end date, cum plan, cum actual, from week 0 at 0 to the exported week); `xl/drawings/drawingN.xml` with one graphicFrame anchored as the sample; `xl/charts/chartN.xml` from the skin with refs re-pointed to this sheet and `numCache`/`strCache` filled; callouts on the exported week.

- [ ] Step 1: verify part 4: every chart part exists and is related; each series ref names its own sheet; caches equal `scurve.overall` / `byPackage` at the exported week; categories are the week end dates.
- [ ] Step 2: fail. Step 3: implement. Step 4: pass.
- [ ] Step 5: render in a NEW hidden Excel (`cscript` like `scripts/xlsx-to-pdf.vbs`, export only, read-only), PDF to PNG with `scripts/pdf-to-png.ps1`, compare the S-Curve and Summary/Detail pages with the sample's pages 8, 10, 33 by eye; check no `/automation` Excel is left (`Win32_Process`).
- [ ] Step 6: commit.

### Task 6: Documentation with every photo

**Files:**
- Modify: `lib/xlsx/daily-photos.ts` (export the box-fitting helpers if not already: `imageInfo`, `coverCrop`), `lib/xlsx/weekly-sheets.ts`, `lib/xlsx/weekly-export.ts`

Six boxes per page at the sample's anchors; past six, the page block (rows 1-46) repeated below with a row break; print area grows; media + drawing + rels per photo.

- [ ] Step 1: verify part 5: with 8 fake JPEGs the sheet has 8 pictures, 2 pages, a row break at 46, print area to row 92.
- [ ] Step 2: fail. Step 3: implement. Step 4: pass.
- [ ] Step 5: Excel render of the Documentation pages, by eye.
- [ ] Step 6: commit.

### Task 7: The route

**Files:**
- Create: `app/api/xlsx/weekly/[week]/route.ts`

GET, `?warm=1` → 204; resolves the open project from the request (`getOpenDb`, `getOpenJsonDb`), refuses figure sheets while the gate is shut (400 with the reason), loads photos with `readUploadedPhoto`, answers `Content-Type` xlsx, `Content-Disposition` with the spec's file name, `Content-Length`, `Cache-Control: no-store`.

- [ ] Step 1: run the dev server (`preview_start`), curl with the full selection and with `?doc=1` only; check status, headers, that the bytes unzip and the sheet list matches.
- [ ] Step 2: commit.

### Task 8: Button and pop-up

**Files:**
- Create: `components/weekly/ExportExcelButton.tsx` (opens the dialog, warms `?warm=1` on mount and on visibility)
- Create: `components/weekly/ExportExcelDialog.tsx` (V2 layout; loaded through `next/dynamic`)
- Modify: `components/weekly/WeekTabs.tsx` (props `exportPackages: { key: string; label: string; code: string | null }[]`, `documentNoWeekly: string`; the button where `SavePdfButton` was, on the four report tabs)
- Modify: `app/weekly/[week]/layout.tsx` (`WeeklyTabsFor` passes the packages from `summariseUnits(rollup.roots)` and the doc no)

The dialog's Export is `SavePdfButton` with `url={/api/xlsx/weekly/${week}?${selectionQuery(sel)}}`, `label={Export ${n} sheets}`, `noun="Excel"`, `mime="spreadsheet"`, `warm={false}`, `labelAlways`, and `beforeDownload` returning false with the inline error when `n === 0`.

- [ ] Step 1: press it in the running app (Merbau, week 30): the dialog opens, unticking changes the count, unticking all then Export shows "Choose at least one sheet first." and nothing downloads, Export walks Preparing → Saved! and the file lands (CDP `Browser.setDownloadBehavior { behavior: 'allow' }`).
- [ ] Step 2: screenshots with `scripts/shoot.mjs` at 390 px and desktop, looked at.
- [ ] Step 3: commit.

### Task 9: Rules, build, ship

**Files:**
- Modify: `AGENTS.md` (a "The weekly report leaves as one Excel workbook" section: look vs content, values only, skin regeneration, package naming, the gate)

- [ ] Step 1: `npx next build > build.log 2>&1; echo $?` must print 0.
- [ ] Step 2: commit, push, wait for the deployment, open the deployed weekly page and press Export once.
