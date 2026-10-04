'use client';

import { useId } from 'react';

import type { WeekPoint } from '@/lib/register-shared';

/** One decimal, rounded the way the Summary's own figures are. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A MONOTONE cubic through the weekly points — the same Fritsch-Carlson curve
 * the dashboard's `ProgressCurve` draws, and the reasoning is its: a polyline
 * reads as a flight of stairs, and a loose spline overshoots, which here would
 * draw progress the register never made. This one cannot leave the range of
 * the two points it sits between, and a flat week stays flat.
 */
function smoothPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  const at = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${at(p)}`).join(' ');

  const n = pts.length;
  const dx = Array.from({ length: n - 1 }, (_, i) => pts[i + 1].x - pts[i].x);
  const slope = Array.from({ length: n - 1 }, (_, i) => (pts[i + 1].y - pts[i].y) / dx[i]);
  const m = [slope[0], ...Array.from({ length: n - 2 }, (_, i) => (slope[i] + slope[i + 1]) / 2), slope[n - 2]];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let d = `M ${at(pts[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C ${at({ x: pts[i].x + h, y: pts[i].y + m[i] * h })}`
      + ` ${at({ x: pts[i + 1].x - h, y: pts[i + 1].y - m[i + 1] * h })}`
      + ` ${at(pts[i + 1])}`;
  }
  return d;
}

/**
 * Planned against actual, week by week.
 *
 * Both lines are counted from the dates already in the register — the promised
 * submission date for one, the real one for the other. The client's own summary
 * keeps this as a hand-typed block of thirteen columns where only the last is a
 * formula; the numbers below cannot go stale in that way because nothing about
 * them is stored.
 *
 * Actual is blue, plan is red — `#3b82f6` and `#ef4444`, the exact pair
 * `SCurveClient` uses on the weekly report, down to the gradient under the
 * actual area. A reader who learned the convention there must not have to
 * relearn it here, so this is not a colour to restyle: it is the only thing
 * telling the two lines apart.
 *
 * THE CUT-OFF is drawn the way the dashboard and the weekly S-curve draw it
 * (4 Oct 2026): a dashed rule at the week being viewed, a dot on each line
 * there, and the figure beside each dot, so the gap is read off the chart. The
 * plan runs on past the rule to its last promise; the actual stops at it. The
 * figures print to one decimal because the hero above prints them so — the
 * chip and the headline must never disagree.
 *
 * The labels are HTML and only the lines are SVG, on a `0 0 100 100` viewBox
 * stretched with `preserveAspectRatio="none"`. A single scaled SVG would have
 * shrunk its own text to about five pixels at 390px — the axis was unreadable
 * on the phone this app is built for. Stretching distorts the geometry, which a
 * line chart does not mind, and `non-scaling-stroke` keeps the lines an even
 * width through it; the dots are HTML too, because a stretched circle is an
 * ellipse.
 */
export function RegisterCurve({
  series,
  asOfWeek,
  undated = 0,
}: {
  series: WeekPoint[];
  asOfWeek: number;
  /** Submissions with no date — placed by estimate, and said so below. */
  undated?: number;
}) {
  const uid = useId();
  if (series.length < 2) return null;

  const first = series[0].weekNo;
  const last = series[series.length - 1].weekNo;
  const x = (week: number) => ((week - first) / Math.max(1, last - first)) * 100;
  const y = (pct: number) => 100 - pct;

  const actualPoints = series.filter((p) => p.weekNo <= asOfWeek);
  const planPoints = series.filter((p) => p.plan !== null);

  const actualPath = smoothPath(actualPoints.map((p) => ({ x: x(p.weekNo), y: y(p.actual) })));
  const planPath = planPoints.length > 1
    ? smoothPath(planPoints.map((p) => ({ x: x(p.weekNo), y: y(p.plan!) })))
    : null;

  // The cut-off: the last week the actual was measured, which is the week
  // being viewed unless the curve has not reached it.
  const cut = actualPoints[actualPoints.length - 1];
  const cutX = cut ? x(cut.weekNo) : null;
  const endActual = cut ? r1(cut.actual) : null;
  const endPlan = cut && planPath && cut.plan !== null ? r1(cut.plan) : null;

  // The higher figure writes its chip ABOVE its dot and the lower BELOW, so the
  // two part however close the lines finish — the same rule as the S-curve.
  type End = { name: 'Actual' | 'Plan'; value: number };
  const ends: End[] = [
    ...(endActual !== null ? [{ name: 'Actual' as const, value: endActual }] : []),
    ...(endPlan !== null ? [{ name: 'Plan' as const, value: endPlan }] : []),
  ].sort((a, b) => b.value - a.value || (a.name === 'Actual' ? -1 : 1));
  const upper = ends[0];
  const lower = ends[1];

  // Chip geometry in px, against a plot whose height changes with the screen,
  // so each `top` is CSS math over the dot's percentage. The upper chip may
  // rise into a band reserved above the plot (only when it needs one); the
  // lower one keeps clear of the upper and never drops under the axis.
  const CHIP = 18;
  const GAP = 8;
  const HEADROOM = 24;
  const headroom = upper !== undefined && upper.value > 84;
  const upperTop = upper ? `max(calc(${y(upper.value)}% - ${CHIP + GAP}px), ${headroom ? -HEADROOM : 0}px)` : '';
  const lowerTop = lower
    ? `max(calc(${upperTop} + ${CHIP + 4}px), min(calc(${y(lower.value)}% + ${GAP}px), calc(100% - ${CHIP}px)))`
    : '';
  // Chips sit on the side of the rule with room: the left, unless the cut-off
  // is so early in the plan that a chip there would run into the axis.
  const chipsLeft = cutX !== null && cutX > 35;
  const chipSide = cutX === null ? {} : chipsLeft
    ? { right: `calc(${100 - cutX}% + 12px)` }
    : { left: `calc(${cutX}% + 12px)` };

  const gridValues = [100, 75, 50, 25, 0];
  // The last week always gets a tick; a computed one that would land on top
  // of it is dropped, because two labels sharing a pixel is worse than five.
  // Measured where the labels are DRAWN (clamped off the edges), not where the
  // weeks fall: unclamped, W26 and W29 read as apart and printed "W26W29".
  const tickAt = (week: number) => Math.min(97, Math.max(3, x(week)));
  const step = Math.max(1, Math.ceil(series.length / 6));
  const tickWeeks = series
    .filter((_, i) => i % step === 0 || i === series.length - 1)
    .map((p) => p.weekNo)
    .filter((w) => w === last || tickAt(last) - tickAt(w) > 12);

  const gradientId = `${uid}-fill`;
  const clipId = `${uid}-wipe`;
  const figures = cut
    ? `; at week ${cut.weekNo} actual ${endActual!.toFixed(1)} percent${endPlan !== null ? ` against a plan of ${endPlan.toFixed(1)} percent` : ''}`
    : '';

  return (
    <figure className="w-full">
      <div className={headroom ? 'flex pt-6' : 'flex'}>
        {/* left gutter — real text, not scaled glyphs */}
        <div className="relative w-8 shrink-0">
          {gridValues.map((v) => (
            <span
              key={v}
              className="absolute right-1 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: `${y(v)}%` }}
            >
              {v}
            </span>
          ))}
          <span className="block h-48 sm:h-56 lg:h-72" />
        </div>

        <div className="relative h-48 flex-1 sm:h-56 lg:h-72">
          {gridValues.map((v) => (
            <span
              key={v}
              aria-hidden
              className="absolute inset-x-0 border-t border-border"
              style={{ top: `${y(v)}%`, borderTopStyle: v === 0 ? 'solid' : 'dashed' }}
            />
          ))}

          {/* Wiped in from the left by a CSS keyframe on a clip rect — the
              dashboard's `curve-wipe`, so the grid stays put and only the
              data sweeps in. Not framer-motion: an entrance written as
              `initial` ships hidden in the server HTML and, on the Summary,
              held the route's view transition at frame zero. Not `pathLength`
              either: framer-motion implements that with stroke-dasharray in
              user units, and on a stretched viewBox with non-scaling strokes it
              breaks both lines into ragged dashes. */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full overflow-visible text-foreground"
            role="img"
            aria-label={`Register plan and actual curve, week ${first} to ${last}${figures}`}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
              <clipPath id={clipId}>
                <rect className="animate-curve-wipe" x="-1" y="-1" width="102" height="102" />
              </clipPath>
            </defs>

            <g clipPath={`url(#${clipId})`}>
              {cut && (
                <path
                  d={`${actualPath} L ${x(cut.weekNo).toFixed(2)} 100 L 0 100 Z`}
                  fill={`url(#${gradientId})`}
                />
              )}

              {/* THE CUT-OFF: where measurement stops and everything to its
                  right is still to come. */}
              {cutX !== null && (
                <line
                  x1={cutX}
                  y1={0}
                  x2={cutX}
                  y2={100}
                  stroke="currentColor"
                  strokeOpacity="0.3"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {planPath && (
                <path
                  d={planPath}
                  fill="none"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  className="stroke-red-500"
                />
              )}

              <path
                d={actualPath}
                fill="none"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-blue-500"
              />
            </g>
          </svg>

          {/* The two ends, in HTML so they stay circles. The plan dot is the
              larger, so it still shows as a rim when the actual lands on it. */}
          {cut && cutX !== null && endPlan !== null && (
            <span
              aria-hidden
              className="pointer-events-none absolute z-10 block size-3.5 animate-dot-in rounded-full bg-red-500"
              style={{ left: `${cutX}%`, top: `${y(cut.plan!)}%`, animationDelay: '0.95s' }}
            />
          )}
          {cut && cutX !== null && (
            <span
              aria-hidden
              className="pointer-events-none absolute z-20 block size-2.5 animate-dot-in rounded-full bg-blue-500 ring-2 ring-card"
              style={{ left: `${cutX}%`, top: `${y(cut.actual)}%`, animationDelay: '0.95s' }}
            />
          )}

          {ends.map((end) => (
            <span
              key={end.name}
              aria-hidden
              className={
                'pointer-events-none absolute z-30 animate-fade-in-up whitespace-nowrap rounded-md bg-card/90 px-1.5 py-0.5 text-[11px] font-semibold leading-tight tabular-nums shadow-sm ring-1 ring-border/60 '
                + (end.name === 'Actual' ? 'text-blue-600' : 'text-red-600')
              }
              style={{
                ...chipSide,
                top: end === upper ? upperTop : lowerTop,
                animationDelay: end.name === 'Actual' ? '1.15s' : '1.05s',
              }}
            >
              {end.name} {end.value.toFixed(1)}%
            </span>
          ))}

          <div className="absolute inset-x-0 top-full pt-1.5">
            {tickWeeks.map((w) => (
              <span
                key={w}
                className="absolute -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground"
                style={{ left: `${tickAt(w)}%` }}
              >
                W{w}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-6 rounded-full bg-blue-500" /> <span className="font-medium text-blue-600">Actual</span>
        </span>
        {planPath && (
          <span className="flex items-center gap-2">
            <span className="h-0 w-6 border-t-2 border-red-500" />
            <span className="font-medium text-red-600">Plan</span>
          </span>
        )}
        {cut && (
          <span className="flex items-center gap-2">
            <span className="h-3 w-0 border-l border-dashed border-foreground/40" />
            <span>Cut-off W{cut.weekNo}</span>
          </span>
        )}
        {undated > 0 && (
          <span className="basis-full text-amber-700">
            {undated} submissions carry no date, so they sit on the week they were promised for and the
            shape there is an estimate.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
