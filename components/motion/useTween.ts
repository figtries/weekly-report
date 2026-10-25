'use client';

import { useEffect, useRef, useState } from 'react';
import { MOTION } from '@/lib/design';

/**
 * Numbers that GLIDE to their new values instead of being swapped.
 *
 * Picking another week on the dashboard keeps every card mounted (same route,
 * only `?week=` changes), so without this the figures, the curve and its dots
 * were replaced in one frame and the page read as a slide being changed
 * (25 Oct 2026, variant C of three he compared: the cards stay still, only
 * what is inside them moves).
 *
 * The first render returns the target itself, so the server HTML carries the
 * real figures and nothing waits on hydration. A change mid-glide starts from
 * where the glide had got to. Reduced motion lands in one frame.
 */
export function useTween(target: number[], seconds = MOTION.enter): number[] {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const key = target.join(',');

  useEffect(() => {
    const start = from.current;
    const ms =
      start.length !== target.length || matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : seconds * 1000;
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = ms ? Math.min(1, (t - t0) / ms) : 1;
      // Ease-out quart: close to --ease-out-expo's fast start and soft landing.
      const e = 1 - Math.pow(1 - k, 4);
      const v = k === 1 ? target : target.map((b, i) => start[i] + (b - start[i]) * e);
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // `key` is the target's identity; the array itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seconds]);

  return shown;
}
