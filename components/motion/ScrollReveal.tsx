'use client';

import { useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * A section that arrives as it is scrolled to.
 *
 * THE ORDER OF OPERATIONS IS THE FEATURE. The obvious way to build this is to
 * ship the element hidden and let a script reveal it; this component does the
 * opposite, and refuses to hide anything until an IntersectionObserver has
 * confirmed the element is entirely below the fold. Two failures come out of
 * that choice for free:
 *
 *   - A phone that never receives the bundle — the field crew's actual
 *     connection — renders the page complete instead of blank below the fold.
 *     This is the same failure `components/motion/Reveal.tsx` was written
 *     about, where six elements shipped at `opacity: 0` and nothing was
 *     visible until hydration finished.
 *   - Someone who scrolls faster than hydration never watches content vanish
 *     from under their finger, because anything they can already see is
 *     released rather than armed.
 *
 * ONE OBSERVER FOR THE WHOLE APP. Not one per element: a dashboard has a dozen
 * of these, and a dozen observers is a dozen sets of callbacks the browser
 * services on every scroll frame. The module-level instance below is shared,
 * created on first use, and each element is unobserved the moment it is done —
 * so a page that has finished revealing costs exactly nothing to scroll.
 *
 * NO SCROLL LISTENER, deliberately. IntersectionObserver reports off the main
 * thread and hands back a `boundingClientRect` that is already measured, so
 * nothing here reads layout and nothing here runs at 60Hz.
 *
 * The visual values live in `.scroll-reveal` in globals.css and are identical
 * to `.animate-enter`, so a section looks the same whether it arrived by load
 * or by scroll. `delay` takes a `.stagger-N` class from the same file.
 */

/**
 * ONE OBSERVER PER SCROLLER, not one for the viewport.
 *
 * This app does not scroll the document — `<main>` scrolls, and inside the
 * weekly report and Document Control a second div scrolls within that. An
 * observer rooted at the viewport is still CLIPPED BY THOSE ANCESTORS, which
 * no `rootMargin` can reach past, so an element scrolled above the scroller's
 * visible area simply stopped being reported. Rooting each observer at the
 * scroller it belongs to is what makes the margins below mean anything.
 *
 * There are two or three scrollers in the whole app, so this Map holds two or
 * three observers, not one per element.
 */
const observers = new Map<Element | null, IntersectionObserver>();

/** The nearest ancestor that actually scrolls, or null for the viewport. */
function scrollerOf(el: Element): Element | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function observer(root: Element | null): IntersectionObserver {
  const existing = observers.get(root);
  if (existing) return existing;
  const shared: IntersectionObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement;

      if (entry.isIntersecting) {
        // Anywhere from the fold line upwards — see the rootMargin below, which
        // is what makes "already scrolled past" count as intersecting too. If
        // the element was armed this transitions it in; if it never was, this
        // is a no-op, because `.is-in` styles nothing without `.scroll-reveal`
        // beside it.
        el.classList.add('is-in');
        shared.unobserve(el);
        continue;
      }

      if (el.dataset.revealArmed) continue;

      // Not intersecting and not yet armed. Only something entirely BELOW the
      // fold may be hidden: an element merely clipped at the bottom edge also
      // reads as not intersecting once the rootMargin is applied, and hiding
      // one of those would blank a card the user is looking at.
      const fold = entry.rootBounds?.bottom ?? window.innerHeight;
      if (entry.boundingClientRect.top < fold) {
        shared.unobserve(el);
        continue;
      }

      el.dataset.revealArmed = '1';
      el.classList.add('scroll-reveal');
    }
  }, {
    root,
    // ASYMMETRIC, and the top half is a bug fix rather than taste.
    //
    // Bottom: held back 8% from the edge so a section is a clear part of the
    // page before it moves, rather than animating in the corner of the eye at
    // the moment it clears the edge.
    //
    // Top: opened up practically without limit, so that everything from the
    // fold line UPWARDS counts as intersecting — including what has already
    // been scrolled past. Without it an element the viewport JUMPS OVER is
    // never reported at all: an observer only calls back when the intersection
    // STATE changes, and such an element is not intersecting before the jump
    // and not intersecting after it, so it stays hidden for the rest of the
    // session. Scroll restoration on a back navigation does this every time,
    // and so does a hard flick on a phone. A test caught it going straight to
    // the bottom of the dashboard and leaving the first block blank. Handling
    // it in the callback was the wrong layer — an entry that never arrives
    // cannot be reasoned about; the geometry is where the answer is.
    rootMargin: '10000px 0px -8% 0px',
  });
  observers.set(root, shared);
  return shared;
}

export function ScrollReveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  /** 1-8, mapping to `.stagger-N`. Siblings revealing together. */
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Reduced motion gets the content and none of the movement — not a
    // stillness that has to be scrolled into.
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const io = observer(scrollerOf(el));
    io.observe(el);
    return () => io.unobserve(el);
  }, []);

  return (
    <div ref={ref} className={cn(delay > 0 && `stagger-${delay}`, className)}>
      {children}
    </div>
  );
}
