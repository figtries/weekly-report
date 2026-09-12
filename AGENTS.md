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
recomputes. Projects without a priced BOQ get `evenWeights()` and must be
labelled as not value-based — a rough number shown honestly beats a project that
never gets set up.

**The plan curve is generated, never imported.** `generatePlanCurve` turns
start/finish/pattern into each leaf's weekly `targetWF`, which is exactly the
shape `LeafSnapshot` already stores — so a schedule revision regenerates the
curve instead of sending someone back to Excel. `scurve` is a smoothstep, not a
logistic, so an item lands on exactly 1.0 at its finish week; a curve that
asymptotes leaves every item at 99.x% forever and leaks a permanent phantom
deviation into the project total.

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
pasted BOQ — see `lib/weights-auto.ts`. A leaf no price reaches takes an even
share of what is LEFT of the contract, because a leaf with no weight is
invisible to every report; `fromGap` then keeps the plan from calling itself
value-based off the back of that division. And a row that stops being a leaf
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
17 Planner                   selesai   WBS · harga · tanggal · target · Gantt
                                       tempel dari Excel · bar styles · rantai
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
