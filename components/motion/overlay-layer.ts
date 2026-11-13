'use client';

import { useId, type CSSProperties } from 'react';

/**
 * Every overlay portalled to <body> (sheet, dialog, menu, drawer) wears this.
 *
 * A route change runs a view transition, and each page is its own named layer
 * (`RouteTransition`). Named layers paint ABOVE the root layer, and a portal on
 * <body> is part of the root: so when a press inside a sheet navigates ("Set in
 * plan" opens the Gantt), the old page's snapshot fading out was drawn OVER the
 * sheet, and the page's cards and filters showed through it (Nov 2026, iPhone).
 * Its own layer, raised by `.overlay` in globals.css, puts it back on top.
 *
 * `kind` is how it leaves: a menu, dialog or scrim fades; a sheet slides away
 * solid the way it closes (`side`: down on a phone, right from sm; `card`:
 * down, sinking from sm; `drawer`: right). Put a sheet's kind on the sliding
 * panel and a plain layer on its scrim, never one on a wrapper holding both.
 *
 * The name is per instance because two layers with one name abort the whole
 * transition (a confirm dialog over a sheet would otherwise do that).
 */
/*
 * An overlay that OPENS after a transition has captured its pages (the planner
 * opening a row's kind view from `#open=kind` once it arrives) is not in any
 * snapshot: it lands in the live root layer, under the arriving page's, and the
 * page's toolbar and rows were drawn over the rising sheet (Nov 2026). Its name
 * comes too late to be captured, so the transition is ended instead: the page
 * shows as it is and the overlay plays its own entrance.
 */
let running: Promise<void> | null = null;
const clear = () => {
  running = null;
};

/**
 * Resolves when the route change now playing has finished (at once if none is).
 * An overlay the ARRIVAL opens waits for this, so it rises over a page that has
 * landed instead of cutting the transition short.
 */
export function routeSettled(): Promise<void> {
  return running ?? Promise.resolve();
}

if (typeof document !== 'undefined' && document.startViewTransition && !('__ovPatched' in document)) {
  Object.assign(document, { __ovPatched: true });
  const start = document.startViewTransition.bind(document);
  const OVERLAY = '[style*="view-transition-name: ov-"]';
  document.startViewTransition = ((arg?: Parameters<typeof start>[0]) => {
    const t = start(arg);
    running = t.finished.then(clear, clear);
    t.ready.then(() => {
      const watch = new MutationObserver((list) => {
        for (const r of list)
          for (const n of r.addedNodes)
            if (n instanceof Element && (n.matches(OVERLAY) || n.querySelector(OVERLAY))) {
              watch.disconnect();
              t.skipTransition();
              return;
            }
      });
      watch.observe(document.body, { childList: true, subtree: true });
      const stop = () => watch.disconnect();
      t.finished.then(stop, stop);
    }, () => {});
    return t;
  }) as typeof document.startViewTransition;
}

export function useOverlayLayer(kind?: 'side' | 'card' | 'drawer'): CSSProperties {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return { viewTransitionName: `ov-${id}`, viewTransitionClass: kind ? `overlay ${kind}` : 'overlay' };
}
