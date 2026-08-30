'use client';

import { AnimatePresence, m } from 'framer-motion';
import type { ReactNode } from 'react';

import { MOTION } from '@/lib/design';

/**
 * One drill level, arriving from the side it came from — and the one it
 * replaces LEAVING, which is the part CSS could never do.
 *
 * `.animate-level-fwd` / `.animate-level-back` could only ever animate the
 * INCOMING level, because React had already removed the outgoing one before any
 * keyframe could run on it. So a level did not replace another level: one
 * vanished, and then one appeared. Here the two move together, which is what
 * makes going a level deeper read as travel rather than as a redraw.
 *
 * `initial={false}` ON `AnimatePresence` IS THE ENTIRE REASON THIS IS ALLOWED
 * TO BE framer-motion. The comments this file replaces rejected the library
 * because `motion.div` writes its `initial` prop into the SERVER HTML, and the
 * whole first level shipped at `opacity: 0` — invisible until hydration
 * finished, on the field crew's connection. `initial={false}` writes nothing:
 * the first mount appears exactly as it is, in the first paint, with no
 * animation at all. Every mount after that one is a real person's click on a
 * live page, which is precisely where framer-motion belongs. The objection is
 * answered at its source rather than worked around.
 *
 * `mode="popLayout"` takes the outgoing level out of flow, so the two slide
 * across each other instead of stacking and shoving the page down a screenful
 * mid-animation.
 *
 * The spring rather than the curve: a whole level is a thing MOVING.
 *
 * THE LEVEL ANIMATES AS ONE BLOCK, and must keep doing so. It was once one
 * `animate-fade-in-up` per card with a computed delay, and a folder here can
 * hold 89 activities — the last of them arriving three and a half seconds in.
 * Do not reintroduce a per-card stagger.
 */
export function Swap({
  levelKey,
  direction,
  children,
  className,
}: {
  levelKey: number | string;
  direction: 'fwd' | 'back';
  children: ReactNode;
  className?: string;
}) {
  const dx = direction === 'fwd' ? 32 : -32;
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <m.div
        key={levelKey}
        initial={{ opacity: 0, x: dx }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -dx }}
        transition={MOTION.spring}
        className={className}
      >
        {children}
      </m.div>
    </AnimatePresence>
  );
}
