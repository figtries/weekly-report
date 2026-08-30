'use client';

import { LazyMotion, MotionConfig, domMax } from 'framer-motion';
import type { ReactNode } from 'react';

import { MOTION } from '@/lib/design';

/**
 * The one framer-motion provider, and the fence around it.
 *
 * IT WRAPS THE WHOLE BODY, NOT `<main>`. `Sidebar` and `StorageWarning` are
 * SIBLINGS of `<main>` in `app/layout.tsx`, not children of it. A provider
 * around `<main>` alone leaves the app's primary navigation outside it, where
 * `m.*` renders with no features and simply sits still — and it does that
 * SILENTLY, with no error, no warning and no visual clue beyond a button that
 * does not respond. The boundary has to be right the first time, because
 * nothing will tell you it is wrong.
 *
 * `strict` IS THE POINT. It makes `motion.*` throw, so the only way to animate
 * anything is `m.*`, and the only way to reach a curve or a duration is
 * `MOTION`. Without it "one curve" dies quietly: in six months there are three
 * durations in the app and nobody knows which is correct. That is the exact
 * disease `lib/design.ts` was written to prevent, and a convention nobody
 * enforces is not a cure — it is the same convention, one more time.
 *
 * `domMax` and not `domAnimation`, at a cost of about 13kb. What it buys is
 * `layoutId`, the only thing in this whole layer that genuinely cannot be
 * built another way.
 *
 * `reducedMotion="user"` handles `prefers-reduced-motion` for all of
 * framer-motion in one place, so no component needs its own opinion about it.
 * The `@media (prefers-reduced-motion: reduce)` block in globals.css still
 * covers the CSS side, which is most of the app's motion.
 *
 * NO HOOKS, DELIBERATELY. The last client component to sit at this height read
 * `usePathname()` and killed the build on `/print/daily/[date]`: under
 * `cacheComponents` the pathname is uncached data, and reading it in the root
 * layout blocks every route in the app — including routes that have nothing to
 * do with navigation. `children` arrives already rendered from the server and
 * stays that way.
 *
 * The default transition below applies to PROPERTY animations only. `layout`
 * and `layoutId` carry their own and ignore it — see the note on
 * `MOTION.spring`.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig
        reducedMotion="user"
        // Spread, not a bare `MOTION.ease` — the token is a readonly tuple and
        // framer-motion wants a mutable one. Spreading keeps the arity, so this
        // stays type-safe rather than being cast past the checker.
        transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
