'use client';

import { m } from 'framer-motion';
import Link from 'next/link';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { MOTION } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * A `next/link` that can take motion props.
 *
 * CREATED AT MODULE SCOPE, ONCE. `m.create()` inside a render returns a new
 * component type on every pass, and React unmounts and remounts the whole
 * subtree when a type changes — which for a nav link means losing focus mid
 * keyboard-navigation and replaying every entrance.
 *
 * It exists because a great many pressable things in this app are LINKS, not
 * buttons — the sidebar, the tab rows, the stepper. Wrapping each in a div
 * would work and would also add a node, change the layout box and break the
 * flex rows they sit in.
 */
export const PressLink = m.create(Link);

/**
 * The press response, as props rather than as a wrapper.
 *
 * SPREAD THIS ONTO `m.button`, DO NOT WRAP THE BUTTON IN A DIV. A wrapper adds
 * a DOM node, changes the layout box, and drops every button concern on the
 * floor — `disabled`, `type`, `form`, the ref, the focus ring, the fact that a
 * screen reader knows what it is. Turning `<button>` into
 * `<m.button {...pressMotion}>` keeps all of it and costs one word per site.
 *
 * 0.97 is the number this app already used, scattered across call sites as
 * `active:scale-[0.97]`. The value does not change here; its home does.
 *
 * REMOVE `active:scale-[0.97]` AND ANY `transition-all` FROM WHATEVER TAKES
 * THIS. Two systems scaling one element fight each other: the class writes
 * `transform` through CSS, framer-motion writes it inline, and what you see is
 * a press that stutters halfway down. One thing, one mover.
 *
 * HOVER IS DELIBERATELY NOT HERE. The design called for hover to raise a
 * shadow, and the app's existing `hover:` classes already do exactly that — in
 * CSS, where a shadow change belongs. Animating `box-shadow` from JavaScript
 * repaints every frame, which is the opposite of what this layer is for. Hover
 * also never happens on the phone this app is tested on first, and AGENTS.md
 * forbids hover from ever carrying information, so nothing is lost by leaving
 * it to the stylesheet.
 *
 * The spring rather than the curve: a press is the one small thing that really
 * is MOVING, and the settle is what makes it feel answered rather than merely
 * acknowledged.
 */
export const pressMotion = {
  whileTap: { scale: 0.97 },
  transition: MOTION.spring,
} as const;

/**
 * For a clickable surface that is not a button — a card, a tile, a row that
 * navigates. Same response, and it forwards className so the caller's layout
 * is untouched.
 *
 * Not for use inside a `.map()` that can exceed ~20 rows: the cost of motion is
 * in the number of mounted instances, exactly as it is with Radix. Long lists
 * keep their CSS `active:` class.
 */
export function Press({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & ComponentPropsWithoutRef<typeof m.div>) {
  return (
    <m.div {...pressMotion} className={cn(className)} {...rest}>
      {children}
    </m.div>
  );
}
