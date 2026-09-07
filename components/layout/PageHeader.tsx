import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

/**
 * The top of a screen, written once.
 *
 * Every page used to hand-roll its own `<header>` with its own margins and its
 * own heading size, which is why no two of them started at the same height.
 *
 * `section` is the group the page belongs to — "Weekly Progress" above Fill in,
 * Check and the four report sheets — so that screens sharing a sidebar entry
 * say so on the page as well as in the nav.
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
  className,
}: {
  section?: string;
  title: string;
  /** The line under the title. Keep it to one sentence. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-5 sm:mb-6', className)}>
        {section && (
          <p className="mb-1 text-xs font-semibold tracking-wide text-chart-1">{section}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {children && (
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground sm:mt-2">{children}</p>
      )}
    </header>
  );
}
