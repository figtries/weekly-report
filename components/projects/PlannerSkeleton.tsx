import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * The planner's frame, drawn before the project is known.
 *
 * This exists because the fallback used to be `null`, and under
 * `cacheComponents` that fallback IS the prerendered shell: Next served
 * `/projects/[id]` as a page whose `<main>` held one empty `<template>` and
 * nothing else. The shell arrived instantly and painted nothing, so every
 * millisecond spent fetching the segment and its 119 KB of client chunks was
 * spent staring at an empty screen — measured at 496 ms on a five-row project
 * and 1.4 s on Gundih, on localhost, before any network latency at all.
 *
 * The comment on that `null` said there was "no honest skeleton to draw before
 * the id is known". That confused the CONTENT with the FRAME. Which project it
 * is decides the words; it decides nothing about the shape. Every project gets
 * the same header band, the same value strip, the same toolbar and the same
 * 44px rows under the same column headings — so the frame can be drawn
 * truthfully, and the words arrive into a layout that does not move when they
 * land.
 *
 * WHICH MAKES THIS FILE A COPY THAT GOES STALE. It was written against the
 * nine-column sheet and stayed there: after the 12 Sep column cut it drew
 * Target, Price and Weight, a pricing bar ValueStrip no longer has, four
 * desktop-only toolbar buttons on a phone, a legend the phone hides, and a pane
 * 180px wider than the plan opens. Every one of those is a jump at the exact
 * moment the plan lands — the failure it exists to prevent, inverted. Change
 * the sheet, change this, and photograph the two side by side at 390px.
 *
 * Two details are load-bearing:
 *
 * **The back link is REAL, not a ghost.** Its href needs no id. Someone who
 * opened the wrong project can leave during the wait instead of watching it
 * finish loading first.
 *
 * **The blocks are `bg-muted-foreground/25`, and NOT `bg-muted`.** shadcn's
 * `Skeleton` uses the latter, and the token here is `oklch(0.97 0 0)` — all but
 * white on a `#f9fafb` page — which `animate-pulse` then takes to half opacity.
 * Photographed at 390px, the first version of this file was a blank screen with
 * a faint texture on it: the exact failure it exists to prevent. A tint of the
 * TEXT colour instead of the surface colour is what makes it visible, and it is
 * also the version that would survive the dormant `.dark` block in globals.css
 * ever being switched on — unlike `.animate-shimmer`, which hard-codes
 * `#f3f4f6`/`#e5e7eb` and would glow on a dark page.
 *
 * Server component on purpose: it must cost nothing to render and nothing to
 * download, because it is competing with the very chunks it stands in for.
 */
export default function PlannerSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" aria-busy="true">
      <span className="sr-only" role="status">
        Loading the plan
      </span>

      {/* One wrapping row, ordered exactly as the real header orders it: on a
          phone the way back and the two buttons share the first line and the
          title takes the second; above 640px the way back has a line to itself
          and the buttons return to the right of the title. Drawn as a column
          instead — back link, then title, then buttons — this band was 33px
          taller than the one it stands in for, and the whole plan slid up when
          the words arrived. */}
      <header className="shrink-0 border-b px-3 py-2 sm:px-6 sm:py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:items-start">
          <Link
            href="/projects"
            className="order-1 mr-auto inline-flex h-11 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground sm:h-8 sm:w-full"
          >
            <ArrowLeft className="size-3.5" />
            All projects
          </Link>
          <div className="order-2 flex shrink-0 animate-pulse items-center gap-2 sm:order-3">
            <Block className="h-9 w-20 rounded-lg" />
            {/* "Data Overall" on a phone, "Go to Data Overall" above it —
                measured at 126px and 165px. Sized to the OPEN project's button
                rather than to "Open this project" (58 / 137), which is the same
                choice this block already made when the words were "Dashboard". */}
            <Block className="h-9 w-32 rounded-lg sm:w-40" />
          </div>
          {/* `sm:w-[38rem] sm:max-w-full` IS THE WRAP, not decoration. The real
              title block is `sm:w-auto`, so the width flexbox lays this row out
              with is the project NAME's max-content — about 610px for a
              contract title — and 610 + the two buttons do not fit until the
              content area passes ~870px. That is why the buttons take a line of
              their own at 768 and 1024 and return to the title's right at 1280.
              A placeholder has no text to be that wide, so it says the number:
              38rem reproduces all three, and `max-w-full` keeps it from
              overflowing a 640px screen. Left at `w-auto` the band was 41px
              short at 768 and 49px at 1024, and the plan dropped by a row and a
              half when it arrived. */}
          <div className="order-3 w-full min-w-0 animate-pulse sm:order-2 sm:mr-auto sm:w-[38rem] sm:max-w-full">
            {/* Two title lines below `sm`, one above it. Every project here is
                named after a contract — "RELOKASI 2 UNIT TAURUS 60 GTG DARI
                TANJUNG FIELD..." — and at 390px that wraps. Reserving one line
                for it made the whole page jump down by two when the name
                landed. The second line is short, the way a wrapped line is. */}
            <Block className="h-5 w-full max-w-md sm:h-6 sm:max-w-none" />
            <Block className="mt-1 h-5 w-2/3 max-w-sm sm:hidden" />
            <Block className="mt-1.5 h-3 w-11/12 max-w-lg" />
            <Block className="mt-1 h-3 w-2/3 max-w-md sm:hidden" />
          </div>
        </div>
      </header>

      {/* The value strip: the contract figure and the currency picker beside
          it, and NOTHING else. The 10rem bar drawn here was the pricing
          progress bar, which left ValueStrip on 12 Sep 2026 with the per-row
          prices it measured — a placeholder for a control that no longer
          exists. */}
      <div className="flex shrink-0 animate-pulse flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2 sm:px-6">
        <Block className="h-6 w-40 sm:h-7" />
        {/* The currency picker is a 44px target, not the 36px a `Block` here
            guessed — and it is the tallest thing on the line, so it alone sets
            the band. Eight pixels short, this strip held the whole plan 8px
            above where it lands. Above 640px it drops to 32px, the way every
            control in this app trades a thumb target for a pointer. */}
        <Block className="h-11 w-16 rounded-lg sm:h-8" />
      </div>

      {/* The toolbar. Its buttons are 44px targets, and it WRAPS TO TWO ROWS at
          every width — the actions, then the search, which carries `sm:ml-auto`
          and is pushed onto a line of its own. Photographed side by side, a
          one-row placeholder here left the sheet 70px too high and the whole
          page hopped down when the real bar landed; drawing the four
          desktop-only actions on a phone cost the same 70px in the other
          direction. Which buttons exist is as much of the shape as how wide
          they are — see TOOLBAR. */}
      <div className="flex shrink-0 animate-pulse flex-wrap items-center gap-1 border-b px-2 py-1.5 sm:px-3">
        {TOOLBAR.map((t, i) =>
          t.startsWith('gap') ? (
            <span
              key={i}
              className={`mx-0.5 h-6 w-px bg-border ${t === 'gap-lg' ? 'hidden sm:block' : ''}`}
              aria-hidden
            />
          ) : (
            <Block key={i} className={`h-11 rounded-lg ${t}`} />
          )
        )}
        {/* `sm:ml-auto`, not `ml-auto` — the search is pushed right only where
            it shares a line with the buttons. The real toolbar says the same
            thing in the same words, and a phone that pushed it right left a
            screen-wide hole beside it. */}
        <div className="flex items-center gap-2 sm:ml-auto">
          <Block className="h-11 w-28 rounded-lg sm:h-9 sm:w-36" />
          <Block className="hidden h-4 w-14 sm:block" />
          {/* List / Timeline. Below 768px the two panes take turns, so this
              control is on screen exactly where the timeline pane is not. */}
          <Block className="h-[3.125rem] w-32 rounded-lg sm:h-[2.625rem] md:hidden" />
        </div>
      </div>

      {/* The legend band that sits under the toolbar while no row is selected.
          It wraps to two lines at 390px on a project with packages, which is
          the case worth matching.

          `hidden md:flex`, because under 768px the sheet opens on the List tab
          and ScheduleSheet hides the legend there — 60px spent naming colours
          for bars that are not on screen. Drawn unconditionally, this pushed
          the phone's first row 60px down and then let it snap back up. */}
      <div className="hidden shrink-0 animate-pulse flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 md:flex">
        <Block className="h-4 w-24" />
        <Block className="h-4 w-20" />
        <Block className="h-4 w-24" />
        <Block className="h-4 w-16" />
        <Block className="h-4 w-20" />
        {/* Bar styles, on the right. It is a 44px button and therefore the
            tallest thing on the line, so it alone decides this band: 57px with
            it, 25px without, and the plan opened 32px high without it. */}
        <Block className="ml-auto h-11 w-28 rounded-lg" />
      </div>

      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {/* The sheet pane, at the split the planner opens on.
            `min(SHEET_NATURAL, max(shellWidth * 0.62, FULL_GRID))` in
            ScheduleSheet is `min(620px, max(62%, 490px))` here, which is the
            same arithmetic said in CSS — and it has to be said, because an even
            flex split put the divider 130px left of where the real one lands
            and the whole timeline slid sideways the moment the plan arrived.
            Anyone who has dragged the divider has a stored ratio this cannot
            know; the default is the case worth matching. Below `md` it is the
            full width, which is what the real one does until you switch to the
            Timeline tab.

            Both numbers moved with the column cut: SHEET_NATURAL 800 → 620 and
            the body's floor 43.75rem → 30.625rem, which is the 490px six
            columns now need. Left at the old pair, the frame opened the sheet
            180px wider than the plan does and the divider jumped left the
            moment it landed. */}
        <div className="min-h-0 min-w-0 shrink-0 overflow-hidden max-md:!w-full md:w-[min(620px,max(62%,490px))]">
          <div className="min-w-[19rem] sm:min-w-[30.625rem]">
            <div
              className={`grid items-center gap-x-1.5 border-b bg-card px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ${GRID}`}
              style={{ height: HEAD_H }}
            >
              {/* The headings are the real words. They are identical on every
                  project, they cost nothing, and a column you can already read
                  is worth more than a grey bar of the same size.

                  Cell for cell the sheet's own header, `invisible` hash and
                  Days/Duration pair included — one of that pair is always
                  display:none, which is what keeps the child count at five
                  below 640px and six above it. */}
              <span className="invisible sm:visible">#</span>
              <span>Task name</span>
              <span className="text-right sm:hidden">Days</span>
              <span className="hidden text-right sm:block">Duration</span>
              <span className="hidden text-right sm:block">Start</span>
              <span className="text-right">Finish</span>
              <span className="sr-only">Row actions</span>
            </div>

            {/* Sixteen rows at the sheet's own 44px. The indents step in and
                back out the way an outline does, so this reads as a plan
                arriving rather than as a stack of identical bars. One pulse for
                the lot of them — see `Block`. */}
            <div className="animate-pulse">
              {ROWS.map((r, i) => (
                <div
                  key={i}
                  className={`grid items-center gap-x-1.5 border-b px-3 ${GRID}`}
                  style={{ height: ROW_H }}
                >
                  <span aria-hidden className="h-4 w-[3px] rounded-full bg-muted-foreground/25" />
                  <Block
                    className="h-3.5"
                    style={{ width: `${r.name}%`, marginLeft: r.indent * 14 }}
                  />
                  {/* Days / Duration, then Start above 640px only, then Finish
                      — five cells in flow on a phone and six on a desktop, the
                      same arithmetic as the header above. */}
                  <Block className="h-3 w-7 justify-self-end sm:w-9" />
                  <Block className="hidden h-3 w-12 justify-self-end sm:block" />
                  <Block className="h-3 w-11 justify-self-end sm:w-12" />
                  <span />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden w-1.5 shrink-0 bg-border md:block" aria-hidden />

        {/* The timeline pane, hidden below `md` exactly as the real one is. */}
        <div className="hidden min-h-0 min-w-0 animate-pulse flex-1 overflow-hidden md:block">
          <div className="flex items-center gap-4 border-b px-3" style={{ height: HEAD_H }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Block key={i} className="h-3 w-10" />
            ))}
          </div>
          {ROWS.map((r, i) => (
            <div key={i} className="flex items-center border-b px-3" style={{ height: ROW_H }}>
              <Block
                className="h-3.5 rounded-full"
                style={{ width: `${r.bar}%`, marginLeft: `${r.offset}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The sheet's own geometry, copied deliberately — see ScheduleSheet.
 *
 * COPIED MEANS KEPT IN STEP. These four lines were the pre-12-September sheet:
 * nine columns with Target, Price and Weight among them, a body floored at
 * 43.75rem and the pane opening at `min(800px, 62%)`. The sheet dropped to four
 * columns and every one of those numbers stayed here, so the frame drew three
 * headings the plan does not have and then reflowed the moment it landed — the
 * exact jump this file exists to prevent, arriving from the other direction.
 *
 * `scripts/verify-sheet-columns.ts` counts the tracks in ScheduleSheet. Nothing
 * counts these, so they are written as the same two strings under the same two
 * names: a mismatch is then something you can see by reading the two files side
 * by side rather than something you have to measure.
 */
const ROW_H = 44;
const HEAD_H = 36;
const GRID_SM = 'grid-cols-[0.75rem_minmax(5rem,1fr)_2.75rem_4.5rem_2.75rem]';
const GRID_LG =
  'sm:grid-cols-[4.25rem_minmax(8rem,1fr)_4.25rem_4.25rem_4.25rem_2.25rem]';
const GRID = `${GRID_SM} ${GRID_LG}`;

/**
 * The eight toolbar actions, at the widths their labels actually take: Add row,
 * Add inside, Import, then Indent / Outdent / Delete, then Collapse all / Undo.
 *
 * Below `sm` FOUR OF THEM ARE NOT THERE AT ALL. Add inside, Indent, Outdent and
 * Delete are `desktopOnly` in SheetToolbar — the row panel carries them on a
 * phone — and drawing a placeholder for each put a third row under the toolbar
 * that the real bar never has. Measured at 390px, the plan's first row landed
 * 70px above where the frame had promised it, so the whole sheet jumped up the
 * moment it arrived. Of the four that stay, three are an icon alone, which is
 * why every entry still carries two widths.
 */
const TOOLBAR = [
  'w-24 sm:w-28', // Add row — the only one that keeps its label on a phone
  'hidden sm:block sm:w-32', // Add inside — desktop only
  'w-11 sm:w-24', // Import
  'gap',
  'hidden sm:block sm:w-28', // Indent — desktop only
  'hidden sm:block sm:w-36', // Outdent — desktop only
  'hidden sm:block sm:w-24', // Delete — desktop only
  'gap-lg',
  'w-11 sm:w-32', // Collapse all
  'w-11 sm:w-28', // Undo
] as const;

/**
 * The rows, written down rather than generated.
 *
 * A random width per row would differ between the server's HTML and the
 * client's first render and trip a hydration mismatch; one fixed width would
 * draw a rectangle nobody reads as a plan. So the shape is a literal — an
 * outline that indents and comes back out, with bars that step to the right the
 * way a schedule does.
 *
 * Sixteen of them because that is what reaches the fold on a 900px desktop
 * window with room to spare. Twelve stopped short and left a pale band under
 * the last one, which reads as "the plan ends here" rather than as loading.
 */
const ROWS = [
  { indent: 0, name: 62, bar: 82, offset: 2 },
  { indent: 1, name: 48, bar: 26, offset: 4 },
  { indent: 2, name: 55, bar: 14, offset: 6 },
  { indent: 2, name: 41, bar: 18, offset: 17 },
  { indent: 1, name: 52, bar: 34, offset: 12 },
  { indent: 2, name: 46, bar: 20, offset: 14 },
  { indent: 2, name: 58, bar: 22, offset: 28 },
  { indent: 0, name: 66, bar: 58, offset: 30 },
  { indent: 1, name: 44, bar: 24, offset: 33 },
  { indent: 2, name: 50, bar: 16, offset: 36 },
  { indent: 2, name: 39, bar: 19, offset: 48 },
  { indent: 1, name: 57, bar: 30, offset: 58 },
  { indent: 2, name: 43, bar: 15, offset: 60 },
  { indent: 2, name: 51, bar: 17, offset: 71 },
  { indent: 0, name: 60, bar: 26, offset: 66 },
  { indent: 1, name: 47, bar: 21, offset: 68 },
];

/**
 * A placeholder shape, and NOT an animation.
 *
 * The pulse lives on the seven band wrappers instead, one animation each. It was
 * on every block, which is about 170 of them once the sixteen rows are counted,
 * and a throttled phone spent the whole wait ticking 170 opacity animations and
 * then tearing them down at the exact moment the real plan wanted the main
 * thread: measured at 4x throttle, the plan landed 200 ms later than with no
 * skeleton at all. Seven wrappers cost nothing and look identical, since blocks
 * that all start together were pulsing in unison anyway.
 *
 * The wrappers are placed so that no REAL text sits inside one — the back link
 * and the eight column headings must not fade in and out, because one of them
 * is a control people are meant to use while they wait.
 */
function Block({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={`block rounded bg-muted-foreground/25 ${className}`}
      style={style}
    />
  );
}
