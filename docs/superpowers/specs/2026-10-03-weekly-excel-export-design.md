# Weekly report: one Excel export

Decided 3 Oct 2026 in a brainstorm with the user. The ask: the weekly report leaves
the app as ONE Excel workbook that looks exactly like the supplied sample,
`E:\Pa Singgih\44. CPP Gundih...\6. Progress\Weekly Report\W45\contoh.xlsx`, with
every figure from the app, minus the company logos ("tergantung perusahaannya") and
minus the `Data Overall` sheet (the app has its own Data Overall). The person
exporting chooses which sheets go in: Detail Progress and S-Curve each come as
Overall and/or per work package.

## Decisions locked with the user

1. **"Save as PDF" is replaced by "Export Excel"** in the weekly report, in the same
   place (top right, variant A of three rendered), identical on Summary, Detail,
   S-Curve and Photos. The PDF route, print pages and button stay in the code,
   unlinked, as the daily PDF did.
2. **Pressing it opens a pop-up** (variant V2 of two rendered): Documentation and
   Summary Overall as two checkbox rows, then a small table with one row per work
   package (Overall first) and two checkboxes, Detail and S-Curve. EVERY sheet is
   optional. Everything is ticked when the pop-up opens, which reproduces the sample.
3. **Values, not formulas.** "Angka jadi aja, itu dari kita angkanya": every cell is
   the app's own figure. The sample's formulas all read `Data Overall`, which is not
   exported.
4. **Every photo of the week goes in, six to a page**, extra pages added as needed.
5. **Work packages are named as the project names them, never "SPK" by default.**
   The rows of the pop-up, the Summary rows and the per-package sheets are exactly
   the groups the Summary screen shows (`summariseUnits` in `lib/rollup.ts`): the
   flagged reporting units (Merbau: "SPK-001 Gas Processing Facility (GPF)" ...),
   else the `(SPK-###)` tag, else the plan's top branches (PHSS Samberah has no
   flagged unit).
6. **The LOOK is the sample's, the CONTENT is the app's.** "Yang kumaksud sama hanyalah tampilan, kalo isi kita kan sudah benar": print layout and Excel format (fonts, borders, fills, widths, number formats, page setup) follow `contoh.xlsx`; every figure, row, curve and photo is what the app's own screens show. Where the two differ, the app wins.
7. **Generator with the sample's skin** (approach 1 of three). Approach 2, patching
   the sample like the daily export, was rejected: the weekly workbook is not a
   fixed form (row count follows the WBS, sheet count follows the packages), its
   sheet names are baked into thousands of references, and it is 7.8 MB.
   Approach 3, ExcelJS from scratch, was rejected: ExcelJS cannot write a chart, so
   the S-curve would be a picture.

## What the sample holds (read from the package, not assumed)

16 sheets, 13 visible. Exported: `Documentation`, `Summary Overall`,
`S-Curve Overall`, `Detail Overall`, `Detail SPK002/003/004/007`,
`S-Curve SPK002/003/004/007`. Not exported: `Data Overall` (4.6 MB, the source
every formula reads), and the hidden `Summary SPK002`, `Cov4`, `Cov4 (2)`. The
package also carries 106 external links and a `calcChain`; none of that comes along.

| Sheet | Print area | Page | Content |
|---|---|---|---|
| Documentation | A1:J46 | A4 portrait, fit to page | Logo group rows 2-4, A7:J7 "Documentation", six pictures in a 2 x 3 grid (anchors cols 0-5 / 5-10, rows 8-20 / 20-34 / 34-47) |
| Summary Overall | A1:K22 | A4 landscape, 110% | A2 "WEEKLY REPORT NO.45", A3 project name upper case, A4 period, A6 "OVERALL PROGRESS SUMMARY", header rows 8-10, one row per package at 12/14/16/18 (spacer rows between, height 27.6), totals row 21 |
| S-Curve Overall | B1:P35 | A4 landscape, 83% | B1:P2 "PROGRESS S-CURVE OVERALL", G3 Weeks / H3, G4 Period / H4 "to" K4, line chart B6:P27, D28 / L28 companies, D33 / L33 signatories. The chart's numbers sit beside the print area (S2 "DATA MINGGUAN", week no, week start/end, plan, cum plan, actual, cum actual, deviation) |
| Detail Overall | A14:M300, titles $1:$13 | A4 landscape, 72%, footer "&P of &N" | A2 "DETAIL OVERALL PROGRESS", A6 CONTRACT NO, A7 PROJECT NAME, A8 CUSTOMER, H6/I6 WEEKLY NO, H7/I7 PERIODE, column header rows 11-13, WBS rows from 15, "Grand Total" last row |
| Detail SPKxxx | A14:M(last) | same as Detail Overall | A2 "DETAIL PROGRESS SPK.002/PPC60000/2025-SO", only that package's rows under the root row, weights as a share of the package (total 100%) |
| S-Curve SPKxxx | B1:P35 | A4 landscape, 88% | same as S-Curve Overall, title "PROGRESS S-CURVE SPK002" |

The chart (`chart1.xml`) is two line series, CUM. ACTUAL (blue `0070C0`) and CUM.
PLAN (red `FF0000`), categories = week end dates, a data table under the axis, and
a callout on each series at the reported week ("03-Sep-26; 83,20%"). The sample's
plan runs to the end of the project; the export follows the app instead (see S-Curve below). Headings and
package rows in Detail show only BOBOT; activities show every column.

## The pop-up

```
Export Excel
Week 30 · 22 Jul to 28 Jul 2026

Report
 [x] Documentation
 [x] Summary Overall

Work package                              Detail   S-Curve
 Overall                                    [x]      [x]
 SPK-001 Gas Processing Facility (GPF)      [x]      [x]
 SPK-002 Pipeline & Flowline                [x]      [x]
 ...
[ Export 12 sheets ]
```

- The button reads the count. Pressing it with nothing ticked turns the line under
  it red: "Choose at least one sheet first." Nothing is shown before it is pressed.
- A long name truncates with an ellipsis. Rows are at least 44 px high.
- It is a Radix `Dialog`, loaded through `next/dynamic` (the overlay rule).
- The selection is not remembered between exports.
- **Weight gate.** Only for a project whose weights do not close yet (a new one;
  Merbau closes at 100%, its six key milestones are exempt by design). While the weights do not close (`lib/weight-gate.ts`), the
  figure rows are unticked and cannot be ticked, with one line saying why and a
  link to Weights; Documentation can still be exported. This mirrors today's PDF
  button, which prints Photos while figures are held.

The button narrates like `SavePdfButton`: Export Excel → Preparing… →
Downloading N% → Saved!, or tap-to-retry. It warms the route when it appears.

## The workbook

**File name**: `<Document No (weekly)>_WEEKLY PROGRESS REPORT W<n> (Overall)_<ddmmyy>.xlsx`,
`ddmmyy` the week's last day. With no Document No: `WEEKLY PROGRESS REPORT W<n> (Overall)_<ddmmyy>.xlsx`.

**Sheet order** as the sample: Documentation, Summary Overall, S-Curve Overall,
Detail Overall, Detail per package (package order), S-Curve per package. Only the
ticked ones.

**Sheet names**: "Detail " / "S-Curve " + the package's label when it has one
(`unit_label`, e.g. "Detail SPK-001"), else its name ("Detail Engineering"). Cut to
Excel's 31 characters, made unique with " (2)", and `[]:*?/\` removed.

**Header fields**, from Project details and the plan. A field that is empty stays
empty; nothing is invented.

| Cell | Source |
|---|---|
| Week no, period | the week grid (`weekRowsFor`), period written "dd MMMM yyyy s/d dd MMMM yyyy" in English month names, as the sample |
| Project name | `projects.name`, upper case where the sample is upper case |
| CONTRACT NO (Detail Overall) | every package's `unit_contract_no`, joined ", "; else `projects.contract_no` |
| CONTRACT NO / title (Detail per package) | the package's `unit_contract_no`; with none, its name |
| PROJECT NAME (Detail per package) | the package's name, upper case |
| CUSTOMER | `projects.client_name` |
| Signatures (S-Curve) | `signature_left` (client, left) and `signature_right` (contractor, right) through `lib/signature.ts` |

The logo pictures are not written; their rows keep their heights, so nothing moves.

**Figures.** Read from the same rollup the screens read (`getOpenWeekRollup`,
`summariseUnits`, the S-curve series): `buildWeeklyExport` computes nothing of its
own. Percent cells are fractions with the sample's `0.00%` format (an Indonesian
Excel shows "7,07%"). The rules of `lib/figures.ts` hold: MINGGU INI and VARIANCE
are differences between rounded figures (`shownDiff`), and the package rows of
Summary are apportioned (`apportion`) so each WF column adds to its total.
Detail per package uses each activity's share of its package (`bobotInUnit`
scale), so its Grand Total equals the package's own progress on the Summary.
A package nested inside another appears only in its own sheet, as in the Summary.

**Rows.** Detail writes the whole WBS in planner order with the sample's indentation
(three spaces per depth, as typed in the sample). Activities measured by quantity
show their own VOL and SATUAN; every other activity shows "1" and "Ls".

**S-Curve.** The curve is the app's S-Curve screen (`buildSCurveSeries` cut at the
exported week, plan AND actual), not the sample's plan-to-the-end. Each S-Curve
sheet carries its own data block beside the print area (so a package sheet works
without the overall one), from week 0 at 0 to the exported week. The chart's series point at that
block and also carry cached values, so a phone preview draws it without
recalculating. The callouts sit on the exported week.

**Documentation.** The week's photos (`Database.weeklyPhotos`) in the order of the
Photos tab, six to a page, left then right, top to bottom, each fitted to its box
the way `lib/xlsx/daily-photos.ts` already does. Past six, the page (rows 1-46) is
repeated below itself with a page break, the title kept.

## Code

- `scripts/build-weekly-skin.ts` reads the sample once and writes
  `lib/xlsx/weekly-skin.ts`: `styles.xml`, the theme, and per sheet kind the column
  widths, row heights, header rows (with their style ids), page setup, print titles,
  the style id of each row kind (heading, package, activity, spacer, total) and the
  chart as a template. Pictures, `Data Overall`, external links, defined names and
  `calcChain` are dropped.
- `lib/xlsx/weekly-export.ts`: `buildWeeklyExport(input, selection)` returns the
  bytes. It writes each sheet's XML fresh with the skin's style ids, one drawing and
  chart per S-Curve sheet, the photos, `workbook.xml` (sheets, print areas, print
  titles), content types and relationships, zipped with JSZip.
- `lib/xlsx/weekly-input.ts`: gathers the input for one week of the OPEN project
  from the existing readers (rollup, summary, S-curve series, week grid, project
  identity, weekly photos). No new arithmetic.
- `app/api/xlsx/weekly/[week]/route.ts`: GET with the selection in the query,
  resolves the project from the user's own request (as the PDF route does), refuses
  the figure sheets while the weight gate is shut, answers with `Content-Length`
  and the file name; `?warm=1` answers 204 at once, which is how the button warms
  the function when it appears and when the tab comes back.
- `components/weekly/ExportExcelButton.tsx` and `ExportExcelDialog.tsx`; `WeekTabs`
  shows it where `SavePdfButton` was.

## Verification

- `scripts/verify-weekly-xlsx.ts`, on Merbau (four flagged packages) and PHSS
  Samberah (none flagged): the package is sound (every part referenced exists, every
  relationship resolves, content types complete); the sheets are exactly the
  selection, in order; read back with ExcelJS as an independent parser, every Summary
  and Detail figure equals the app's, each WF column adds to its printed total, each
  per-package Detail closes at 100%, and each S-curve block equals the series.
- Rendering: the export is opened read-only in a NEW hidden Excel instance
  (`cscript` late-bound, as `scripts/xlsx-to-pdf.vbs`), printed to PDF, rendered to
  PNG and laid beside the sample's own pages. The user's Excel windows and files
  are never touched; no `/automation` instance may be left behind.
- The real button pressed once in the running app: the pop-up opens, ticks change
  the count, an empty selection shows the error only on Export, the button walks
  Preparing → Saved! and the file lands. Screenshots at 390 px and desktop through
  `scripts/shoot.mjs`.
- `next build` to a file, exit code checked, before pushing.

## Out of scope

- Logos, per company (later: optional images in Project details, as daily slice 2b
  planned).
- Remembering the last selection.
- Importing a weekly workbook.
- The hidden per-package Summary sheet of the sample.

## Risks

- **Response size on Vercel** (about 4.5 MB). Photos are compressed on upload, but a
  week with many photos could pass it. Measured during the build; if it does, the
  photos are re-encoded smaller in the export.
- **The chart is the riskiest part to reproduce byte-faithfully.** It is the part
  checked by eye in Excel against the sample's page.
