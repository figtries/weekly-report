# Daily report: Excel export (slice 2a of 3)

Decided 30 Sep 2026, after slice 1 (`2026-09-30-daily-report-screen-design.md`) shipped.
The user's ask: the daily report leaves as the client's own workbook,
`PRGG-00-G0-RPT-003_DAILY PROGRESS REPORT`, **exactly**, and not as a PDF. Slice 2a
writes the text, numbers, formulas and weather checkboxes. Slice 2b (pictures) and
slice 3 (import) follow.

## What the 360 real workbooks showed (measured, not assumed)

The whole folder (November to July, 360 workbooks) was scanned straight from the
zips. It decides most of this design.

- **One layout.** 348 of 360 share `A1:U147`, the page break at row 66 and the
  section headers at rows 14/22/30/41/46/67. Nobody has ever inserted a row.
  Usage peaks exactly at capacity (8 activities a side, 3 crew rows, 3 AOC rows),
  so the sheet is used as a fixed-capacity form.
- **Weather is never filled.** All 348 carry identical weather cells (Cerah/Terang
  06:00 to 18:00, every other condition zero, all four checkboxes unchecked).
- **"Hari ke-" (S4) is dead.** It holds the constant 44236 (shown as 09/02/2021) in
  every file.
- **Merged cells in the activity rows are edited by hand every day** (C32:I32,
  C33:H33, C34:G34 ...), so they are not part of the standard. The template
  normalises them to full width.
- **The package is 111 external links and 5,533 dead defined names**, plus 4 form
  controls (the weather checkboxes) and a legacy VML drawing.
- **ExcelJS cannot be the writer.** Read then write of the sample lost the 4
  checkboxes (4 to 0), the VML drawing and the printer settings, and turned 5,533
  defined names into 486. That is not "exact".
- **The template's HSE cumulative formula is wrong.** `R24 = P24+N24` adds column N
  (blank) instead of O (Previous), so the sheet's cumulative equals today only.

## Approach

The sample, cleaned of one day's data, is the template. Export **patches the
template's XML directly** (JSZip), so everything that is not written to stays
byte-identical: merges, styles, column widths, conditional formats, page setup,
row break, checkboxes. Pure string patching of `sheet1.xml` with a small
parser that keeps every attribute and every byte it does not touch.

- New modules: `lib/xlsx/addr.ts` (A1 addresses), `lib/xlsx/sheet-xml.ts` (the
  patcher), `lib/xlsx/daily-template.ts` (generated, base64 of the template),
  `lib/xlsx/daily-fill.ts` (report to cells), `lib/xlsx/daily-export.ts` (compose).
  `scripts/build-daily-template.ts` makes the template from a sample workbook.
- Text is written as inline strings (the shared string table is untouched).
- Formulas stay formulas. Every formula cell also gets its computed cached value,
  because phone previews do not recalculate and would show the sample's numbers.
- Phase 1 keeps the 111 links and the dead names in the package. Without Excel on
  the development machine a trimmed package cannot be proven to open cleanly, so the
  export opens with the same "update links" prompt the client's files already do.
  Trimming is a follow-up once the first file is confirmed to open.
- The template carries no pictures. Logos, signatures and photos are slice 2b.

## Cell map

Capacities and cells were read from the sample; row numbers are the sheet's.

| Block | Cells | Rows |
|---|---|---|
| Title | `F2` (merged F2:O3) = "DAILY REPORT " + project name | |
| Date | `E4` = Excel date serial | |
| Hari ke- | `S4` = day of the project (below) | |
| Contractor / Contract / Location | `E5` / `E6` / `E7` | |
| Client / Document no. | `N5` = ": " + customer, `N6` = ": " + daily document no. | |
| Weather | row 13: Hujan Deras `I13:J13` + `K13`, Sedang `L13` + `M13`, Berawan `N13` + `O13`, Cerah `P13:Q13` + `R13:S13`; checkboxes ctrlProp1..4 = Sedang, Deras, Cerah, Berawan | |
| Crew | `B` no., `C` company, `E` POB, `F` previous, `G` today (formula `E*hoursEach`), `H` total (`F+G`) | 17 to 19 (row 20 is a 4.5 pt spacer); totals row 21 |
| Non Effective | `C` cause, `E` previous, `F` today (`G-E`), `G` cumulative, `H` remark | 24 to 28; totals row 29 |
| PTW | `K` no., `L` description, `N` type, `O` PWT no., `P` PA, `Q` issued, `R` validity, `S` status | 16 to 19 |
| HSE | `K` no., `L` activity, `O` previous, `P` today, `R` cumulative | 24 to 29 |
| Activities | today `B` no. + `C` text, tomorrow `L` no. + `M` text | 32 to 39 |
| AOC / AFH | `C` type, `E` description, `P` date, `Q` action by, `S` status | 43 to 45 |
| Progress | `D50` date, `D51` plan, `D52` actual (fractions), `D53` = `D52-D51` | |
| Signatures | left "Dibuat Oleh": `C60` company, `C65` name; right "Disetujui Oleh": `N60`, `N65` | |

Sides: the project stores the CLIENT on the left and the contractor on the right (the
weekly report's convention). The daily sheet is the other way round ("Dibuat Oleh",
made by, is the contractor), so the daily left block reads `signatureRight` and the
daily right block reads `signatureLeft`.

## Rules

- **Today's activities** are the ticked items only (an unticked plan is not a
  fact); tomorrow's are all of them.
- **More than the sheet holds** (decided by the user): the app warns while filling
  ("Excel holds 8 lines"), and the sheet shows the first N. The last visible line
  reads "+N lagi (lihat app)". Numeric tables (crew, non effective, HSE) fold the
  overflow into their last row as "Lainnya (N)" with the summed figures, so the
  sheet's totals stay right. Nothing is lost in the app.
- **Row heights grow with the text.** The sheet's row heights are set by hand to fit
  the wrapped text (row 16 is 79.8 pt for a long PTW description), so the export
  raises a row's height to fit what it writes (never below the template's), from the
  merged width and the wrapped line count.
- **Weather** (decided): a condition picked in the app writes the day's start and
  end time into its slot and ticks its checkbox; every other slot keeps the
  template's zeros.
- **HSE cumulative** is written as Previous + Today (the shared formula's master
  is corrected to `O24+P24`), not the template's broken one.
- **Progress** is the weekly figure (slice 1's `dailyProgressFor`); while the
  weights do not close the three cells stay empty.
- **Crew hours** write the formula `E*hoursEach` when the row has hours each, else
  the typed number.

## Hari ke- and weeks (the user's answer, read)

"Diisi per tanggal, dan di luar sheet diurutkan per minggu, jadi ini week ke berapa."
Read as: `S4` is computed from the date and nobody types it (the day of the project
counting from week 1's first day), and outside the sheet the daily reports are
grouped by week. So: the hero's "Day no." field becomes a read-only "Week 40 · Day
33", and the daily list groups its rows under week headings ("Week 40, 28 Sep to
4 Oct"). The stored `hariKe` stops being read (the old PDF still prints it).

## Delivery

`GET /api/xlsx/daily/[date]` builds the file from the open project's record, the
weekly figures and the project details, and streams it with `Content-Length` and
`Content-Disposition`. The hero's "Save as PDF" becomes "Export Excel" with the
same walk (Preparing, Downloading N%, Saved). The old daily PDF route, print page
and component are left in place, unlinked.

## Proof (no Excel or LibreOffice on this machine)

`scripts/verify-daily-xlsx.ts`:
1. Every XML part of an export is well-formed; every relationship target and
   content type resolves.
2. Every part except `sheet1.xml`, the ctrlProps and the VML is byte-identical to
   the template; in `sheet1.xml` everything outside `<sheetData>` and the
   `<mergeCells>` the template normalised is identical.
3. The user's own 12 March workbook, rebuilt as an input, exports to a file whose
   every mapped cell equals the original's (read with ExcelJS, an independent
   parser).
4. Overflow, formulas with cached values, row-height growth, held progress.
5. **The user opens the first file in real Excel once**: it must open without a
   repair prompt, the Cerah checkbox must be ticked, and the numbers must match.

## As built (where it differs from the plan above)

- The title cell is a two-run rich string: "DAILY REPORT" (Arial 16, bold, underlined)
  and the work description under it. The client's own cell also has a blank line and
  an indent between them; those are not carried over.
- The template has no `calcChain` (part, relationship and content type removed): an
  export clears formulas in unused rows, and a chain entry with no formula behind it
  makes Excel offer to repair the file.
- Non effective and HSE rows come from the project's catalogs, so overflow is not
  hypothetical: the Samberah project has seven causes against the sheet's five, and its
  export folds the last three into "Lainnya (3)". The Man Hours card now says so.
- Crew capacity is three rows (row 20 is a 4.5 pt spacer that only the SUMs reach).
- `SavePdfButton` gained `label`, `noun`, `mime` and `warm` (defaults unchanged) rather
  than a copy, so the Excel button walks Preparing, Downloading N%, Saved the same way.
- The route reads the report UNCACHED (`readOpenDb`) and the identity from the project's
  own columns (`getOpenDb`), because the Export button waits for autosave and the cached
  copy can lag on the deployment.
- S4 gets a plain-number copy of its date-formatted style (a new `cellXfs` entry, id 423).

## Slices after this one

- **2b pictures.** Four optional images in Project details (logo left and right,
  signature left and right), stored like photos, and the 6 photo slots. Photos are
  re-encoded small: Vercel caps a function response near 4.5 MB.
- **3 import.** The same cell map read back; one file or a folder, in date order.
