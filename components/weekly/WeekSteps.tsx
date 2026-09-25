'use client';

import { Badge } from '@/components/ui/badge';
import { PressLink, pressMotion } from '@/components/motion/Press';
import { SlideTab } from '@/components/motion/SlideTab';
import { cn } from '@/lib/utils';

/**
 * The weekly section's one navigation bar: Fill in, Check, Weights on Data
 * Overall, and the four report sheets on Weekly Progress. Since 25 Sep 2026
 * Report is not an entry here; the two sections cross through `SectionSwitch`
 * beside the page title. The history below is of the earlier four-entry bar.
 *
 * The tab row this replaces was two SEPARATE groups — [Update, Review] and
 * [Summary, Detail, S-Curve, Photos] — and which one you saw depended on which
 * page you were already on. From the Update screen there was therefore no route
 * to the report at all. Someone who had just finished filling in a week had no
 * way of knowing they were two taps from printing it. One bar, always the same
 * four entries, fixed that.
 *
 * DRAWN AS THE REFERENCE HE CHOSE ON 25 SEP 2026: plain labels on a white bar,
 * the active one in a pill. It was a stepper before, with a numeral on each
 * stage, chevrons between them and a rule before Weights; the order still
 * reads left to right, and the bar stopped looking like a form to be completed
 * in sequence. Steps were never gated anyway — a wrong count must never be able
 * to lock someone out of their own report.
 *
 * The pill is the SIDEBAR'S active blue (`bg-chart-1/10 text-chart-1`), and so
 * are both counts. The reference's peach went the same day: on screen it read
 * as brown, the one warm thing in a blue app. The bar also stopped running the
 * full width on desktop, because four tabs in a 1600px white box left most of
 * it empty; it hugs its tabs from `sm` up, and on a phone the four split the
 * width evenly so no pill sits squeezed against the edge.
 *
 * The counts stay, and they are the point: an intern who does not yet know
 * what "deviation" means can still read "6" beside Fill in and know where they
 * stand. No badge at zero, so a finished week reads as finished.
 *
 * NOT `SectionTabs`, because that is one Radix Tabs root and the report's four
 * sheets already use it right beneath this bar on step 3 — and AGENTS.md
 * allows one per screen.
 *
 * Weights is in this bar although it belongs to the PROJECT rather than to the
 * week: this is where someone looks to change screen, and a destination
 * reachable only from a link under another page's map is one most people never
 * find (13 Sep 2026).
 */
export interface WeekStep {
  key: string;
  label: string;
  /** What a phone shows instead of `label`, when four labels do not fit 390px. */
  short?: string;
  href: string;
  /** Rendered as a pill after the label. Omitted when there is nothing to say. */
  badge?: string;
  /** Colours the badge as something outstanding rather than neutral. */
  badgeTone?: 'todo' | 'warn' | 'ok';
}

const TONE: Record<NonNullable<WeekStep['badgeTone']>, string> = {
  todo: 'bg-chart-1 text-white',
  warn: 'bg-warn text-white',
  ok: 'bg-ok text-white',
};

export default function WeekSteps({
  steps,
  activeKey,
  className,
  ariaLabel = 'Weekly steps',
}: {
  steps: WeekStep[];
  activeKey: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('w-full rounded-2xl bg-card p-1 shadow-sm ring-1 ring-foreground/5 sm:w-fit sm:p-1.5 print:hidden', className)}
    >
      {/* The bar is the white ground and never moves; the LIST scrolls inside
          it when a narrow phone runs out of width, so the rounded edge stays
          put instead of sliding off with the labels. */}
      <ol className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] sm:gap-1 [&::-webkit-scrollbar]:hidden">
        {steps.map((s) => {
          const active = s.key === activeKey;
          return (
            <li key={s.key} className="flex-1 sm:flex-none">
              <PressLink
                href={s.href}
                aria-current={active ? 'page' : undefined}
                {...pressMotion}
                className={cn(
                  // min-h-11: the section's primary navigation clears the 44px
                  // touch target. Padding and type tighten below `sm` instead,
                  // because all four must fit a 360px screen: this list hides
                  // its scrollbar, and a label cut mid-word reads as broken.
                  'relative isolate flex min-h-11 w-full items-center justify-center gap-1 whitespace-nowrap rounded-full px-1.5 text-sm sm:gap-1.5 sm:px-4 sm:text-[15px]',
                  // `transition-colors`, not `transition-all`: the press is
                  // framer-motion's, and two writers on one transform is a
                  // press that stutters halfway down.
                  'transition-colors duration-300 ease-ios',
                  active
                    ? 'font-semibold text-chart-1'
                    : 'font-medium text-foreground/80 hover:text-foreground'
                )}
              >
                {active && (
                  <SlideTab
                    id="week-step"
                    className="rounded-full bg-chart-1/10 shadow-[inset_0_0_0_1px_rgb(59_130_246_/_0.08)] ring-0 dark:ring-0"
                  />
                )}
                {s.short ? (
                  <>
                    <span className="sm:hidden">{s.short}</span>
                    <span className="hidden sm:inline">{s.label}</span>
                  </>
                ) : (
                  s.label
                )}
                {s.badge && (
                  <Badge
                    className={cn(
                      'min-w-5 px-1.5 text-[11px] font-bold tabular-nums',
                      TONE[s.badgeTone ?? 'todo']
                    )}
                  >
                    {s.badge}
                  </Badge>
                )}
              </PressLink>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
