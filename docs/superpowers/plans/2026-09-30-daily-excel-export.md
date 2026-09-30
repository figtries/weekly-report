# Daily Excel Export (slice 2a) Implementation Plan

> Executed inline in one session. The spec is the source of the cell map and rules;
> this plan is the order of work and the interfaces between the pieces.

**Goal:** `GET /api/xlsx/daily/[date]` returns the client's own daily workbook, filled
from the report, by patching the template's XML.

**Spec:** `docs/superpowers/specs/2026-09-30-daily-excel-export-design.md`

## Global Constraints

- English UI copy, capital-first, no em dash. The sheet's own labels stay as the client wrote them.
- Never write through ExcelJS. Only JSZip plus string patching; everything not written to stays byte-identical.
- Files under `lib/` and `components/` are CRLF: match when patching existing files (new files LF).
- Verify by pressing and by structure; never `next build` into `.next` (use `NEXT_DIST_DIR=.next-verify`, to a file, echo `$?`); `git add` by path; restore `data/db.json`, `.claude/launch.json`, `tsconfig.json` after tests.

## Tasks

1. **Addresses and the patcher** (`lib/xlsx/addr.ts`, `lib/xlsx/sheet-xml.ts`).
   `SheetXml.parse(xml)`; `get/setText/setNumber/setFormula/clear/ensure(addr)`;
   `rowHeight/setRowHeight`; `merges/setMerges`; `colWidth`, `mergedWidth(ref)`;
   `serialize()` returning the original bytes when nothing changed (round-trip
   test on the sample's sheet1.xml is the first check).
2. **The template** (`scripts/build-daily-template.ts` to `lib/xlsx/daily-template.ts`).
   From the 07 Mar 2026 workbook: blank the day's data, normalise the activity
   merges and styles, drop the pictures (drawing anchors, rels, media), fix the HSE
   shared formula, keep everything else.
3. **Filling** (`lib/xlsx/daily-fill.ts`): the cell map above as code; overflow
   ("+N lagi (lihat app)", "Lainnya (N)"), cached formula values, row-height growth,
   checkboxes (ctrlProps + VML).
4. **Compose and route** (`lib/xlsx/daily-export.ts`, `app/api/xlsx/daily/[date]/route.ts`).
5. **Day and week** (`lib/daily-week.ts`; hero "Week W · Day D" read-only; daily
   list grouped by week).
6. **The button** (`components/daily/SaveXlsxButton.tsx`, replacing the PDF button
   in the hero) and the capacity note on the cards ("Excel holds 8 lines").
7. **Proof** (`scripts/verify-daily-xlsx.ts`), lint, types, build, a real download
   through the button, then the user opens the file in Excel.
