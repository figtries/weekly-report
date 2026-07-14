<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Reports & PDF

Every report page in this app is one `.print-sheet-a4` element, and every report
leaves the app as a **server-rendered PDF** — never `window.print()`. This is the
feature users trust least, because every bug in it costs them paper, and it has
regressed on real phones repeatedly. The rules below are the scar tissue. Read
`app/globals.css` (the `.print-sheet-a4` block), `lib/pdf.ts` and
`components/print/SavePdfButton.tsx` before touching any of it.

**The report leaves as a PDF, not through the browser's print pipeline.** Browsers
stamp their own band into printouts (date + title on top, URL + "1/9" on the
bottom); it is a client print setting no CSS can remove, and iOS Safari has no
toggle for it at all. `lib/pdf.ts` renders `/print/weekly/[week]?only=KEY` or
`/print/daily/[date]` in headless Chromium (`puppeteer-core`;
`@sparticuz/chromium` on Vercel, system Chrome locally) with
`displayHeaderFooter: false`, so the file is just the report and identical on
every device. `SavePdfButton` fetches the bytes and saves them via a blob anchor,
narrating the whole trip (Save as PDF → Preparing PDF… → Saved! / tap-to-retry) —
a bare navigation gave no feedback for the seconds Chromium needs, and users
pressed the button twice. The daily button persists unsaved edits first: the PDF
is built from stored data.

**The `/print/*` render targets live OUTSIDE the app segments, on purpose.** The
weekly layout's `unstable_instant` validation covers every page beneath it and
requires each searchParam a page reads to be enumerated in its samples — reading
`?only=` under `/weekly/[week]/` failed the Vercel build, and a page-level
`unstable_instant = false` does NOT exempt a page. Also: any uncached/dynamic
read in these pages (searchParams, `connection()`) must sit behind `<Suspense>`
or the build fails with "Uncached data was accessed outside of `<Suspense>`". A
`null` fallback is safe — `lib/pdf.ts` waits for the `.print-sheet-a4` selector
before snapshotting.

**Geometry lives in CSS, never in a component.** `.print-sheet-a4` owns width,
height, padding, margins and page breaks. A report component renders content and
nothing else — no inline `width`/`height`/`padding`/`page-break`, no `mm` values.

**`@page` margin is ZERO; the visible margin is the sheet's print padding**
(10mm 15mm 12mm). Zero margin is also what keeps the browser band away if anyone
manually Ctrl+P's a `/print/*` page — the band is drawn INTO the page margin, so
no margin means no band (desktop/Android; iOS draws its own regardless, which is
why the PDF flow exists).

**So does the look.** All five reports are built from the report design system in
`globals.css` (`.rpt-*`) plus `PrintHeader` / `PrintFooter` — nobody invents their
own borders, greys, fonts or spacing. Two rules there are correctness, not taste:
`print-color-adjust: exact` (without it renderers drop the header bands and zebra
rows) and the embedded Inter webfont rather than a system stack (different OSes
resolve system stacks to different faces, which shifts line breaks, column
widths, and therefore where the report splits).

**On paper a sheet must not assert a size.** A sheet that hard-codes
`min-height: 294mm` overflows the printable area and spills a blank page after
every real one — an iPhone printed 9 sheets as 18 pages (July 2026). On paper a
sheet is a plain block: full width of the page box, exactly as tall as its
content. The A4 look (210×297mm, drop shadow) is a screen-only affordance.

**Never `break-inside: avoid` on a sheet.** A page-sized unbreakable box that
doesn't fit gets shunted to a fresh page and blanks the one before it. Atomicity
belongs on rows, images and charts.

**Keep each sheet under ~240mm of content (~262mm with its print padding).**
Taller splits onto a second page. Chunk instead of growing: `ROWS_PER_PAGE`
(detail), `PAGE_SIZE` (photos), `WEEKS_PER_BLOCK` (S-curve figures). After ANY
change to type size, padding or the header, re-measure every sheet — lay the page
out at 794px (= the 210mm page box at margin 0) under `media: print`, because a
wide viewport makes every sheet look shorter than it renders.

**Paper must never paginate through a flexbox** — WebKit drops the fragments.
Sheets and their wrappers are `display: block` on paper.

**Verifying:** the artifact is the PDF, so test the PDF. Hit `/api/pdf/...` and
assert the count of `/Type /Page` objects in the bytes (NOT `/Count`, which also
appears on page-tree nodes) equals the sheets the report renders. Then click the
real Save button ONCE, as soon as React has hydrated it, and assert the button
walks Save as PDF → Preparing PDF… → Saved! and the file lands (CDP
`Browser.setDownloadBehavior { behavior: 'allow' }` — `allowAndName` cancels blob
downloads). And run `next build` before pushing: both build failures in this
feature's history were build-time-only.
