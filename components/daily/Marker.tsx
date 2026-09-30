'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Check } from 'lucide-react';
import type { SectionState } from '@/lib/daily-status';
import { MOTION } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * Where a part of the report stands, as one round mark instead of a labelled chip.
 * The colours are the pairs the status meters elsewhere in the app already use
 * (emerald done, blue "on track", amber "slightly behind", gray "not started").
 * The mark changes with a short pop, so pressing Confirm visibly lands.
 */
const RING: Record<SectionState, string> = {
  ready: 'bg-emerald-500 text-white',
  same: 'border-2 border-blue-500 bg-card',
  look: 'bg-amber-100 text-amber-700',
  empty: 'border-2 border-dashed border-gray-300 bg-card',
};

export function Marker({ state }: { state: SectionState }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex size-[22px] shrink-0 items-center justify-center rounded-full transition-[background-color,border-color] duration-300 ease-ios',
        RING[state]
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={state}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.4, opacity: 0 }}
          transition={MOTION.spring}
          className="flex items-center justify-center"
        >
          {state === 'ready' ? (
            <Check className="size-3.5" strokeWidth={3} />
          ) : state === 'same' ? (
            <span className="size-2 rounded-full bg-blue-500" />
          ) : state === 'look' ? (
            <span className="text-[13px] font-semibold leading-none">!</span>
          ) : null}
        </m.span>
      </AnimatePresence>
    </span>
  );
}
