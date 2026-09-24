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
narrating the whole trip (Save as PDF → Preparing PDF… → Downloading… N% →
Saved! / tap-to-retry) — a bare navigation gave no feedback for the seconds
Chromium needs, and users pressed the button twice. The percent needs the PDF
routes' explicit `Content-Length`; the button also pings `/api/pdf/warmup` when
it appears (and when the tab becomes visible again) so the Chromium boot —
seconds on a cold Vercel lambda, the bulk of the mobile wait — happens before
the tap, not after. The daily button persists unsaved edits first: the PDF is
built from stored data.

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

# UI components (shadcn / Radix)

shadcn is initialised here as `radix-nova` — Radix primitives, not Base UI. Radix
was chosen over the lighter Base UI because this app is tested on iPhone first
and Radix carries years of iOS Safari fixes; Base UI is newer and its edge cases
are thinly documented. Components live in `components/ui/` and are OURS — edit
them freely, there is no upstream to fight.

**NEVER re-run `shadcn init`.** It is not additive. On an already-initialised
project it rewrites theme files: in Aug 2026 it silently added Geist and pointed
`--font-sans` at it, and overwrote `--background`/`--foreground` with its own
oklch values. The font swap is the dangerous one — this repo's reports depend on
Inter resolving identically everywhere, because a different face shifts line
breaks and column widths and therefore where a report splits pages. Use
`shadcn add <component>` to pull components (verified safe — it touches nothing
but `components/ui/`), or `shadcn apply --only theme|font` for deliberate,
scoped theme changes.

**Radix per screen, never per row.** The cost is in mounted instances, not in
the library. `WbsTreeTable` expands every parent by default and can render all
285 leaves at once; a Radix Select / Popover / Tooltip inside that loop means
285 contexts, refs, effects and portals. Inside any `.map()` that can exceed
~20 rows, use native `<input>` / `<select>` and style them with shadcn classes.
For a per-row action, mount ONE DropdownMenu and drive it with the active row's
id. `DataOverallWorkbench` already sidesteps this by drilling one level at a
time — keep that pattern.

**Not every shadcn component costs anything.** Button, Input, Textarea, Table,
Card, Badge, Skeleton, Alert and InputGroup are pure Tailwind — use them
anywhere. Only Select, Dialog, Popover, DropdownMenu, Tooltip, Command, Sheet
and Tabs pull Radix in.

**`/print/*` stays Radix-free.** Print pages are plain HTML + the `.rpt-*`
system. Puppeteer does not wait for animations, and a Radix portal renders
outside `.print-sheet-a4` where the geometry rules do not reach.

**Lazy-load the overlays.** Dialog, Command, Sheet and Popover load through
`next/dynamic` so they stay out of the initial bundle — this is what the field
crew's connection actually feels.

**Do not replace the hand-rolled primitives.** `DateField`, `ConfirmDialog`,
`AnimatedNumber` and `TruncatedName` have already absorbed rounds of mobile
fixes (the calendar button is drawn by hand for a reason). shadcn is for what
does not exist yet, not for re-doing what works.

**One token source.** shadcn reads its colours from the existing `@theme inline`
block in `app/globals.css` — never let it introduce a second palette. Its
overlay animations are pinned to `--ease-ios` at the bottom of that file so a
dialog opens on the same curve as everything else; keep that pin if the motion
tokens ever change.

# Setup, weights and the plan curve

**Weight is derived, never typed.** `bobot = line value / contract value × 100`,
computed in `lib/setup.ts` from priced BOQ lines. A BOQ exists on every EPC
contract — it is what the bid was priced from — so asking for prices asks for a
document people already have, the weights close at 100 by construction instead
of by luck, and `contractValue` (and therefore earned value) falls out for free
rather than needing its own field. Never accept a weight from a client payload:
`applySetup` in `lib/mutations.ts` is the only door into the database, and it
recomputes. (The db.json setup wizard still gives a project without a priced
BOQ `evenWeights()`; a SQLite project with no budgets weighs nothing — see below.)

**A BUDGET IS THE ONLY THING THAT GIVES A ROW WEIGHT** (24 Sep 2026, replacing
the 14 Sep "price or share" rule; spec in
`docs/superpowers/specs/2026-09-24-weights-budget-only-design.md`). Weights
gives every row ONE money box, and beside it the row's share of its POOL, which
can be typed too: a typed share is turned into money on the client and the MONEY
is saved, so `updateRowTextAction` takes a price and nothing else. The % / IDR
toggle went because one row carried two percents that never agreed (the box's
was a share of the parent, the figure beside it a share of the whole SPK).

Four rules there are correctness. **A pool is the nearest heading above with a
budget of its own, or the project** (`poolOf`); a work package with a budget
is its own contract and draws on the project, which is how SPK-007 inside 1.4
stays out of 1.4's sum. **The project budget IS its work packages added up**
(`WeightResult.projectBudget`) and every weight is measured against it, so
raising a package raises the project; the contract value typed on the project
is only COMPARED with it, and the Weights strip says "over the contract value
by X" with a link to Project details instead of refusing anything. **A row nobody budgeted weighs 0** — no even share of a
remainder, anywhere, including a plan with no budgets at all. It was read as a
figure somebody had typed ("= IDR 11 253" under five empty boxes), and the
consequence is the user's by decision: the total reads what the budgets reach,
and the strip at the top NAMES every activity with no budget, one press away.
**The cap is refused, in both directions, inside a heading**, by
`checkBudgetEdit`: a budget may not take more than its heading has left, and a
heading may not be lowered below what already draws on it. The project level
never refuses (see above).
It runs on the client while typing and again in the action before writing, and
it refuses only what makes a pool WORSE, so Gundih's inherited 140% headings
stay editable. Paste and indent are bulk and are not blocked; the card reports
"over by X". **A stored `workstep_factor` is still READ** — as that fraction of
the parent's own budget — so Gundih's IFR / IFA / AFC and every percent typed
before 24 Sep keep their figures; nothing writes one any more, and setting or
clearing a row's budget clears it. Zero in the money box is empty, never a
stored 0. **Nothing changes a budget without being pressed first**: a row's
figures are a button until pressed, then Save or Cancel (blur saves nothing),
and a work package's budget opens a dialog that says what the new figure does
(short or over against its rows, the project budget before and after, and
whether that passes the contract value) before Save.

Stored `bobot` follows: `syncDerivedWeights` writes 0 on an unbudgeted leaf
(a real zero, not a missing figure), a contract value edit re-syncs, and
`resyncWeights` in `lib/db-snapshot.ts` brings a restored snapshot's unlocked
projects in line once, keyed on `pragma user_version`, so the reports follow the
rule without waiting for somebody to edit a price. Locked projects
(`weight_basis = 'boq'`) never move.

**A DOT IN A MONEY BOX IS A THOUSANDS SEPARATOR.** `stripAmount` reads every
dot as one when every dot in the string is followed by exactly three digits, so
`28.081` is twenty-eight thousand and `1.403.528` is the contract. This is an
Indonesian contractor and that is how people here write a number; read as a
decimal point it is not a rounding difference, it is three orders of magnitude.
A price typed `28.081` against a US$1,403,528 contract stored 28.081 and printed
"0.00% of project", so the row looked like it had never been filled in (14 Sep
2026). Nothing could have caught it on screen either: `formatMoney` is pinned to
`maximumFractionDigits: 0`, so THIS APP NEVER DISPLAYS A FRACTION OF A UNIT, and
a box that takes what the rest of the app refuses to show can only lose
information. The rule is all-or-nothing across the string, which is what leaves
the importer's own figures alone — `5920000.006405` has six digits after its dot
and `842723.7244800002` has ten. The percent box is NOT covered and must not be:
a share is 0 to 100, so a dot there is a real decimal point.

**A card's money is its ROWS added up, never the heading row's own price.** The
first version printed `unitContractValue ?? price`, so a heading with six fully
priced rows and no price of its own read "No value yet" beside a figure of
69.72% — one card making two statements that contradicted each other, reported
14 Sep 2026. `WeightsUnit.derivedValue` is the figure that was missing, and
`decidedRows` counts rows set EITHER way, because a count of priced rows reads
as nothing done on a heading whose rows are all shares.

**The plan curve is generated, never imported.** `generatePlanCurve` turns
start/finish/pattern into each leaf's weekly `targetWF`, which is exactly the
shape `LeafSnapshot` already stores — so a schedule revision regenerates the
curve instead of sending someone back to Excel. `scurve` is a smoothstep, not a
logistic, so an item lands on exactly 1.0 at its finish week; a curve that
asymptotes leaves every item at 99.x% forever and leaks a permanent phantom
deviation into the project total.

**The week grid is the project's dates read a second way, and it follows them.**
`weekRowsFor` in `lib/week-grid.ts` cuts seven-day blocks from the start date
and clips the last one at the finish. It used to run ONCE, at creation, and
editing the start date afterwards only wrote the column — so PHSS Samberah,
whose start was typed 26 Dec 25 against a plan whose weeks run from Monday
29 Dec, had every week end three days early for its whole life, with nothing on
any screen able to move it. It cost 0.24 points of plan on week 36 and
something on every week. `relayWeeks` re-lays the grid on any date edit,
matching weeks by NUMBER so week 36 stays week 36 and keeps everything recorded
against it. **A surplus week is only dropped if nothing was ever recorded
against it** — `leaf_progress`, `milestone_progress` and `approvals` all cascade
from `weeks`, and shortening a project is not a reason to destroy a signed
approval.

**`weekAnchorEndDate` is WEEK ONE'S END**, because every reader computes
`anchor + (n - 1) weeks` from it. `lib/dashboard-db.ts` handed over the LAST
week's end instead, so every period label in the app and on all five printed
sheets sat (weeks - 1) weeks in the future: a 72-week project showed week 36 as
"08 Jan – 14 Jan 2028" where the client's own signed report says 31 Aug –
06 Sep 2026. The figures were never affected — `targetWF` reads each week row's
own `endDate` — which is exactly why it survived so long. db.json has always
stored week 1's end here (Gundih's `2025-10-30` is `weeks[0].periodEnd`), and
that agreement is what keeps the two stores printing the same header.

**A project's INITIAL is three letters, and it is stored in `projects.alias`.**
`deriveInitial` in `lib/initial.ts` guesses it from the name: initials of the
first three significant words, or for a one- or two-word name its first letter
plus the last two consonants, which is what makes "Gundih" into "GDH". The cap
is enforced in `createProjectAction` as well as on the input, because
`maxLength` is a courtesy to whoever is typing and not a rule. The column keeps
the name `alias` deliberately: renaming it would mean a second migration
through the snapshot-restore path for a word, and `drizzle-kit` has eaten child
rows here before when it chose to rebuild a table rather than alter it. The
first version of this allowed twelve characters and produced "JPICSPUCS", which
is not a handle but an unpronounceable second name; three is the length people
write by hand.

**Every column the project page shows must be in `ProjectField`, or it is
write-once.** The initial shipped reachable only from `createProjectAction`,
which meant a typo was permanent and the three projects predating the column
could never be given one. `ProjectField` and the `FIELDS` list in
`ProjectDetails` are the pair to check: the same audit found
`documentNoWeekly` and `documentNoDaily` had been READ into the printed report
header since the importer wrote them and had no way in either. Still
unreachable and deliberately so: `weightBasis`, which belongs to Data Overall.

**The signature blocks were printing the wrong company on the wrong side.**
`lib/dashboard-db.ts` built them from `contractorName` and `clientName` instead
of from `signature_left` / `signature_right`, which dropped the signatory's name
entirely and put the contractor where the client belongs: the imported project's
own signed reports print the CLIENT on the left (PT PERTAMINA EP ZONA 11 /
Andika Wijaya Kusumah) and the contractor on the right. Both columns were
populated by the importer all along, so the right values were sitting there
being ignored. They are read properly now, through `lib/signature.ts` — the one
module that knows the JSON shape, because a `'use server'` file cannot export
the sync reader — and the four halves are editable in Project details. The
fallback keeps the old shape for a project whose columns really are empty, with
the sides the right way round. Gundih on the SQLite path now prints byte for
byte what db.json prints, which is what makes moving it later a migration
rather than a change of number.

**An imported project's report header does NOT come from these columns.** A
project with `legacyJsonId` reads db.json, so typing a report number into
Project details looks like it worked and changes nothing on the paper. The
dialog says so, in warn colour, on those two fields only. Say it rather than
hide the fields: the fork is deliberate and the admission is the same kind
`/klaim` makes about photos carrying no timestamps.

**The planner asks for a schedule, and nothing else.** Four columns: task name,
duration, start, finish. Target, Price and Weight were removed on 12 Sep 2026
and the reason is not tidiness. With per-row money out of it, the sheet's
client-side model only has to hold name, dates, duration, order and depth,
which is what makes instant editing tractable at all; with Price in it, that
model would also have to carry weight derivation. Per-row prices, weights and
the `weight_basis = 'boq'` lock live in Data Overall (board item 12), and until
it exists a project made in the app cannot be marked value-based and takes
`evenWeights()`. `ValueStrip` keeps the contract figure and the currency,
because that is one number belonging to the project and it is asked when the
project is created. The pricing bar went with the columns rather than staying
behind: with no price to type it would have read 0% forever with nothing on
screen able to move it, and a number that cannot be acted on reads as broken
rather than as empty. Nothing is deleted underneath — `targetDate`, `price` and
`bobot` are still stored, still written by the importer and by
paste-from-Excel, and their actions are untouched.

**The phone keeps THREE of those four columns, and that is measured.** `GRID_SM`
has five tracks against `GRID_LG`'s six, and `scripts/verify-sheet-columns.ts`
asserts both numbers. All four DO fit below 640px once the money columns are
gone — six tracks come to 370px, clearing even a 375px iPhone SE — and fitting
was the wrong test: on Gundih at 390px the name column went from 170px to
100px, "Relokasi 2 Unit Ta…" became "Relok…", and three branches read "D…",
"G.." and "I.". The start date is one tap away in the row panel; the column you
identify a row by is not. Re-measure the name column, not just the overflow,
before adding anything to that grid.

**Data Overall is ONE MAP, and it is not a table.** Two earlier cuts were built
outward from the workbook — its columns, its blocks, its formulas — and both
were rejected the same day for reading as a spreadsheet with the gridlines taken
out. The figures were never wrong; the shape was. What shipped on 13 Sep 2026 is
`components/weekly/OverallMap.tsx` over `lib/overall-map.ts`: contract → group →
activity, opened where you stand, NO COLUMN HEADERS ANYWHERE, and three things
per row — name, one bar, one number. Everything else about a row is one press
away in `ActivityPanel`, which is also where Weights went: **price, method
and schedule stopped being a screen**, because three screens meant remembering
which one held which field. `/weekly/[week]/weights` survives as the BULK tool
(two hundred prices in one sitting is not a per-row job), and on 14 Sep 2026 it
came BACK into the week bar as an unnumbered entry called Weights. The old
rule here said not to put it beside the stepper, and the half of it that still
holds is that it is not a STEP: what an activity is worth belongs to the project
and is as true in week 4 as in week 40, so it carries no numeral and no chevron,
and `WeekSteps` draws a divider before it. The half that was wrong is that a
setup card and a quiet link under the map were enough to find it by; they were
not. It is also the only screen that can show a heading's budget against what
its rows have claimed, which no per-row panel can.
The weekly queue survives too, as a LENS over the map rather than a list of its
own: `lib/worklist.ts` still decides what is due.

Four things there are correctness, not taste. `buildOverallMap` COMPUTES
NOTHING — percentages come from `lib/rollup.ts`, due/filled from
`lib/worklist.ts`, method from `lib/progress.ts`; a screen with its own opinion
is how a report ends up disagreeing with the site. A SINGLE ROOT IS UNWRAPPED,
because Gundih's WBS has one top row and the map's first screen was otherwise
one line reading "176 activities". `withOptimistic` carries a saved leaf up its
ancestors by WEIGHT using the rollup's own formula — it is display only, lasts
until the refresh lands, and is the reason a contract bar visibly grows when you
fill something in, which is the only part of this screen that makes filling in
nine items feel like progress rather than a chore. And the panel's draft is
RE-SEEDED when the row's method changes: switching to quantity makes the server
seed a quantity from the old percent, and a draft still holding `qtyDone: 0`
would have made Save write a zero over it.

**Adding a weekly tab means setting `printable`.** `TABS` in
`components/weekly/WeekTabs.tsx` carries an explicit flag that must match the
`ReportKey` union in `app/print/weekly/[week]/page.tsx`. It used to be inferred
by excluding `overall`; adding Panel Kendali under that rule pointed the PDF
button at `?only=control`, which renders no sheet — and `lib/pdf.ts` waits for
`.print-sheet-a4`, so the request hangs rather than failing. Set the flag
deliberately.

# Progress has one origin

**`lib/progress.ts` decides every leaf percentage, and `lib/rollup.ts` calls it
instead of reading `cumProgressPct`.** For `qty` and `milestone` items the
stored percent is only a cache; trusting it over the quantity it came from is
how a report ends up disagreeing with the site. `applyFieldProgress` in
`lib/mutations.ts` is the only writer for those methods, and it writes through
`syncLeafSnapshot` — the evidence decides the percentage, never the reverse.
`lumpsum` still reads the typed value, unchanged, so every seeded project
behaves exactly as before.

**Switching an item's method clears the other method's evidence** — a stale
quantity sitting behind a milestone item is a number nobody can explain later.

**Catalogs are per project.** Delay causes, HSE rows and crew groups live in
`db.catalogs` (see `lib/catalogs.ts`), not in `lib/defaults.ts`. The first daily
report of a project seeds its rows from them; later reports carry their
predecessor's rows forward, so editing a catalog mid-project never rewrites the
shape of a report that is already signed. Weather is the deliberate exception:
`WeatherInfo` is a fixed-shape record rather than a list, so making it
configurable means changing the type and the daily form together.

**`claimable` on a delay cause is load-bearing.** It is what lets
`buildDelayRegister` assemble extension-of-time material without anyone
re-classifying by hand. Photos carry no capture metadata yet, so `/klaim` states
plainly that the evidence is contestable — keep that admission until timestamps
and GPS are actually stored.

# Changing how you measure must not change what was measured

**`applyProgressMethod` carries progress ACROSS a method change, never through
it.** An August 2026 bug proved why: switching "Project Management" to quantity
mode recomputed all 60 weeks from a `qtyDone` that did not exist yet, silently
rewriting a leaf that had sat at 100% for 27 weeks down to zero and dropping
the project total from 68.80% to 67.83%. The percentage is now re-expressed in
the new method's own terms — a quantity is seeded from it, milestones are
awarded in order and never past it.

**`vol: 1, satuan: 'Ls'` is not a quantity.** It is how every seeded item is
stored, and it passes a naive `vol > 0` check, which is how the above happened.
Use `hasRealQuantity()`; switching such an item to quantity mode must ask for a
real total first rather than inventing one.

# Multi-project

**`readDb()` still returns one `Database` — the active project.** The store now
holds a `Workspace` (see `lib/workspace.ts`), but roughly forty call sites read
a single project and rewriting them would have bought nothing. Only code that
genuinely spans projects calls `readWorkspace()`. Legacy single-project files
are wrapped on read and never rewritten until something is actually saved.

**Anything the root layout reads must be cached.** `getProjects()` and
`getWorkspace()` in `lib/data.ts` exist because an uncached read in
`app/layout.tsx` blocks every route in the app and fails the build on
`/_not-found` with "Uncached data was accessed outside of `<Suspense>`".

**Approvals snapshot the figure approved.** A signature that silently follows
the number it signed is worth nothing in a dispute, so the panel shows drift
when the week is edited afterwards.

**The deployed app has no disk, so the database is a SNAPSHOT.** On Vercel
there is no `data/report.db`, so `lib/db-path.ts` falls back to a copy of
`data/seed.db` in the lambda /tmp — and that copy is per-instance AND
per-function. Creating a project wrote it inside the function serving
`/projects`; the redirect to `/projects/[id]` was served by a different
function whose /tmp still held the untouched seed, so the page 404d on a
project the previous screen had just made (11 Sep 2026 — the deployed list was
byte-for-byte the committed seed). `lib/db-snapshot.ts` gives that file one
durable home: pulled at cold start from `instrumentation.ts` before the first
query, pushed after every write, and re-checked with a conditional GET before
a read. The driver stays synchronous, which is the whole point — an async one
would force `<Suspense>` around every read in the app.

Four things hold it together. Writes are detected in `lib/sqlite.ts` by
patching the connection rather than by each of the fifty-odd server actions
remembering, because `insert ... returning` runs through `.all()` and would
have been missed. `db` is exported through a PROXY so a pulled snapshot can
close and reopen the database under callers that imported it at module load.
The push is AWAITED in `lib/project-actions.ts` rather than left to `after()`,
because each of those actions is followed straight away by a navigation and an
in-flight upload is a redirect landing on a project the next lambda has never
heard of. And it is a SINGLE-WRITER design: two people editing in the same
second can have one file-level snapshot land on top of the other. With no
`BLOB_READ_WRITE_TOKEN` the whole module is inert and the app behaves exactly
as it did — ephemeral, but working. A developer machine is never touched
either: it keeps its own `data/report.db`, which is the gate.

**A new COLUMN reaches the deployment through `ensureSchema()`, not through a
migration.** Nothing runs `drizzle-kit migrate` on Vercel: `instrumentation.ts`
pulls the blob snapshot over the database file before the first query, so the
snapshot's schema IS the deployed schema and the file that was just built gets
overwritten by it. `EXPECTED_COLUMNS` in `lib/db-snapshot.ts` is the list that
is put back after every restore, called from `writeDbFile` because that is the
single place incoming bytes land; append one line per column added from here on.
It runs ONLY on bytes from the store: repairing a developer's own
`data/report.db` would leave the drizzle journal disagreeing with the file and
break the next `migrate` on a duplicate column. A local database is migrated,
not repaired. This does not solve new TABLES, which would also need their
indexes and foreign keys, so that remains a deployment question to answer before
writing the code.

**`data/seed.db` is TRACKED, and a migration must reach it too.** It is the file
`lib/db-path.ts` copies into `/tmp` when there is no disk, so a deployment with
no blob store attached opens it directly and no snapshot layer is awake to
repair anything. Migrate it with `REPORT_DB_PATH=data/seed.db npm run db:migrate`
— and then CHECKPOINT it, because the write lands in `seed.db-wal` and leaves
the committed file untouched, which git reports as no change at all:
`new Database('data/seed.db').pragma('wal_checkpoint(TRUNCATE)')`.

**`fs.copyFileSync` on a WAL database silently copies the past.** Every script
that builds a throwaway fixture from `data/report.db` hits this: recent writes
live in `report.db-wal` and a file copy leaves them there. It stayed invisible
while the missing writes were rows nobody asserted on, and stopped being
invisible when `projects` gained `alias` — two verify scripts died with
`no such column: "alias"`, which looks exactly like a bug in the code under
test. Use `copyDbFixture` from `scripts/db-fixture.ts` (it serializes, the same
image the snapshot push uploads). `scripts/backfill-schedule.ts` still copies by
file for its backup and has the same latent gap.

**Attaching the store is a deploy-time act, not a dashboard act.** Creating the
Blob store and connecting it to the project is only half of it: Vercel bakes
environment variables into a deployment when that deployment is built, so the
instance already serving traffic keeps running WITHOUT the token it was never
given, and the app goes on silently losing every write. It has to be REDEPLOYED
after the store is connected. This cost 12 Sep 2026 — the store was created and
connected, the 404 did not budge, and the running deployment still reported
`hasBlobToken: false`.

Which is what `/api/health/db` is for. It makes the deployed instance answer for
itself — token present, `snapshotConfigured`, which file it opened, whether that
file is the throwaway `/tmp` copy, which projects it can see, and whether the
store answers a list — so the three causes that look identical from outside (no
store, a failing store, a write that never ran) can be told apart in one
request. Check it before theorising; the token itself is never printed.

**A clock read before a request read 500s on the DEPLOYMENT and nowhere else.**
Under `cacheComponents`, `Date.now()` in a server component before any uncached
or Request data has been read ("`cookies()`, `headers()`, `connection()`,
`searchParams`") is a static-generation bailout. `ensureFreshDb()` throttles
itself on the clock, and `getActiveProjectId()` used to call it BEFORE reading
the cookie — harmless locally, where no blob store is attached and the function
returns before it ever looks at the time. On Vercel it took out every
`/dokumen/[week]` path that was not in `generateStaticParams` (12 Sep 2026).
Anything that reads a clock in a render must come after a request read.

Which is also how a broken route hides: **a prerendered page still answering
`X-Vercel-Cache: STALE` with `Age` climbing past `X-Nextjs-Stale-Time` is a
FAILING function, not a warm cache** — its regeneration has been throwing since
the deploy while the CDN serves the build-time entry. Compare against a route
you know is healthy (`/weekly/60/summary` answered `REVALIDATED`, then `HIT`
with `Age: 0`). The 500 page itself carries no digest, so read the real error
with `npx vercel logs <deployment-url> --json` — tail it in the background,
curl the failing path, and each entry's `logs` array holds the Next.js message.

# Which store a project reads, and which one it writes

**`legacy_json_id` decides, and only ONE project has it.** `db.json` holds
exactly one project; SQLite holds them all. Dashboard, Weekly Progress and
Reports now read whichever project is OPEN through `getOpenDb` /
`getOpenWeekRollup` / `getOpenSCurveSeries` in `lib/data.ts`: a project with
`legacyJsonId` reads db.json through the same cached functions it always did,
every other project reads SQLite through `lib/dashboard-db.ts`. Their writes
follow the same fork — `lib/actions.ts` asks `sqliteProject()` first and hands
off to `lib/progress-sqlite.ts`, which calls `lib/progress.ts` for every figure
so the evidence still decides the percentage.

**Gundih stays on db.json on purpose.** Both stores hold it and they do not
agree: week by week (`scripts/verify-weekly-store.ts`) they differ by up to
12.85 points, because db.json's later weeks carry leaves that fall back to zero
while SQLite carries each leaf forward. Whichever is nearer the truth, moving a
signed report onto a different number is not a migration. It moves when board
item 08 reconciles it deliberately.

**`targetWF` is never written on the SQLite side.** The curve comes from the
dates. `applyWeekUpdates` accepts a target only because db.json stores the curve
per leaf per week; `saveWeekUpdatesSqlite` drops it.

**A PDF cannot ask which project is open, so the URL tells it.** `lib/pdf.ts`
launches headless Chromium with no cookies, so `/print/*` would resolve the open
project from `app_state` — and on a deployment the cookie and that row are
exactly the pair that disagree. `app/api/pdf/weekly/[week]/route.ts` resolves it
in the USER's request and passes `?project=`; `getPrintDb` renders an empty sheet
for an id it does not know, never somebody else's.

**Still db.json for Daily, Klaim and the Settings catalogs — but PER PROJECT
now.** They need tables SQLite does not have, and **a deployment restores its
schema from the blob snapshot, not from a migration** (`instrumentation.ts`
pulls the file; nothing runs `drizzle-kit migrate`), so adding a table is a
deployment question before it is a code one — answer that first. What did not
need a table: `db.json` has held a MAP of projects since the portfolio tier, and
only `readDb()` insisted on returning whichever one the file called active.
`jsonKeyFor()` in `lib/legacy-bridge.ts` answers which record a project reads
and writes — `legacyJsonId` for the imported one, its own SQLite id for
everybody else, created on first write and seeded with the identity SQLite
already holds. Read through `getOpenJsonDb()` / `getPrintJsonDb()`, write
through `mutateOpenDb()`; `mutateDb()` and its `assertLegacyWritable` guard are
left for the weekly and setup paths, which still belong to the one project.
A daily report is a form filled in from the site, not something derived from a
plan — there was never a reason a project had to be imported before it could
have one.

**An index route that redirects must resolve the project behind `<Suspense>`.**
`/weekly` and `/dokumen` send you to a week number, and reading db.json's sent a
two-week project to week 36. The open project is a cookie, so the redirect lives
in a child component with `connection()` and a `null` fallback — an uncached read
in the page body fails the build.

**Weight follows price, unless the weights are authoritative.** `weight_basis =
'boq'` is the LOCK: an imported project carries it, and so does one whose owner
has applied a derivation covering the whole plan. Everything else re-derives on
every price edit, every structural change (`renumber()` is the funnel) and every
pasted BOQ — see `lib/weights-auto.ts`. A leaf no budget reaches weighs 0 and
is stored as 0 (24 Sep 2026: the even share of what was left is gone, see "A
BUDGET IS THE ONLY THING" above); the Weights strip names every such leaf so
the gap is reminded rather than guessed. And a row that stops being a leaf
stops carrying a weight, the same stale-flag family as `isMilestone`.

# The v2 rebuild — read this before starting new work

The app is being rebuilt from fundamentals against the CPP Gundih data
(3 workbooks, 4 SPK, 285 WBS rows, 142 documents, 415 days). The decisions are
locked and there is a numbered work board. **The blueprint is the plan of
record:**

> https://claude.ai/code/artifact/d3dfeed6-8a05-4ba8-87f5-2affe3da7c47

Work happens on branch `v2-foundation`; `main` is untouched until it is
deliberately fast-forwarded. To update the blueprint from any session, publish
with that URL as `url` — publishing without it creates a duplicate artifact
instead.

**The user briefs by number.** Do one item, finish it, stop. Do not roam into
neighbouring items; the scattering that produced this board is the thing it
exists to prevent.

```
FASE 0 — pondasi
01 Fondasi database          selesai   17 tabel · Drizzle · SQLite
02 Kurva rencana diturunkan  selesai   30/30 cocok Gundih
03 Navigasi 12 → 6           selesai   Sidebar 488→268
04 Dashboard halaman depan   selesai
05 Visual dashboard          selesai   per kontrak · sebaran · laju
FASE 1 — data nyata masuk
06 Importer Gundih           selesai   W43 bobot/progress/WF cocok PDF · target 75,37
   + register EDL           selesai   20/21 kategori cocok · leaf engineering belum ditautkan
FASE 2 — bahasa visual
07 Design system                       token shadcn + satu kurva framer-motion
FASE 3 — laporan mingguan
08 Halaman Ringkasan
09 Halaman Kurva S
10 Halaman Detail Progress
11 Halaman Dokumentasi
12 Data Overall workbench
13 PDF format Pertamina
FASE 4 — yang mengisi laporan
14 Form Harian → draft ringkasan mingguan
15 Modul Document Control  selesai   EDL + VDRL · 5 layar · per minggu · jalur menulis · tautan
FASE 5 — membuat proyek dari nol
16 Project management        selesai   bikin · pilih · arsip · hapus · identitas
17 Planner                   selesai   WBS · tanggal · Gantt · tempel dari
                                       Excel · bar styles · rantai
                                       12 Sep 26: turun ke 4 kolom (jadwal
                                       saja); harga, bobot dan target pindah
                                       ke papan 12. Initial proyek (tiga
                                       huruf) ditanya saat proyek dibuat.
18 Baseline berversi
FASE 6 — dashboard yang berpikir
19 Dashboard bulanan                   ahead · outstanding · warning · problem
FASE 7 — setelah isinya terbukti
20 Impor dan ekspor Excel
21 Penyusun blok laporan
22 Login dan peran
```

Papan 16 dan 17 selesai 6 September 2026 dalam delapan langkah; rencananya, tiap
keputusan dan tiap angka yang diukur ada di
`docs/superpowers/specs/2026-09-06-projects-redesign.md`. Yang paling mengikat
kode: rantai antar-pekerjaan DITEBAK dari tanggal dan tidak pernah disimpan
(`lib/chains.ts`), warna batang datang dari daftar aturan berurutan per proyek
dan bukan dari kode (`lib/bar-styles.ts`), dan tanggal target adalah janji —
satu-satunya tanggal yang boleh diketik di baris ringkasan, dan ia tidak pernah
menggeser apa pun.

**Warna yang tidak bisa membedakan bukan warna.** Dikunci 6 September 2026
setelah dibuktikan pada proyek berisi lima baris: `assignColorGroups` memakai
baris teratas sebagai "paket" tanpa memeriksa apakah baris itu cabang, jadi
empat baris teratas — tiga di antaranya leaf — dapat empat warna berbeda, satu
warna per baris. Sekarang sebuah paket harus CABANG, dan prinsip yang sama
dipakai di `pruneStyles`: aturan yang cocok dengan SEMUA baris atau TIDAK SATU
pun dibuang dari daftar, karena merah di setiap batang tidak mengatakan apa-apa
dan satu baris di legenda yang tidak menunjuk apa pun lebih buruk lagi. Aturan
yang ditulis tangan tidak pernah dipangkas — itu keputusan orangnya.

**Dua daftar siap pakai, dan proyeknya boleh memilih sendiri.** `TYPE_PRESET`
mewarnai menurut APA baris itu (ringkasan, milestone, kritis merah seperti MS
Project, lewat target, belum berjadwal); `PACKAGE_PRESET` mewarnai menurut SPK
tempat baris itu berada. `projects.bar_preset` NULL berarti aplikasi yang
memilih — punya paket, pakai warna paket; belum, pakai warna jenis — sehingga
menandai SPK kedua memindahkannya sendiri. Baris di `bar_styles` selalu menang
di atas keduanya.

**Baris beranak tidak pernah milestone.** Flag itu dipasang saat baris masih
leaf dan basi begitu ada yang di-indent ke bawahnya; `renumber()` di
`lib/sheet-structure.ts` — satu-satunya jalan yang dilewati setiap perubahan
struktur — sekarang menghapusnya, dan salinan renumber di `lib/paste-actions.ts`
melakukan hal yang sama.

**Paket menutupi apa pun yang ada di dalamnya, di kotak TERSIMPAN dan bukan
cuma di layar.** Sebuah cabang menggambar kotaknya sendiri yang dilebarkan oleh
anak-anaknya (`rowSpan`), sementara pagarnya membaca kotaknya saja (`boxAt`).
Tidak ada yang menjaga keduanya sejalan: tanggal yang DIKETIK dipagari, tapi
indent, drag dan tempel tidak pernah melihat tanggal paketnya sama sekali. Jadi
sebuah paket bisa memegang kotak satu hari dengan pekerjaan berbulan-bulan di
dalamnya, lalu setiap tanggal di bawahnya ditolak dengan menyebut rentang yang
tidak muncul di layar mana pun — Engineering di PHSS Samberah tersimpan 30 Des
25 sampai 30 Des 25, tergambar 30 Des 25 sampai 08 Nov 26, dan kedua barisnya
beku permanen (14 Sep 2026). `coverChildren` di `lib/sheet.ts` menyusulkan kotak
tersimpan ke bar yang sudah tergambar; dia hanya MELEBARKAN, karena kotaknya
sendiri ikut jadi bahan min/max, jadi apa pun yang diketik orang selamat.
Dipanggil dari `renumber()` (kedua salinannya) dan sekali lagi di
`updateRowDatesAction` sebelum pagar diperiksa — pagar yang sudah bocor bukan
pagar, dan rencana yang dibuat sebelum aturan ini ada hanya bisa lepas di situ.

Papan ini disusun ulang 27 Agustus 2026 setelah data sumber dibaca baris demi
baris. Rencana lengkapnya — alasan tiap urutan, tujuh belas temuan pada workbook
asli, dan struktur ketiga berkas sebagai rujukan importer — ada di
`docs/superpowers/specs/2026-08-27-project-control-v2-design.md`. Baca itu
sebelum mengambil nomor mana pun.

**Ketika tanggal dan kurva bertentangan, tanggal yang menang.** Dikunci 27
Agustus 2026 setelah dibuktikan pada data Gundih: 126 dari 176 leaf (88,38%
bobot proyek) punya kolom PLAN yang tidak cocok dengan kolom tanggal di
sebelahnya — `1.4.3.2` naik rata 1/16 per minggu selama 16 minggu padahal
tanggalnya 105 hari alias 15 minggu. Kolom PLAN itu diketik tangan dan tidak
pernah diperbarui. Karena itu `scripts/import-gundih.ts` membaca blok PLAN tapi
tidak pernah menyimpannya; dia memakainya sebagai alat uji dan mencetak daftar
leaf yang bertentangan. Akibatnya target W43 keluar 75,37% sementara PDF yang
sudah ditandatangani menulis 75,15% — selisih 0,22 poin yang di W60 menjadi nol.
Bobot, progress dan WF kumulatif tetap cocok sampai dua desimal.

**Empat keputusan tampilan, dikunci di sesi yang sama.** Semua elemen datang dari
shadcn-ui; semua animasi dan transisi datang dari framer-motion, dengan satu
kurva dan satu durasi untuk seluruh aplikasi; setiap halaman harus benar di
iPhone, Android, Windows dan desktop, diverifikasi dengan gambar pada 390px dan
desktop; dan aplikasi ini dipakai orang berumur 22 sampai 60, jadi kontras
tinggi, target sentuh ≥44px, dan tidak ada informasi yang hanya muncul saat
hover. Tiga pengecualian, ketiganya soal kebenaran dan bukan selera: baris tabel
yang bisa melebihi ~20 memakai kelas shadcn dengan elemen native di dalamnya;
`/print/*` tidak memakai framer-motion karena Puppeteer memotret tanpa menunggu
animasi; dan **animasi masuk saat halaman dimuat adalah keyframe CSS, bukan
framer-motion**.

Yang ketiga dibuktikan 30 Agustus 2026. `motion.div` menuliskan prop `initial`-nya
ke dalam HTML dari server: Overall Summary mengirim enam elemen dengan
`opacity: 0` dan Detail Progress dua, sehingga tidak ada yang terlihat sampai
JavaScript-nya selesai diunduh, diurai dan dihidrasi — lalu semuanya muncul
sekaligus. Diukur di Chrome headless dengan CPU ditahan 4×, tiga detik pertama
halaman itu di `next dev` hanya kebagian sepuluh frame animasi dengan jeda satu
detik di tengahnya. Menukar pustakanya bolak-balik tidak mengubah jumlah frame di
luar variasi antar-jalan, jadi biayanya memang bukan pustaka itu — markup yang
disembunyikan sampai hidrasi itulah masalahnya. Keyframe CSS ada di cat pertama,
berjalan di compositor, dan selesai dengan benar meski bundle-nya tidak pernah
tiba. framer-motion tetap dipakai untuk gerak yang dipicu state setelah halaman
hidup. Angkanya tetap satu tempat: `MOTION` di `lib/design.ts`, dicerminkan oleh
`--ease-out-expo` dan durasi di `.animate-fade-in-up` / `.animate-level-*` pada
`globals.css` — ubah satu, ubah yang lain. Alasan lengkapnya ada di
`components/motion/Reveal.tsx`.

**Masuk halaman punya SATU SKALA, bukan satu kelas.** Tiga ukuran, dan yang
membedakan adalah seberapa besar bendanya: `.animate-fade-in-up` (8px/0,26s)
untuk yang kebetulan muncul — centang di dalam tombol, spanduk galat, satu
baris; `.animate-enter` (16px/0,42s, `MOTION.enter`) untuk SEKSI yang datang,
yaitu yang dibungkus `Reveal`; dan `.animate-rise-in` (18px/0,7s) untuk satu
permukaan hero. Jeda antar-saudara ditulis sebagai kelas `.stagger-1`…`.stagger-8`,
bukan `style={{ animationDelay }}` di tiga puluh berkas. Berhenti di 8 karena
apa pun yang lebih jauh dari itu ada di bawah lipatan, dan bawah lipatan bukan
milik jeda.

**Di bawah lipatan memakai `ScrollReveal`, dan URUTANNYA adalah fiturnya.**
Komponen itu tidak pernah mengirim status tersembunyi di HTML server: dia
menyembunyikan elemen hanya SETELAH observer memastikan elemen itu benar-benar
di bawah lipatan. Ponsel yang tidak pernah menerima bundle merender halaman
utuh, dan orang yang menggulir lebih cepat daripada hidrasi tidak pernah
melihat kartu lenyap di bawah jarinya. Dua jebakan sudah dibayar: aplikasi ini
tidak menggulir dokumen — `<main>` yang menggulir, dan di laporan mingguan ada
scroller kedua di dalamnya — jadi observer harus BERAKAR pada scroller-nya,
karena `rootMargin` tidak bisa menembus klip leluhur; dan `rootMargin` atasnya
dibuka lebar (`10000px`) supaya yang sudah terlewati tetap terhitung
berpotongan, sebab observer hanya melapor saat status potongan BERUBAH dan
elemen yang dilompati viewport tidak pernah dilaporkan sama sekali — pemulihan
posisi scroll melakukan itu setiap kali. Jangan pasang di dalam `.map()` yang
bisa melebihi ~20 baris.

**Perpindahan rute: `RouteTransition`, dan TIDAK ADA `app/template.tsx`.**
Template di akar me-remount seluruh subtree tiap navigasi — itu memang gunanya —
sehingga pindah dari Summary ke Detail ikut merobohkan
`app/weekly/[week]/layout.tsx`: week picker, stepper dan seluruh baris tab
dihancurkan lalu dibangun ulang di antara dua tab minggu yang sama, dan badge
"Current" mengulang `animate-pop-in`-nya tiap kali. Sekarang batasnya dipasang
tangan: layout seksi membungkus dirinya dengan id tetap (`weekly`), tiap halaman
membungkus akarnya dengan id sendiri (`weekly-summary`), dan React melihat
pertukaran berkunci sehingga kelas `enter`/`exit` benar-benar terpakai.
Penggantinya sempat berupa client component yang memanggil `usePathname()`, dan
itu gagal build persis seperti peringatan di atas — di bawah `cacheComponents`
pathname adalah bacaan tak-ter-cache, dan membacanya di root layout memblokir
setiap rute; build mati di `/print/daily/[date]`. Halaman sudah tahu dirinya
halaman apa, jadi id-nya dioper dan komponennya tetap server component.
Animasinya sendiri hanya opacity: yang bergerak saat pindah rute adalah kartu-
kartu di dalamnya, bukan satu lempeng abu-abu — dan sebuah transform pada
snapshot sebesar Detail Progress justru cara paling cepat membuatnya tersendat
di ponsel.

**The four decisions that constrain code the most.** A reporting unit is a
FLAGGED WBS NODE, never a hierarchy level — and units nest, so a unit's weight
is its subtree minus any unit inside it (SPK-007 sits at `1.4.4` inside
SPK-004's `1.4`, yet both are reported separately; without the subtraction the
total reaches 114%). The plan curve is DERIVED, never stored: only weight,
start and finish live in the database, and each leaf spreads linearly across
its own duration. Deviation is measured against two baselines that live side by
side — Kontraktual, locked, for claims; Aktif, the latest agreed revision, for
managing the work. And a leaf's percentage comes from one of four methods:
kuantitas, milestone, lumpsum, or **tertaut**, where an engineering leaf reads
its figure straight from the document register instead of being measured twice.

**Two traps that have already cost a day each.** The SQLite driver must be
SYNCHRONOUS (`better-sqlite3`, not libsql): with `cacheComponents: true` a sync
embedded-database query counts as deterministic and prerenders, while an async
driver forces `<Suspense>` around every read in the app. And exceljs must be
driven through `ExcelJS.stream.xlsx.WorkbookReader` — plain `readFile` died at a
2 GB heap on the 11.8 MB weekly workbook.

**A drizzle migration that recreates a table DELETES ITS CHILDREN.** SQLite
cannot add a column to an existing unique index, so `drizzle-kit generate` falls
back to build-new-table / copy / `DROP TABLE` / rename, wrapped in
`PRAGMA foreign_keys=OFF … PRAGMA foreign_keys=ON`. That pragma is a NO-OP
inside a transaction, and drizzle runs migrations in one — so the DROP cascaded
and took all 357 `doc_stages` rows with it (August 2026, `documents` gained
`register`). Two habits: copy `data/report.db` before `drizzle-kit migrate`, and
COUNT THE CHILD ROWS afterwards. The generated SQL also copies columns by name
including the one being added, so the `SELECT` must be hand-edited to a literal
for the new column or the migration fails outright.

**Three smaller ones, each an hour.** shadcn's `Card` carries its own
`py-(--card-spacing)`, so a `CardContent` with its own padding doubles it — pass
`py-0` on the Card. framer-motion's `pathLength` is implemented with
stroke-dasharray, so it silently shreds a line that already has
`strokeDasharray` and any path on a stretched viewBox with
`vector-effect: non-scaling-stroke`; wipe with `clipPath` instead. And an SVG
scaled to fit its container scales its `<text>` too — at 390px the axis labels
came out about five pixels tall, so chart labels are HTML positioned over the
plot, never `<text>`.

**The app is in English; the printed report is not.** Every screen, label,
button, error message and number format in the app reads in English — decimal
POINT, `en-GB` dates, `fmtPct`/`fmtNum` in `lib/analysis.ts`. What stays as it
is: anything that comes from the data (WBS descriptions, document titles,
category names, catalog rows a project typed for itself), and everything under
`/print/*`, which is the client's own signed deliverable in the client's own
format. `components/print/*` formats its numbers inline with `en-US` and never
imports the app's formatters, which is what keeps the two apart.

**Verifying UI work.** The Browser pane never composites in this environment, so
`computer{action:"screenshot"}` always fails. Use `scripts/shoot.mjs <url>
<out.png> [w] [h]`, which drives the Chrome already here for PDFs, and actually
look at the image — desktop and 390px. Extracted text shows content, never
composition. Never verify a build through a pipe either: `next build | grep`
reports grep's exit code, so write to a file and echo `$?`.

# Token discipline (baca seperlunya, kerja seperlunya, berhenti)

Tiap giliran memuat ulang instruksi + daftar tools + file ini, jadi biaya terbesar adalah "biaya nyala", bukan cara ngetik. Turunkan dengan disiplin:

- Investigate dulu, terarah: cari dengan Grep/Glob pola spesifik; baca hanya range baris yang perlu (offset/limit), bukan file utuh — apalagi file besar.
- Jangan baca ulang file yang barusan diedit hanya untuk "memastikan"; tool edit sudah error kalau gagal.
- Batch tool call yang tidak saling bergantung dalam satu langkah, bukan satu-satu.
- Patch yang ditargetkan, bukan menulis ulang seluruh file. Edit hanya yang berubah.
- Jangan dump isi file panjang ke balasan; rujuk path + nomor baris. Output ringkas, tanpa preamble/rekap.
- Verifikasi murah (satu perintah yang membuktikan), lalu STOP. Jangan menambah polish/refactor yang tidak diminta.
- Percakapan panjang: `/compact`. Ganti tugas: `/clear`. Batasi MCP server yang aktif — tiap server menambah daftar tools yang dibaca tiap giliran.
