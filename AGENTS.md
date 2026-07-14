<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Printing

Every printed page in this app is one `.print-sheet-a4` element. Printing is the
feature users trust least, because every bug in it costs them paper — and it has
regressed on a real phone repeatedly. The rules below are the scar tissue; each
one is there because breaking it produced a blank, sliced, or duplicated page on
someone's device. Read `app/globals.css` (the `.print-sheet-a4` block) and
`lib/pdf.ts` before touching any of it.

**The app does NOT use `window.print()`.** It renders the report to a PDF on the
server and hands the user that file (`lib/pdf.ts` → the `/api/pdf/...` routes →
the `.../print` pages). This is deliberate and must not be "simplified" back to a
browser print: browsers stamp their own band into the page margins — date + page
title on top, URL + "1/9" on the bottom — and it is a client print setting no CSS
can turn off. `@page { margin: 0 }` does not remove it (Chrome then draws the band
ON TOP of the content), and iOS Safari does not even offer the toggle. Rendering
our own PDF is the only way the printout is just the report, identical on Windows,
Android and iPhone. The Print button is a plain link/anchor to the PDF route; the
daily editor saves first (the PDF is built from stored data, so unsaved edits
would print stale) then navigates to it.

**Geometry lives in CSS, never in a component.** `.print-sheet-a4` owns width,
height, padding, margins and page breaks. A report component renders content and
nothing else — no inline `width`/`height`/`padding`/`page-break`, no `mm` values.
The paper margin is declared exactly once, in `@page`.

**So does the look.** All five reports are built from the report design system in
`globals.css` (`.rpt-*`) plus `PrintHeader` / `PrintFooter` — nobody invents their
own borders, greys, fonts or spacing. Two rules there are correctness, not taste:
`print-color-adjust: exact` (without it browsers drop the header bands and zebra
rows, so the same report prints shaded on one device and blank-white on the next)
and the embedded Inter webfont rather than a system stack (Windows, macOS and
Android resolve system stacks to three different faces, which shifts line breaks,
column widths, and therefore where the report splits).

**On paper a sheet must not assert a size.** The printable area is *not* A4: iOS
Safari keeps a strip for its own URL / "Page x of y" footer, and printers have
hard margins. A sheet that hard-codes `min-height: 294mm` overflows that area and
spills a blank page after every real one — the iPhone printed 9 sheets as 18
pages (July 2026). On paper a sheet is a plain block: full width of the page box,
exactly as tall as its content. The A4 look (210×297mm, drop shadow) is a
screen-only affordance.

**Never `break-inside: avoid` on a sheet.** A page-sized unbreakable box that
doesn't fit gets shunted to a fresh page and blanks the one before it. Atomicity
belongs on rows, images and charts.

**Keep each sheet under ~250mm of content.** The page box is 180×266mm; anything
taller splits onto a second page. Chunk instead of growing: `ROWS_PER_PAGE`
(detail), `PAGE_SIZE` (photos), `WEEKS_PER_BLOCK` (S-curve figures). After ANY
change to type size, padding or the header, re-measure every sheet — lay the page
out at 680px (= the real 180mm content width) under `media: print`, because a
wide viewport makes every sheet look shorter than it prints.

**Paper must never paginate through a flexbox** — WebKit drops the fragments.
Sheets and their wrappers are `display: block` on paper.

**No shadows or blurs on paper.** `@media print` zeroes `box-shadow`,
`text-shadow`, `filter` and `backdrop-filter` on everything. `print-color-adjust:
exact` (above) makes the browser render them faithfully rather than dropping them,
so without the reset any stray shadow prints as a grey smear — the closed mobile
drawer, portalled to `<body>` where the toolbar's `print:hidden` can't reach it,
did exactly that in the top-left of every page.

**Verifying:** the artifact is the PDF, so test the PDF, not the page. Hit the
`/api/pdf/...` route, and assert the number of `/Type /Page` objects in the bytes
equals the number of `.print-sheet-a4` sheets the report renders — that is the
blank/duplicate-page check, and it holds because the server's own Chromium made
the file (no per-device print pipeline to differ). Screenshot the PDF in a viewer
to eyeball the layout. When measuring sheet *heights* to keep them under the
266mm page box, lay the page out at 680px (the real 180mm content width) under
`media: print` — a wide viewport makes every sheet look shorter than it prints.
