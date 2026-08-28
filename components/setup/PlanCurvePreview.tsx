'use client';

import { useMemo } from 'react';

/**
 * The moment the wizard exists for: the plan curve appearing from nothing but
 * dates and weights.
 *
 * Drawn with `stroke-dasharray` / `stroke-dashoffset` rather than an animation
 * library — the line has a known length, so CSS can reveal it for free. That
 * keeps the one genuinely persuasive animation in the app at zero bundle cost
 * (see AGENTS.md).
 */

const W = 900;
const H = 260;
const PAD = { l: 34, r: 12, t: 12, b: 24 };

export default function PlanCurvePreview({
  series,
  totalWeeks,
}: {
  series: { week: number; planPct: number }[];
  totalWeeks: number;
}) {
  const { path, area, ticks, redrawKey } = useMemo(() => {
    const iw = W - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (w: number) => PAD.l + ((w - 1) / Math.max(1, totalWeeks - 1)) * iw;
    const y = (v: number) => PAD.t + ih - (Math.min(100, Math.max(0, v)) / 100) * ih;

    const pts = series.map((s) => `${x(s.week).toFixed(1)} ${y(s.planPct).toFixed(1)}`);
    const path = pts.length ? `M${pts.join(' L')}` : '';
    const area = pts.length
      ? `${path} L${x(series[series.length - 1].week).toFixed(1)} ${(PAD.t + ih).toFixed(1)} L${x(1).toFixed(1)} ${(PAD.t + ih).toFixed(1)} Z`
      : '';

    const step = totalWeeks <= 16 ? 2 : totalWeeks <= 60 ? 10 : 20;
    const ticks: { w: number; x: number }[] = [];
    for (let w = 1; w <= totalWeeks; w += step) ticks.push({ w, x: x(w) });
    if (ticks[ticks.length - 1]?.w !== totalWeeks) {
      ticks.push({ w: totalWeeks, x: x(totalWeeks) });
    }

    // Re-mounting on any shape change is what makes the line redraw when the
    // user edits a date — an update in place would just snap to the new path.
    const redrawKey = `${totalWeeks}:${series.length}:${series
      .map((s) => Math.round(s.planPct * 10))
      .join(',')}`;

    return { path, area, ticks, redrawKey };
  }, [series, totalWeeks]);

  if (!path) return null;

  return (
    <div className="overflow-hidden rounded-md border bg-background p-2">
      <svg
        key={redrawKey}
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`Plan curve over ${totalWeeks} weeks`}
      >
        {[0, 25, 50, 75, 100].map((t) => {
          const yy = PAD.t + (H - PAD.t - PAD.b) - (t / 100) * (H - PAD.t - PAD.b);
          return (
            <g key={t}>
              <line
                x1={PAD.l}
                y1={yy}
                x2={W - PAD.r}
                y2={yy}
                stroke="currentColor"
                strokeWidth={1}
                className="text-border"
              />
              <text
                x={PAD.l - 6}
                y={yy + 3.5}
                textAnchor="end"
                fontSize={9}
                fill="currentColor"
                className="text-muted-foreground"
                fontFamily="ui-monospace, monospace"
              >
                {t}
              </text>
            </g>
          );
        })}

        {ticks.map((t) => (
          <text
            key={t.w}
            x={t.x}
            y={H - 7}
            textAnchor="middle"
            fontSize={9}
            fill="currentColor"
            className="text-muted-foreground"
            fontFamily="ui-monospace, monospace"
          >
            {t.w}
          </text>
        ))}

        <path d={area} className="fill-primary/8 [animation:curve-fill_.5s_var(--ease-gentle)_.35s_both]" />
        <path
          d={path}
          fill="none"
          strokeWidth={2.2}
          strokeLinejoin="round"
          strokeLinecap="round"
          className="stroke-primary [animation:curve-draw_.85s_var(--ease-out-expo)_both] [stroke-dasharray:1400] motion-reduce:[animation:none] motion-reduce:[stroke-dashoffset:0]"
        />
      </svg>
    </div>
  );
}
