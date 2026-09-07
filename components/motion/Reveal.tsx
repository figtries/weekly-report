import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { MOTION } from '@/lib/design';

/**
 * The app's one entrance animation — and it is CSS, on purpose.
 *
 * THIS WAS A framer-motion COMPONENT FOR ONE SESSION AND IT MADE THE APP FEEL
 * SLOWER, so the reasoning is written down here rather than left to be
 * rediscovered. `motion.div` with an `initial` prop renders that initial style
 * into the SERVER HTML: the Overall Summary shipped six elements at
 * `opacity: 0`, Detail Progress two. Nothing on those pages was visible until
 * the JavaScript had downloaded, parsed and hydrated — and then it all appeared
 * at once. Measured in a headless Chrome at 4× CPU throttle, `next dev` gave
 * the first three seconds of that page ten animation frames with a one-second
 * gap in the middle of them.
 *
 * A CSS keyframe has none of that shape. It is in the first paint, it runs on
 * the compositor, and it finishes correctly even if the bundle never arrives.
 * The A/B is in the git history: swapping this file back and forth changed the
 * frame count on an unthrottled machine by less than the run-to-run variance,
 * because the library was never the cost — the hidden-until-hydrated markup
 * was.
 *
 * So the rule in AGENTS.md gains one exception, and it is the same KIND of
 * exception as `/print/*`: correctness, not taste. Entrances that play on page
 * load are CSS. framer-motion stays for movement driven by state after the page
 * is alive — where it is genuinely better, and where nothing is hidden waiting
 * for it.
 *
 * The numbers still have one home: `MOTION` in `lib/design.ts`, mirrored into
 * `--motion-duration` in globals.css. Change one and change the other.
 *
 * `delay` staggers a list. Keep it under ~0.3s in total: past that the page
 * stops feeling responsive and starts feeling slow, which is the opposite of
 * what motion is for on a screen someone opens forty times a week.
 */

/**
 * IT RIDES `.animate-enter`, NOT `.animate-fade-in-up`. The two are a scale,
 * not a preference: 8px over 0.26s is something incidental appearing — a tick
 * inside a button, an error banner — and 16px over 0.42s is a SECTION
 * arriving, which is the only thing this component is ever wrapped around. It
 * spent a long time on the smaller of the two, and the cost was that a card
 * and a validation banner entered a screen at exactly the same weight, so
 * nothing on the page read as more important than anything else.
 *
 * Everything downstream inherits it: the Dashboard's five blocks, SummaryCards'
 * hero and contract grid, PhotoUploadGrid, the EDL summary. One class, one
 * change.
 */
/** Re-exported so a component reaches the curve without a second import. */
export const EASE = MOTION.ease;
export const DURATION = MOTION.duration;

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('animate-enter', className)}
      // Only when there is one: an inline `animationDelay: 0s` on every
      // wrapper is noise in the DOM and in the diff.
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {children}
    </div>
  );
}
