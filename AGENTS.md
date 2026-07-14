<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Printing

Every printed page in this app is one `.print-sheet-a4` element. Printing is the
feature users trust least, because every bug in it costs them paper — and it has
regressed on a real phone four times. The rules below are the scar tissue; each
one is there because breaking it produced a blank, sliced, or duplicated page on
someone's device. Read `app/globals.css` (the `.print-sheet-a4` block) and
`components/print/PrintSheet.tsx` before touching any of it.

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

**A tap on Print must never be lost.** The button lives in the week toolbar
(layout, hydrated early); the sheet that answers it is a `dynamic()` chunk in the
page and shows up later. A fire-and-forget `window` event dispatched in that gap
lands on nobody — the user taps, nothing happens, and they tap again. Requests go
through `components/print/printRequest.ts`, which latches a request that has no
listener yet and replays it (with a TTL, so a stale request can't ambush someone
who has since navigated away).

**The overlay always states what it is doing** — preparing / opening the dialog /
tap to close / couldn't prepare. A silent grey backdrop is indistinguishable from
a hang, and it is dismissible even when the report never loads.

**Verifying:** headless Chrome cannot reproduce these bugs (it *clips* an
over-tall sheet where Safari emits an extra page, and it shrink-to-fits a
too-wide one). Test with `Page.printToPDF` at `preferCSSPageSize: false`,
full paper width and ~12.7mm forced top/bottom margins — that reproduces
Safari's page box — and assert **printed pages == rendered sheets**. Drive it by
clicking the real Print button ONCE, as soon as React has hydrated it, and assert
`window.print` was called exactly once. Anything else only proves it works on
your laptop.
