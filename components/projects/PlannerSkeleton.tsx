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
 * 44px rows under the same eight column headings — so the frame can be drawn
 * truthfully, and the words arrive into a layout that does not move when they
 * land.
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

      <header className="shrink-0 border-b px-3 py-3 sm:px-6">
        <Link
          href="/projects"
          className="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All projects
        </Link>
        <div className="mt-1 flex animate-pulse flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            {/* Two title lines below `sm`, one above it. Every project here is
                named after a contract — "RELOKASI 2 UNIT TAURUS 60 GTG DARI
                TANJUNG FIELD..." — and at 390px that wraps. Reserving one line
                for it made the whole page jump down by two when the name
                landed. The second line is short, the way a wrapped line is. */}
            <Block className="h-5 w-full max-w-md sm:h-6" />
            <Block className="mt-1 h-5 w-2/3 max-w-sm sm:hidden" />
            <Block className="mt-1.5 h-3 w-11/12 max-w-lg" />
            <Block className="mt-1 h-3 w-2/3 max-w-md sm:hidden" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Block className="h-9 w-20 rounded-lg" />
            <Block className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      </header>

      {/* The value strip. */}
      <div className="flex shrink-0 animate-pulse flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2 sm:px-6">
        <Block className="h-6 w-40" />
        <Block className="order-3 h-1.5 w-full max-w-[10rem] rounded-full sm:order-2" />
        <Block className="order-2 ml-auto h-9 w-16 rounded-lg sm:order-3" />
      </div>

      {/* The toolbar. Its buttons are 44px targets, and it WRAPS TO TWO ROWS at
          every width — eight actions and then the search, which carries
          `ml-auto` and is pushed onto a line of its own. Photographed side by
          side, a one-row placeholder here left the sheet 70px too high and the
          whole page hopped down when the real bar landed. The widths shrink
          below `sm` because that is where the buttons drop their labels. */}
      <div className="flex shrink-0 animate-pulse flex-wrap items-center gap-1 border-b px-2 py-1.5 sm:px-3">
        {TOOLBAR.map((t, i) =>
          t === 'gap' ? (
            <span key={i} className="mx-0.5 h-6 w-px bg-border" aria-hidden />
          ) : (
            <Block key={i} className={`h-11 rounded-lg ${t}`} />
          )
        )}
        <div className="ml-auto flex items-center gap-2">
          <Block className="h-11 w-32 rounded-lg sm:w-40" />
          <Block className="h-4 w-14" />
        </div>
      </div>

      {/* The legend band that sits under the toolbar while no row is selected.
          It wraps to two lines at 390px on a project with packages, which is
          the case worth matching. */}
      <div className="flex shrink-0 animate-pulse flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5">
        <Block className="h-3 w-24" />
        <Block className="h-3 w-20" />
        <Block className="h-3 w-24" />
        <Block className="h-3 w-16" />
        <Block className="h-3 w-20" />
      </div>

      <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {/* The sheet pane, at the split the planner opens on.
            `min(SHEET_NATURAL, shellWidth * 0.62)` in ScheduleSheet is
            `min(800px, 62%)` here, which is the same arithmetic said in CSS —
            and it has to be said, because an even flex split put the divider
            130px left of where the real one lands and the whole timeline slid
            sideways the moment the plan arrived. Anyone who has dragged the
            divider has a stored ratio this cannot know; the default is the case
            worth matching. Below `md` it is the full width, which is what the
            real one does until you switch to the Timeline tab. */}
        <div className="min-h-0 min-w-0 shrink-0 overflow-hidden max-md:!w-full md:w-[min(800px,62%)]">
          <div className="min-w-[19rem] sm:min-w-[43.75rem]">
            <div
              className={`grid items-center gap-x-1.5 border-b bg-card px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground ${GRID}`}
              style={{ height: HEAD_H }}
            >
              {/* The headings are the real words. They are identical on every
                  project, they cost nothing, and a column you can already read
                  is worth more than a grey bar of the same size. */}
              <span className="invisible sm:visible">#</span>
              <span>Task name</span>
              <span className="text-right">Duration</span>
              <span className="hidden text-right sm:block">Start</span>
              <span className="hidden text-right sm:block">Finish</span>
              <span className="hidden text-right sm:block">Target</span>
              <span className="hidden text-right sm:block">Price</span>
              <span className="hidden text-right sm:block">Weight</span>
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
                  <Block className="h-3 w-8 justify-self-end" />
                  <Block className="hidden h-3 w-12 justify-self-end sm:block" />
                  <Block className="hidden h-3 w-12 justify-self-end sm:block" />
                  <Block className="hidden h-3 w-10 justify-self-end sm:block" />
                  <Block className="hidden h-3 w-16 justify-self-end sm:block" />
                  <Block className="hidden h-3 w-8 justify-self-end sm:block" />
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

/** The sheet's own geometry, copied deliberately — see ScheduleSheet. */
const ROW_H = 44;
const HEAD_H = 36;
const GRID =
  'grid-cols-[0.75rem_minmax(6rem,1fr)_4.25rem_2.25rem] sm:grid-cols-[0.75rem_minmax(9rem,1fr)_4.25rem_5.5rem_5.5rem_5.5rem_7rem_4rem_2.25rem]';

/**
 * The eight toolbar actions, at the widths their labels actually take: Add row,
 * Add inside, Paste, then Indent / Outdent / Delete, then Collapse all / Undo.
 * Below `sm` most of them are an icon alone, which is why every entry has two
 * widths.
 */
const TOOLBAR = [
  'w-24 sm:w-28',
  'w-11 sm:w-32',
  'w-11 sm:w-24',
  'gap',
  'w-11 sm:w-28',
  'w-11 sm:w-36',
  'w-11 sm:w-24',
  'gap',
  'w-11 sm:w-32',
  'w-11 sm:w-28',
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
 * The pulse lives on the six band wrappers instead, one animation each. It was
 * on every block, which is about 170 of them once the sixteen rows are counted,
 * and a throttled phone spent the whole wait ticking 170 opacity animations and
 * then tearing them down at the exact moment the real plan wanted the main
 * thread: measured at 4x throttle, the plan landed 200 ms later than with no
 * skeleton at all. Six wrappers cost nothing and look identical, since blocks
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
