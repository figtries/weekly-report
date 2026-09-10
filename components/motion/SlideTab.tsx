'use client';

import { m } from 'framer-motion';

import { MOTION } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * The active pill, moving between tabs instead of blinking from one to the next.
 *
 * Render it ONLY inside the active trigger. React unmounts it from the old one
 * and mounts it in the new one, and the shared `layoutId` is what turns those
 * two events into a single continuous movement. There is no state here and no
 * measurement of any kind — framer-motion does the measuring, which is the
 * whole reason `domMax` is worth its extra weight.
 *
 * `id` MUST DIFFER PER TAB ROW. `layoutId` is global inside the provider, so
 * two rows sharing an id will pull each other's pill across the page. This app
 * uses 'section-tab' for SectionTabs and 'week-step' for the weekly stepper.
 *
 * `transition` is passed explicitly, and has to be: layout animations do NOT
 * read the default from `MotionConfig`. Leave it off and the pill slides on
 * framer-motion's own default rather than this app's spring.
 *
 * IT WRITES NOTHING INTO THE SERVER HTML — no `initial`, no `animate`, just a
 * span with a background. If the bundle never arrives, the active tab still
 * has its pill; it simply does not slide. That is the same standard every
 * entrance in this app is held to, and the reason this one is allowed to be
 * framer-motion at all.
 *
 * It grew out of the hand-rolled `layoutId="log-filter"` on the old Log screen
 * (since folded into the documents themselves). That one moved on the curve;
 * this moves on the spring, because a pill crossing a tab row is a thing
 * MOVING — which is precisely the distinction rule 2 in `lib/design.ts` draws.
 */
export function SlideTab({ id, className }: { id: string; className?: string }) {
  return (
    <m.span
      layoutId={id}
      transition={MOTION.spring}
      aria-hidden
      className={cn('absolute inset-0 -z-10 rounded-lg bg-background shadow-md ring-1 ring-black/5 dark:ring-white/10', className)}
    />
  );
}
