import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * The top of a screen, written once.
 *
 * Every page used to hand-roll its own `<header>` with its own margins and its
 * own heading size, which is why no two of them started at the same height.
 *
 * `section` is the group the page belongs to — "Data Overall" above Fill in and
 * Check, "Weekly Progress" above the four report sheets — so that screens
 * sharing a sidebar entry say so on the page as well as in the nav.
 *
 * IT CARRIES NO ANIMATION OF ITS OWN, deliberately. Every page here rises as a
 * single `animate-fade-in-up` block, and that is the whole entrance: header,
 * hero and cards arriving together. For one session this header animated
 * separately while the page around it did not, so the screen came in as three
 * unrelated movements — the header fading, the hero fading behind it, the list
 * sliding in from the side — and it read as the app struggling rather than as
 * one soft arrival. Measured, nothing had got slower; it had got busier.
 */
export default function PageHeader({
  section,
  title,
  children,
  action,
  className,
  descriptionClassName,
}: {
  section?: string;
  title: string;
  /** The line under the title. Keep it to one sentence. */
  children?: ReactNode;
  /** Sits on the title's own line, centred on it, and wraps beneath it only
   *  when the two do not fit. It used to sit at the foot of the whole block
   *  (`items-end`), level with the dates rather than the title it belongs to
   *  (25 Sep 2026). */
  action?: ReactNode;
  className?: string;
  /** Overrides the line's measure, e.g. Weights stops it at half the page. */
  descriptionClassName?: string;
}) {
  return (
    <header className={cn('mb-5 sm:mb-6', className)}>
      {section && (
        <p className="mb-1 text-xs font-semibold tracking-wide text-chart-1">{section}</p>
      )}
      <div className={cn(action && 'flex flex-wrap items-center justify-between gap-x-4 gap-y-3')}>
        <h1 className="min-w-0 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {action}
      </div>
      {children && (
        <p
          className={cn(
            'mt-1.5 max-w-3xl text-sm text-muted-foreground sm:mt-2',
            descriptionClassName,
          )}
        >
          {children}
        </p>
      )}
    </header>
  );
}
