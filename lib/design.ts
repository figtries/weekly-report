/**
 * THE DESIGN SYSTEM. Item 07 of the v2 board.
 *
 * One file, so that "is this on track?" is answered the same way on every
 * screen, and so a curve or a duration is written down exactly once. Nothing
 * here renders anything — it hands out the vocabulary that shadcn components
 * and framer-motion are then dressed with.
 *
 * THREE RULES.
 *
 * 1. TWO COLOUR JOBS, NEVER MIXED. Measurement says WHICH LINE this is —
 *    `--chart-1` is actual (blue), `--chart-2` is plan (red), on every line,
 *    bar and tick, on a good week and a bad one. Verdict says WHETHER THE NEWS
 *    IS GOOD — `--ok` green, `--bad` red, `--warn` amber, and only ever on a
 *    number, a chip or a word. A bar coloured by verdict can no longer tell
 *    you which mark was the plan, on the week that matters most.
 *
 * 2. ONE CURVE, ONE SPRING, ONE DURATION. `MOTION` below is the only place any
 *    of the three is allowed to be written. The curve is for what CHANGES
 *    APPEARANCE — a fade, a colour, a small scale. The spring is for what MOVES
 *    FROM ONE PLACE TO ANOTHER — a drill level sliding, the active tab pill
 *    travelling, a panel opening. Asking which of the two a thing is answers
 *    which of the two it gets, every time, without taste entering it.
 *    `/print/*` gets no motion at all: Puppeteer photographs without waiting
 *    for an animation.
 *
 * 3. SENTENCE CASE, ALWAYS A CAPITAL. Every label, title, chip and axis tick
 *    starts with a capital — "Week 58", not "week 58"; "Actual", not "actual".
 *    Only data speaks for itself (WBS descriptions, document titles, SPK tags).
 */

/* ------------------------------------------------------------------ motion */

/**
 * The numbers, written once. `app/globals.css` mirrors them — `--ease-out-expo`
 * and the durations on `.animate-fade-in-up` / `.animate-level-*` — because the
 * entrances themselves are CSS keyframes, for the reason set out in
 * `components/motion/Reveal.tsx`. Change one side and change the other.
 */
export const MOTION = {
  /**
   * cubic-bezier(0.16, 1, 0.3, 1) — a fast start with a long soft landing,
   * mirrored as `--ease-out-expo`. This is the curve every entrance in this app
   * has used since before the v2 work, and the one that was asked for back
   * after a session spent on the iOS curve. `--ease-ios` keeps its own job:
   * hover, press and the other interaction transitions.
   */
  ease: [0.16, 1, 0.3, 1] as const,
  /**
   * Seconds, for movement the USER just caused — a row expanding, a panel
   * opening, a number counting. Short, because the user is already looking at
   * the thing and waiting on it.
   *
   * It was 0.42 for a while, which is where "one duration for the whole app"
   * first landed — but the app it replaced ran its card entrances at 0.26, so
   * unifying upward made every screen slower than anything that came before.
   * 0.26 is that original number.
   */
  duration: 0.26,
  /**
   * Seconds, for something ARRIVING — a page's cards on load, a section
   * crossing into view on scroll. Longer than `duration` on purpose, and this
   * is the one exception rule 2 admits, because the two are different jobs:
   * an interaction is a reply and should be instant, an arrival is an
   * introduction and reads as cheap when it is rushed. 0.42 is far enough from
   * 0.26 to be felt and still under the half-second where a screen someone
   * opens forty times a week starts feeling slow.
   *
   * The level slide keeps its own 0.35 in globals.css: a whole screen sliding
   * sideways is neither of these.
   */
  enter: 0.42,
  /** Between siblings in a staggered reveal. Keep a whole page under ~0.3s. */
  stagger: 0.06,
  /**
   * The route change, asymmetric on purpose. The outgoing page leaves fast
   * because nobody wants to watch what they just left; the incoming one takes
   * its time because that is the part being introduced. Symmetric timings read
   * as a flicker — the app spent months at 80ms/170ms proving it.
   *
   * Mirrored by `::view-transition-old/new` at the bottom of globals.css.
   */
  routeOut: 0.12,
  routeIn: 0.36,
  /**
   * The one spring, for what MOVES rather than what merely changes.
   *
   * Damping ratio ζ = 30 / (2·√(300 × 0.9)) ≈ 0.91 — just under critical. It
   * lands with a single settle you can feel and cannot quite see. That is the
   * whole difference between "soft" and "toy": a bounce that reads AS a bounce
   * is charming on the first press and tiring by the end of the week, on a
   * screen someone opens forty times a day.
   *
   * IT IS NOT MIRRORED INTO globals.css, and that is not an oversight. CSS has
   * no spring, which is exactly why this one lives here — and why the things it
   * drives are the things CSS could never have done at all. The curve and the
   * durations still have two sides that must be kept in step; this has one.
   *
   * `layout` and `layoutId` animations do NOT read the default transition from
   * `MotionConfig` — they carry their own. Anything using them has to pass
   * `transition={MOTION.spring}` explicitly, and that is the only place this
   * token may appear outside this file.
   */
  spring: { type: 'spring', stiffness: 300, damping: 30, mass: 0.9 },
} as const;

/* ----------------------------------------------------------------- verdict */

export type Verdict = 'ahead' | 'behind' | 'done' | 'neutral';

/**
 * The one place a number becomes a colour.
 *
 * `delta` is a deviation in project percent: positive is ahead of plan.
 * `tolerance` keeps a figure that is essentially on plan out of both colours,
 * because a project reading -0.004% is not behind schedule in any sense a
 * person on site would recognise.
 */
export function verdictOf(delta: number | null | undefined, tolerance = 0.005): Verdict {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return 'neutral';
  if (Math.abs(delta) <= tolerance) return 'neutral';
  return delta > 0 ? 'ahead' : 'behind';
}

/** Colour for a figure that carries a verdict. Neutral stays the body colour. */
export const verdictText: Record<Verdict, string> = {
  ahead: 'text-ok',
  behind: 'text-bad',
  done: 'text-ok',
  neutral: 'text-foreground',
};

/** A tinted chip: same meanings, on a ground light enough to read on. */
export const verdictChip: Record<Verdict, string> = {
  ahead: 'bg-ok-soft text-ok',
  behind: 'bg-bad-soft text-bad',
  done: 'bg-ok-soft text-ok',
  neutral: 'bg-muted text-muted-foreground',
};

/** The dot / rule form, for legends and left-edge accents. */
export const verdictFill: Record<Verdict, string> = {
  ahead: 'bg-ok',
  behind: 'bg-bad',
  done: 'bg-ok',
  neutral: 'bg-muted-foreground/40',
};

/**
 * A signed figure, always with its sign, so "+1.05%" and "-3.26%" line up as a
 * pair. `fmtPct` already carries the minus; only the plus has to be added.
 */
export function signed(value: number, formatted: string) {
  return value > 0 ? `+${formatted}` : formatted;
}

/* -------------------------------------------------------------- typography */

/**
 * The type scale, so no card invents its own heading size. Every dashboard
 * card used to pick between `text-base` and shadcn's default and the two sat
 * side by side in the same row.
 */
export const TYPE = {
  /** Card headings. One size for every card on every page. */
  cardTitle: 'text-[15px] font-semibold tracking-tight',
  /** The line under a heading naming the question the card answers. */
  cardDesc: 'text-[13px] leading-snug text-muted-foreground',
  /** The one number a page is about. */
  hero: 'text-[3.25rem] leading-none font-semibold tracking-tight sm:text-6xl',
  /** A supporting figure — the hero rail, a forecast, a total. */
  figure: 'text-xl font-semibold tabular-nums',
  /** The word above a figure. */
  statLabel: 'text-[11px] font-medium leading-tight text-muted-foreground',
  /** A row inside a card. */
  row: 'text-sm font-medium',
  /** Axis ticks, item counts, anything the eye should pass over. */
  meta: 'text-[11px] tabular-nums text-muted-foreground',
} as const;
