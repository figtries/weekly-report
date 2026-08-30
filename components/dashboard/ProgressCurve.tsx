import type { SCurveRow } from '@/lib/scurve';
import { cn } from '@/lib/utils';

/**
 * The plan and actual lines, drawn small.
 *
 * A project-control dashboard without a curve is missing the one shape everyone
 * in this trade reads instinctively — the gap between two lines says more at a
 * glance than any percentage does. Plain SVG on purpose: it renders in the
 * static shell with no chart library, no hydration, and no layout shift.
 *
 * The two lines are coloured by what they ARE, never by whether the news is
 * good: actual is `--chart-1` (blue), plan is `--chart-2` (red), the same pair
 * the S-curve and every bar in the app use. Painting the whole chart red on a
 * bad week — which this component used to do — removes the only thing that
 * tells the two lines apart, on the week it matters most.
 */
export default function ProgressCurve({
  rows,
  className,
}: {
  rows: SCurveRow[];
  className?: string;
}) {
  if (rows.length < 2) return null;

  const W = 1000;
  const H = 180;
  // Room at the top for the leading line, and a floor the fill can sit on
  // without spilling past the panel's rounded corner.
  const TOP = 14;
  const BOTTOM = 2;
  // Room after the cut-off so the endpoint dots are not sliced in half by the
  // card's edge — and so the curve stops short of the wall, which is also what
  // makes the boundary read as "measurement ends here" rather than as the chart
  // simply running out of room.
  const RIGHT = 16;

  const weeks = rows.map((r) => r.week);
  const minW = Math.min(...weeks);
  const maxW = Math.max(...weeks);
  const span = Math.max(1, maxW - minW);

  // Scale to the data, not to 0..100. Over a 60-week plan the reported weeks
  // only reach ~70%, and forcing the full axis flattens the S into a ramp.
  const peak = Math.max(
    10,
    ...rows.flatMap((r) => [r.planPct ?? 0, r.actualPct ?? 0])
  );
  const ceiling = Math.min(100, peak * 1.08);

  const x = (week: number) => ((week - minW) / span) * (W - RIGHT);
  const y = (pct: number) =>
    H - BOTTOM - (Math.max(0, Math.min(ceiling, pct)) / ceiling) * (H - TOP - BOTTOM);

  /**
   * A MONOTONE cubic through the weekly points, not a plain polyline and not a
   * loose spline.
   *
   * The straight version read as a flight of stairs, which is not what an
   * S-curve is. The obvious fix — Catmull-Rom, or any smooth-through-points
   * spline — overshoots between samples, and an overshoot here is a chart
   * drawing progress the project never made. Fritsch-Carlson cannot overshoot:
   * where the data climbs it climbs, where the data dips (and it does — a
   * corrected leaf can pull cumulative progress DOWN) it dips, and it never
   * invents a value outside the two points it sits between.
   *
   * So the curve is smoother to look at and still says exactly what the numbers
   * say, which is the only version worth having on a report people sign.
   */
  const line = (pick: (r: SCurveRow) => number | null) => {
    const pts = rows
      .filter((r) => pick(r) !== null)
      .map((r) => ({ x: x(r.week), y: y(pick(r) as number) }));
    if (pts.length === 0) return null;
    if (pts.length < 3) return `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`;

    const n = pts.length;
    const dx = Array.from({ length: n - 1 }, (_, i) => pts[i + 1].x - pts[i].x);
    const slope = Array.from({ length: n - 1 }, (_, i) => (pts[i + 1].y - pts[i].y) / dx[i]);

    // Tangents: average of the neighbouring slopes, ends taking their one side.
    const m = [slope[0], ...Array.from({ length: n - 2 }, (_, i) => (slope[i] + slope[i + 1]) / 2), slope[n - 2]];

    // The monotonicity filter. A flat segment pins both its tangents to zero;
    // anywhere else the tangent pair is scaled back inside a circle of radius 3,
    // which is the condition that makes overshoot impossible.
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

    let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${(pts[i].x + h).toFixed(1)},${(pts[i].y + m[i] * h).toFixed(1)}`
        + ` ${(pts[i + 1].x - h).toFixed(1)},${(pts[i + 1].y - m[i + 1] * h).toFixed(1)}`
        + ` ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
    }
    return d;
  };

  const planPath = line((r) => r.planPct);
  const actualPath = line((r) => r.actualPct);

  const lastActual = [...rows].reverse().find((r) => r.actualPct !== null);
  const lastPlan = [...rows].reverse().find((r) => r.planPct !== null);
  const area =
    actualPath && lastActual
      ? `${actualPath}L${x(lastActual.week).toFixed(1)},${H}L${x(minW).toFixed(1)},${H}Z`
      : null;

  // Quarter lines only. On a card this short anything denser reads as texture
  // rather than as a scale, and the figures themselves are stated above.
  const grid = [0.25, 0.5, 0.75].map((f) => H - BOTTOM - f * (H - TOP - BOTTOM));

  return (
    <div className={cn('relative', className)}>
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="block h-full w-full"
      role="img"
      aria-label={
        lastActual && lastPlan
          ? `Progress curve to week ${lastActual.week}: actual ${(lastActual.actualPct as number).toFixed(2)} percent against a plan of ${(lastPlan.planPct as number).toFixed(2)} percent.`
          : 'Planned and actual progress curve'
      }
    >
      <defs>
        <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity="0" />
        </linearGradient>
        {/* The reveal is a clip wipe, not a dash offset — see `curve-wipe` in
            globals.css. Short version: the plan line below already owns its
            `strokeDasharray`, and this viewBox is stretched, so the two things
            a dash-offset reveal needs are both already spoken for. */}
        <clipPath id="curve-wipe-clip">
          <rect className="animate-curve-wipe" x="0" y="0" width={W} height={H} />
        </clipPath>
      </defs>

      {grid.map((gy) => (
        <line
          key={gy}
          x1={0}
          y1={gy}
          x2={W}
          y2={gy}
          stroke="currentColor"
          strokeOpacity="0.07"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {/* The GRID STAYS PUT and only the data sweeps in over it. Wiping the
          grid too would read as the whole card loading rather than as the
          project's own line being drawn, and the scale is context — it should
          already be there for the curve to arrive against. */}
      <g clipPath="url(#curve-wipe-clip)">
      {area && <path d={area} fill="url(#curve-fill)" />}
      {planPath && (
        <path
          d={planPath}
          fill="none"
          stroke="var(--color-chart-2)"
          strokeOpacity="0.85"
          strokeWidth="2"
          strokeDasharray="7 6"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {actualPath && (
        <path
          d={actualPath}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* THE CUT-OFF. A full-height rule at the last reported week — the line
          where measurement stops and everything to its right is still to come.
          It is a rule and not a dot because the viewBox is stretched
          horizontally (preserveAspectRatio="none"), which turns any circle into
          an ellipse; the round markers are HTML, over the top. */}
      {lastActual && (
        <line
          x1={x(lastActual.week)}
          y1={TOP}
          x2={x(lastActual.week)}
          y2={H}
          stroke="currentColor"
          strokeOpacity="0.22"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      </g>
    </svg>

    {/* THE TWO ENDPOINTS, IN HTML AND WITHOUT NUMBERS.

        HTML because AGENTS.md says so and this viewBox is why: it is stretched,
        so an SVG circle here comes out an ellipse, and `<text>` inside it would
        be scaled to about five pixels tall on a 390px phone.

        No numbers, because both of them are already on this card in type four
        times the size — 70.14% is the hero figure and 71.93% sits in the stat
        row beside it. Printing them again on the plot was tried and it did two
        things: collided with the legend in the top-right corner, and made the
        one thing the chart uniquely says harder to see. What the chart says
        that the figures cannot is the SHAPE of the gap, and two dots on the
        boundary say that at a glance.

        They arrive after the wipe has passed them, so each dot lands on a line
        that has already been drawn instead of racing it. */}
    {lastPlan && lastPlan.planPct !== null && (
      <EndDot
        leftPct={(x(lastPlan.week) / W) * 100}
        topPct={(y(lastPlan.planPct) / H) * 100}
        value={lastPlan.planPct}
        tone="plan"
      />
    )}
    {lastActual && lastActual.actualPct !== null && (
      <EndDot
        leftPct={(x(lastActual.week) / W) * 100}
        topPct={(y(lastActual.actualPct) / H) * 100}
        value={lastActual.actualPct}
        tone="actual"
      />
    )}
    </div>
  );
}

/**
 * Where one line stood when measurement stopped. The gap between the two dots
 * is the deviation, drawn rather than stated.
 *
 * THE PLAN DOT IS THE LARGER OF THE TWO, and that is a legibility fix rather
 * than emphasis. Both dots sit at their true value, but this card is `h-40` on
 * a phone, so a project a point or two behind compresses the gap to almost
 * nothing and the actual dot — drawn second, therefore on top — swallowed the
 * plan dot completely at 390px. Half a size larger and the plan always shows as
 * a rim behind the actual, however close the two figures get. Neither centre
 * moves, so nothing is misstated: what changes is only whether you can see that
 * there are two.
 */
function EndDot({
  leftPct,
  topPct,
  value,
  tone,
}: {
  leftPct: number;
  topPct: number;
  value: number;
  tone: 'plan' | 'actual';
}) {
  const actual = tone === 'actual';
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
    >
      <span
        aria-hidden
        className={cn(
          'absolute block -translate-x-1/2 -translate-y-1/2 animate-dot-in rounded-full',
          actual ? 'z-20 size-2.5 bg-chart-1 ring-2 ring-card' : 'z-10 size-3.5 bg-chart-2'
        )}
        // Just after the wipe reaches this end of the line.
        style={{ animationDelay: '0.95s' }}
      />
      {/* THE FIGURE, PLACED SO THE TWO CAN NEVER COLLIDE.
          Both chips sit to the LEFT of their dot — the cut-off is the plot's
          right edge, and anything placed to its right leaves the card. The
          plan's chip then sits ABOVE its dot and the actual's BELOW its own, so
          the separation comes from which side of which dot they are on rather
          than from the values being far enough apart. That matters because they
          usually are not: this project is 1.79 points behind, which is about
          four pixels of height on a phone. */}
      <span
        className={cn(
          'absolute right-3 animate-fade-in-up whitespace-nowrap rounded-md bg-card/90 px-1.5 py-0.5 text-[11px] font-semibold leading-tight tabular-nums shadow-sm ring-1 ring-border/60',
          actual ? 'top-1 text-chart-1' : 'bottom-1 text-chart-2'
        )}
        style={{ animationDelay: actual ? '1.15s' : '1.05s' }}
      >
        {actual ? 'Actual' : 'Plan'} {value.toFixed(2)}%
      </span>
    </div>
  );
}
