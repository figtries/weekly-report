'use client';

import { AnimatePresence, m } from 'framer-motion';
import type { ReactNode } from 'react';
import { MOTION } from '@/lib/design';

/**
 * The part of a row that opens and closes.
 *
 * Two motions on two elements, on purpose. The outer one animates HEIGHT (the only
 * thing that pushes the rows below), with `contain: layout paint` so the browser does
 * not re-lay-out the panel's own children on every frame of it; the inner one moves the
 * content up a few pixels while it fades, so it arrives instead of being uncovered.
 * The curve is the app's own (`MOTION.ease`); opacity is quicker than height, which is
 * what makes the closing read as one soft movement rather than a shrinking box.
 */
export function Panel({ id, open, children }: { id: string; open: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          id={id}
          key="panel"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.36, ease: [...MOTION.ease] },
            opacity: { duration: 0.22, ease: 'easeOut' },
          }}
          style={{ overflow: 'hidden', contain: 'layout paint' }}
        >
          <m.div
            initial={{ y: -8 }}
            animate={{ y: 0 }}
            exit={{ y: -6 }}
            transition={{ duration: 0.36, ease: [...MOTION.ease] }}
            className="px-4 pb-4 pt-1 sm:pl-[50px] sm:pr-5"
          >
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
