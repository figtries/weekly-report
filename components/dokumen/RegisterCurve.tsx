'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useId } from 'react';

import { EASE } from '@/components/motion/Reveal';
import type { WeekPoint } from '@/lib/register-shared';

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
 * The labels are HTML and only the two lines are SVG, on a `0 0 100 100`
 * viewBox stretched with `preserveAspectRatio="none"`. A single scaled SVG
 * would have shrunk its own text to about five pixels at 390px — the axis was
 * unreadable on the phone this app is built for. Stretching distorts the
 * geometry, which a line chart does not mind, and `non-scaling-stroke` keeps
 * the lines an even width through it.
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
  const reduced = useReducedMotion();
  const gradientId = useId();
  if (series.length < 2) return null;

  const first = series[0].weekNo;
  const last = series[series.length - 1].weekNo;
  const x = (week: number) => ((week - first) / Math.max(1, last - first)) * 100;
  const y = (pct: number) => 100 - pct;

  const line = (points: Array<{ weekNo: number; value: number }>) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.weekNo).toFixed(2)} ${y(p.value).toFixed(2)}`).join(' ');

  const actualPoints = series.filter((p) => p.weekNo <= asOfWeek);
  const planPoints = series.filter((p) => p.plan !== null);

  const actualPath = line(actualPoints.map((p) => ({ weekNo: p.weekNo, value: p.actual })));
  const planPath = planPoints.length > 1
    ? line(planPoints.map((p) => ({ weekNo: p.weekNo, value: p.plan! })))
    : null;

  const lastActual = actualPoints[actualPoints.length - 1];
  const gridValues = [100, 75, 50, 25, 0];
  // The last week always gets a tick; a computed one that would land on top
  // of it is dropped, because two labels sharing a pixel is worse than five.
  const step = Math.max(1, Math.ceil(series.length / 6));
  const lastWeekNo = series[series.length - 1].weekNo;
  const tickWeeks = series
    .filter((_, i) => i % step === 0 || i === series.length - 1)
    .map((p) => p.weekNo)
    .filter((w, i, all) => w === lastWeekNo || x(lastWeekNo) - x(w) > 9 || i === all.length - 1);

  return (
    <figure className="w-full">
      <div className="flex">
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
          <span className="block h-48 sm:h-56" />
        </div>

        <div className="relative h-48 flex-1 sm:h-56">
          {gridValues.map((v) => (
            <span
              key={v}
              aria-hidden
              className="absolute inset-x-0 border-t border-border"
              style={{ top: `${y(v)}%`, borderTopStyle: v === 0 ? 'solid' : 'dashed' }}
            />
          ))}

          {/* Wiped in from the left rather than drawn with `pathLength`:
              framer-motion implements that with stroke-dasharray in user units,
              and on a stretched viewBox with non-scaling strokes it breaks both
              lines into ragged dashes. */}
          <motion.svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full text-foreground"
            role="img"
            aria-label={`Register plan and actual curve, week ${first} to ${last}`}
            initial={reduced ? false : { clipPath: 'inset(0 100% 0 0)' }}
            animate={{ clipPath: 'inset(0 0% 0 0)' }}
            transition={{ duration: 0.9, ease: EASE }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
              </linearGradient>
            </defs>

            {lastActual && (
              <path
                d={`${actualPath} L ${x(lastActual.weekNo).toFixed(2)} 100 L 0 100 Z`}
                fill={`url(#${gradientId})`}
              />
            )}

            {planPath && (
              <path
                d={planPath}
                fill="none"
                strokeWidth={2}
                strokeDasharray="6 5"
                strokeLinecap="round"
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
          </motion.svg>

          {/* the head of the curve, drawn in HTML so it stays a circle */}
          {lastActual && (
            <motion.span
              aria-hidden
              className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 ring-2 ring-background"
              style={{ left: `${x(lastActual.weekNo)}%`, top: `${y(lastActual.actual)}%` }}
              initial={reduced ? false : { scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.4, ease: EASE, delay: 0.9 }}
            />
          )}

          <div className="absolute inset-x-0 top-full pt-1.5">
            {tickWeeks.map((w) => (
              <span
                key={w}
                className="absolute -translate-x-1/2 text-[11px] tabular-nums text-muted-foreground"
                style={{ left: `${Math.min(97, Math.max(3, x(w)))}%` }}
              >
                W{w}
              </span>
            ))}
          </div>
        </div>
      </div>

      <figcaption className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-6 rounded-full bg-blue-500" /> <span className="font-medium text-blue-600">Actual</span> — where it got to
        </span>
        {planPath && (
          <span className="flex items-center gap-2">
            <span className="h-0 w-6 border-t-2 border-dashed border-red-500" />
            <span className="font-medium text-red-600">Plan</span> — where the promised dates said
            it would be
          </span>
        )}
        <span>both counted from the dates in the register — neither is typed in</span>
        {undated > 0 && (
          <span className="basis-full text-amber-700">
            {undated} submissions in the register carry no date — placed on the week they were
            promised for, so the curve’s shape there is an estimate.
          </span>
        )}
      </figcaption>
    </figure>
  );
}
