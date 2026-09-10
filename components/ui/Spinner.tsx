import { cn } from '@/lib/utils';

/**
 * The one spinner.
 *
 * Six screens had drawn their own by hand, each with its own radius, stroke
 * and opacity, so two buttons a tap apart span at different weights. It is a
 * plain SVG rather than a framer-motion loop: this appears the instant a button
 * is pressed, which is exactly when the main thread is busy, and a CSS
 * animation runs on the compositor where that does not reach it.
 *
 * `currentColor` throughout, so it takes the colour of whatever button it sits
 * inside without being told.
 */
export default function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-4 shrink-0 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
