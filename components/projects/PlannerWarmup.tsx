'use client';

import { useEffect } from 'react';

/**
 * Fetches the planner's code while the list is sitting still.
 *
 * `<Link>` prefetch does not cover this. Under `cacheComponents` it fetches the
 * route's static SHELL, and the shell is server-rendered — it names no client
 * components, so nothing tells the browser about the planner's chunks. Traced
 * on a real click, they arrived 215 ms and 265 ms AFTER it, 119 KB of it, on
 * localhost: the browser only learns those files exist once the segment it just
 * asked for comes back and mentions them. On a phone that round trip is the
 * whole wait.
 *
 * So the list asks for them itself. A bare `import()` of the same modules the
 * planner renders resolves to the same chunks, and by the time anyone taps a
 * project they are already in the HTTP cache. Nothing is rendered and nothing
 * is held — the import is for its side effect on the network.
 *
 * Three guards, each with a reason:
 *
 * **`requestIdleCallback`**, so this never competes with the list's own first
 * paint. It is the page in front of the user that wins.
 *
 * **`saveData` and `2g`**, because a person who has asked their phone to spend
 * less has not asked for 119 KB of a page they may never open.
 *
 * **`hasProjects`**, since an empty workspace has nothing to open and warming
 * the planner for it is pure cost.
 */
export default function PlannerWarmup({ hasProjects }: { hasProjects: boolean }) {
  useEffect(() => {
    if (!hasProjects) return;

    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
      .connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /2g/.test(conn.effectiveType)) return;

    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      // The three that carry the weight. RowMenu, BarStyleEditor and PasteRows
      // are left out on purpose: they are behind a tap the planner has not
      // received yet, and pulling them here would spend the quiet moment on
      // code that is not on the path to first paint.
      void import('./ScheduleSheet');
      void import('./GanttChart');
      void import('./ValueStrip');
    };

    const ric = window.requestIdleCallback;
    if (ric) {
      const id = ric(warm, { timeout: 2500 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback?.(id);
      };
    }

    // Safari had no requestIdleCallback until 17, and this app is tested on
    // iPhone first. A timeout after the load event is the same intent.
    const id = window.setTimeout(warm, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [hasProjects]);

  return null;
}
