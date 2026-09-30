'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { Reveal } from '@/components/motion/Reveal';
import { Card, CardContent } from '@/components/ui/card';
import { TYPE } from '@/lib/design';
import { cn } from '@/lib/utils';
import type { SCurveRow } from '@/lib/scurve';
import type { ProjectInfo } from '@/lib/types';

/**
 * The two lines the whole app exists to draw.
 *
 * EVERY COLOUR HERE IS A TOKEN, including the ones inside the SVG. Recharts
 * writes `stroke` / `stop-color` as SVG presentation attributes, and browsers
 * parse those as CSS declarations — so `var(--chart-1)` resolves in them, and
 * the chart follows the light/dark palette instead of carrying its own
 * hard-coded `#3b82f6` and `#eef2f7` — the chart now draws the same blue and
 * the same red as the bars, the S-Curve legend and the figure rows, from the
 * same two variables, instead of a pair of hexes that could drift.
 *
 * Recharts' own draw animation is switched OFF. It runs on its own duration and
 * its own easing keyword — a curve the app cannot write down in
 * `lib/design.ts` — so it was a third animation system beside framer-motion and
 * the CSS transitions. The entrance is the card's `Reveal`, on the one curve.
 *
 * THE PLOT IS SIZED, THE CARD IS NOT STRETCHED. This used to be a
 * viewport-height flex column: the card took `h-full`, the chart was its only
 * growing child, and the four figures underneath lived on whatever was left.
 * The moment the page gained a header there was not enough left — and shadcn's
 * Card carries `overflow-hidden`, so instead of scrolling, the row of figures
 * was CUT OFF mid-digit on a 1080px window.
 *
 * The height is now the plot's own, computed from the window rather than
 * inherited from it. `--plot-gap` is what everything above and around the plot
 * costs: the step row, the tab row, the page title, the card's padding, its own
 * title and the figures beneath it. Subtracting that from `dvh` means the card
 * ENDS at the fold — the curve and the four readings it explains stay one
 * object on a 720px laptop and on a phone, which a plain fixed height could not
 * manage (measured: 21px of scroll at 1917x900, 201px at 1280x720). The clamp
 * stops it collapsing on a short window and stops it dominating a tall one.
 *
 * The gap is bigger below `sm` because the four figures wrap to two rows there
 * and the step row above is taller — one constant for both left the phone 31px
 * short.
 *
 * `dvh` not `vh`: on iOS Safari `vh` counts the collapsible browser bars, so
 * the card would run under them exactly on the device this app is tested on
 * first.
 */
/**
 * One line's figure at the cut-off: a dot on the line and a chip to its left
 * ("Actual 51.42%"), above or below the dot. The chip is SVG because Recharts'
 * plot is not stretched (unlike the dashboard curve's viewBox), so its text keeps
 * its size. The plan dot is the larger of the two so it still shows as a rim if
 * the actual lands on top of it.
 */
function EndMark({
  cx,
  cy,
  name,
  value,
  color,
  above,
  delay,
}: {
  cx: number;
  cy: number;
  name: string;
  value: number;
  color: string;
  above: boolean;
  delay: string;
}) {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return <g />;
  const text = `${name} ${value.toFixed(2)}%`;
  const h = 24;
  const w = text.length * 6.9 + 16;
  const x = cx - 12 - w;
  const y = above ? cy - 10 - h : cy + 10;
  const plan = name === 'Plan';
  return (
    <g className="animate-fade-in-up" style={{ animationDelay: delay }} pointerEvents="none">
      <circle cx={cx} cy={cy} r={plan ? 7 : 5} fill={color} stroke="var(--card)" strokeWidth={plan ? 0 : 2} />
      <rect x={x} y={y} width={w} height={h} rx={6} fill="var(--card)" fillOpacity={0.94} stroke="var(--border)" />
      <text
        x={x + w / 2}
        y={y + h / 2 + 4}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill={color}
      >
        {text}
      </text>
    </g>
  );
}

export default function SCurveClient({
  series,
  currentWeek,
  planPct,
  actualPct,
}: {
  series: SCurveRow[];
  currentWeek: number;
  planPct: number | null;
  actualPct: number | null;
  project: ProjectInfo;
}) {
  // Anchor both lines at the same 0% origin so they start aligned.
  const chartData = [
    { week: 'W0', plan: 0, actual: 0 },
    ...series.map((r) => ({ week: `W${r.week}`, plan: r.planPct, actual: r.actualPct })),
  ];
  const variance = planPct !== null && actualPct !== null ? actualPct - planPct : null;

  // Scale the Y axis to the data (rounded up to the next multiple of 5) so the
  // curve fills the chart without touching the top edge.
  const maxVal = chartData.reduce((m, d) => Math.max(m, d.plan ?? 0, d.actual ?? 0), 0);
  const yMax = Math.min(100, Math.max(20, Math.ceil((maxVal + 1) / 5) * 5));
  const yStep = [10, 15, 20, 25].find((s) => yMax % s === 0 && yMax / s <= 6) ?? yMax / 5;
  const yTicks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);

  const axisTick = { fontSize: 12, fill: 'var(--muted-foreground)' };

  // THE CUT-OFF: the last week each line was measured, where the report stops.
  // Same idea as the dashboard's curve: a dot on each line at that week, and the
  // figure written beside it, so the gap between the two is read off the chart.
  const lastOf = (key: 'plan' | 'actual') => {
    for (let i = chartData.length - 1; i > 0; i--) {
      const value = chartData[i][key];
      if (value !== null) return { label: chartData[i].week, value };
    }
    return null;
  };
  const endPlan = lastOf('plan');
  const endActual = lastOf('actual');
  const cutoff = endActual?.label ?? endPlan?.label ?? null;
  // The higher of the two writes its chip ABOVE its dot and the lower BELOW, so
  // the chips part however close the lines finish. Never by which is which: a
  // project ahead of plan and one behind it need opposite sides.
  const actualAbove = endActual && endPlan ? endActual.value >= endPlan.value : endActual !== null;

  return (
    <Reveal>
      <Card className="py-0">
        <CardContent className="p-3 sm:p-5">
          <p className={cn(TYPE.cardTitle, 'mb-2')}>Progress S-Curve overall</p>

          {/* Inline, not a Tailwind arbitrary value: if a class with nested
              calc()/clamp() ever failed to compile the height would silently be
              zero and ResponsiveContainer would render nothing at all. */}
          <div
            className="w-full [--plot-gap:560px] sm:[--plot-gap:480px]"
            style={{ height: 'clamp(220px, calc(100dvh - var(--plot-gap, 560px)), 460px)' }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 32, right: 14, left: 8, bottom: 4 }}>
                <defs>
                  <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="week"
                  tick={axisTick}
                  interval={4}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border)' }}
                  tickMargin={10}
                  padding={{ left: 12, right: 0 }}
                />
                <YAxis
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, yMax]}
                  ticks={yTicks}
                  tickFormatter={(v) => `${v}%`}
                  width={44}
                />
                <Tooltip
                  animationDuration={250}
                  animationEasing="ease-out"
                  formatter={(value) => {
                    const n = typeof value === 'number' ? value : Number(value);
                    return Number.isFinite(n) ? `${n.toFixed(2)}%` : '';
                  }}
                  contentStyle={{
                    fontSize: 13,
                    backgroundColor: 'var(--popover)',
                    color: 'var(--popover-foreground)',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.12)',
                  }}
                  labelStyle={{ color: 'var(--popover-foreground)' }}
                />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 12 }} iconType="plainline" />
                {/* THE TWO SERIES DRAW THEMSELVES IN. They were switched off
                    with no reason recorded, and on this chart that cost the app
                    its most persuasive second: the actual running up at the plan
                    and stopping short is the whole story of the week, and it
                    reads far better watched than found already finished.

                    Recharts animates the path itself, not a wrapper, so nothing
                    is hidden in the markup waiting on JavaScript. The actual
                    leads and the plan follows 150ms behind, so the gap between
                    them opens in front of you instead of arriving pre-made. */}
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="var(--chart-1)"
                  strokeWidth={2.5}
                  fill="url(#actualFill)"
                  name="Actual"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, fill: 'var(--card)', stroke: 'var(--chart-1)' }}
                  connectNulls
                  isAnimationActive
                  animationDuration={900}
                  animationEasing="ease-out"
                />
                <Line
                  type="monotone"
                  dataKey="plan"
                  stroke="var(--chart-2)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, fill: 'var(--card)', stroke: 'var(--chart-2)' }}
                  name="Plan"
                  connectNulls
                  isAnimationActive
                  animationDuration={900}
                  animationBegin={150}
                  animationEasing="ease-out"
                />
                {/* Drawn after the lines so the dots sit on top, and after their
                    900ms draw-in (0.95s delay in EndMark) so each lands on a line
                    that has already arrived. */}
                {cutoff && (
                  <ReferenceLine
                    x={cutoff}
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.4}
                    strokeDasharray="3 3"
                  />
                )}
                {endPlan && (
                  <ReferenceDot
                    x={endPlan.label}
                    y={endPlan.value}
                    ifOverflow="visible"
                    shape={(p) => (
                      <EndMark
                        cx={Number(p.cx)}
                        cy={Number(p.cy)}
                        name="Plan"
                        value={endPlan.value}
                        color="var(--chart-2)"
                        above={!actualAbove}
                        delay="1.05s"
                      />
                    )}
                  />
                )}
                {endActual && (
                  <ReferenceDot
                    x={endActual.label}
                    y={endActual.value}
                    ifOverflow="visible"
                    shape={(p) => (
                      <EndMark
                        cx={Number(p.cx)}
                        cy={Number(p.cy)}
                        name="Actual"
                        value={endActual.value}
                        color="var(--chart-1)"
                        above={actualAbove}
                        delay="1.15s"
                      />
                    )}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* The same four figures, in the same order and the same colours, as
              the Fill in screen and the Overall Summary. */}
          <div className="mt-3 grid grid-cols-2 gap-3 border-t pt-3 sm:grid-cols-4 sm:gap-4">
            <div>
              <p className={TYPE.statLabel}>Current week</p>
              <p className="mt-0.5 text-xl font-semibold text-foreground">Week {currentWeek}</p>
            </div>
            <div>
              <p className={TYPE.statLabel}>Plan progress</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-chart-2">
                <AnimatedNumber value={planPct ?? 0} suffix="%" />
              </p>
            </div>
            <div>
              <p className={TYPE.statLabel}>Actual progress</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-chart-1">
                <AnimatedNumber value={actualPct ?? 0} suffix="%" />
              </p>
            </div>
            <div>
              <p className={TYPE.statLabel}>Deviation</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums text-deviation">
                <AnimatedNumber value={variance ?? 0} suffix="%" />
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Reveal>
  );
}
