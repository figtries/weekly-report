'use client';

import { AnimatePresence, m } from 'framer-motion';
import type { ReactNode } from 'react';

import { MOTION } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * Open and close, at the height the content actually has.
 *
 * THIS IS THE CLEAREST CASE IN THE WHOLE MOTION LAYER. CSS cannot transition to
 * `height: auto`, and every `max-height` trick used to fake it pays for the
 * guess: set it too high and the animation spends its last third moving
 * nothing, which reads as a stall on exactly the panels people open most.
 *
 * `AnimatePresence initial={false}` keeps this out of the server HTML in both
 * directions. Closed, nothing renders at all. Open at first paint, the initial
 * animation is skipped — so no `height: 0` and no `opacity: 0` are ever written
 * into the markup, which is the rule every primitive in this folder obeys and
 * the reason any of them are allowed to be framer-motion.
 *
 * THE CURVE, NOT THE SPRING, and `overflow-hidden` is not optional. `height` is
 * a LAYOUT property: it cannot run on the compositor, and a spring overshooting
 * a height would relayout the page past its resting size and back again. That
 * is also why this is for PANELS — one thing a person opened — and never inside
 * a `.map()`. For a long list, animate opacity and transform, which cost
 * nothing.
 */
export function Expand({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
          className={cn('overflow-hidden', className)}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
}
