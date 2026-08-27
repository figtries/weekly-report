'use client';

import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

/**
 * The app's one entrance animation.
 *
 * Every transition in v2 comes from framer-motion, and every one of them uses
 * the curve and duration defined here — the same `--ease-ios` the CSS
 * transitions already use, so a card appearing and a button pressing feel like
 * the same product. Item 07 formalises this into the design system; until then
 * this is the single place a duration is allowed to be written down.
 *
 * `delay` staggers a list. Keep it under ~0.3s in total: past that the page
 * stops feeling responsive and starts feeling slow, which is the opposite of
 * what motion is for on a screen someone opens forty times a week.
 */

/** cubic-bezier(0.32, 0.72, 0, 1) — the iOS sheet curve, matching globals.css. */
export const EASE = [0.32, 0.72, 0, 1] as const;
export const DURATION = 0.42;

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();

  // Someone who has asked for less motion gets the content, not a compromise.
  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A number that counts up to its value. Used only for the two or three figures
 * a page is actually about — on every number it becomes noise, and on a table
 * it becomes a performance problem.
 */
export function CountUp({ value, suffix = '%', decimals = 2 }: { value: number; suffix?: string; decimals?: number }) {
  const reduced = useReducedMotion();
  const text = `${value.toFixed(decimals).replace('.', ',')}${suffix}`;

  if (reduced) return <span className="tabular-nums">{text}</span>;

  return (
    <motion.span
      className="tabular-nums"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION, ease: EASE }}
    >
      {text}
    </motion.span>
  );
}
