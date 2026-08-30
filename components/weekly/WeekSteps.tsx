'use client';

import { Badge } from '@/components/ui/badge';
import { PressLink, pressMotion } from '@/components/motion/Press';
import { SlideTab } from '@/components/motion/SlideTab';
import { cn } from '@/lib/utils';

/**
 * The three things a week actually asks of a person, in the order it asks them.
 *
 * The tab row this replaces was two SEPARATE groups — [Update, Review] and
 * [Summary, Detail, S-Curve, Photos] — and which one you saw depended on which
 * page you were already on. From the Update screen there was therefore no route
 * to the report at all; the only bridge was a sidebar entry called "Reports",
 * pointing at the same `/weekly/[week]/` URLs. Someone who had just finished
 * filling in a week had no way of knowing they were two taps from printing it.
 *
 * A stepper instead of tabs because the three are ORDERED: you cannot sensibly
 * check figures you have not entered, or print a report you have not checked.
 * The counts are the point — an intern who does not yet know what "deviation"
 * means can still read "6 left" and "2 to check" and know where they stand.
 *
 * THAT ORDER IS ALSO WHY THIS IS NOT `SectionTabs`. Radix's Tabs models a set
 * of peers with one selected; a stepper has a direction, a chevron between each
 * pair and a number on every step. Wrapping it in Tabs would mean fighting the
 * primitive to hide what it is for. Everything else here — the ground, the
 * surface, the counts — comes from the same shadcn tokens and the same `Badge`
 * the tab row beside it uses.
 *
 * Steps stay reachable in any order. This numbers the work, it does not gate
 * it: a wrong count must never be able to lock someone out of their own report.
 */
export interface WeekStep {
  key: string;
  n: string;
  label: string;
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
}: {
  steps: WeekStep[];
  activeKey: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Weekly steps"
      className={cn(
        'overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden',
        className
      )}
    >
      <ol className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
        {steps.map((s, i) => {
          const active = s.key === activeKey;
          return (
            <li key={s.key} className="flex items-center">
              {i > 0 && (
                <svg
                  aria-hidden
                  className="mx-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              )}
              <PressLink
                href={s.href}
                aria-current={active ? 'page' : undefined}
                {...pressMotion}
                className={cn(
                  // min-h-11: these are the primary navigation of the whole
                  // section and have to clear the 44px touch target.
                  'relative flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
                  // `transition-colors`, not `transition-all`: the press is
                  // framer-motion's now, and two writers on one transform is a
                  // press that stutters halfway down.
                  'transition-colors duration-300 ease-ios',
                  // `bg-background` and `shadow-sm` moved to SlideTab, which
                  // draws them while travelling between steps.
                  active ? 'text-foreground' : 'text-foreground/60 hover:text-foreground'
                )}
              >
                {active && <SlideTab id="week-step" className="rounded-md" />}
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    active
                      ? 'bg-foreground text-background'
                      : 'bg-muted-foreground/25 text-muted-foreground'
                  )}
                >
                  {s.n}
                </span>
                {s.label}
                {s.badge && (
                  <Badge
                    className={cn(
                      'ml-0.5 min-w-5 px-1.5 text-[11px] font-bold tabular-nums',
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
