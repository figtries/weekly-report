'use client';

import { useEffect, useRef, useState } from 'react';

export default function AnimatedNumber({
  value,
  decimals = 2,
  suffix = '',
  duration = 900,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      // Clamped at 0: a frame's timestamp is when the frame BEGAN, which can
      // be before `start`, and a negative t overshot backwards (the sidebar
      // card read -0.17% for one frame on its way from 0.00% to 1.15%).
      const t = Math.max(0, Math.min(1, (now - start) / duration));
      // ease-out-expo — races through the bulk of the change, then settles softly
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const at = from + (to - from) * eased;
      setDisplay(at);
      // Where it stands NOW, so a new value mid-flight carries on from here
      // instead of jumping back to where the last one started.
      fromRef.current = at;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className="tabular-nums">
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}
