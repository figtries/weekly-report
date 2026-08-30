import type { SCurveRow } from '@/lib/scurve';

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

  const x = (week: number) => ((week - minW) / span) * W;
  const y = (pct: number) =>
    H - BOTTOM - (Math.max(0, Math.min(ceiling, pct)) / ceiling) * (H - TOP - BOTTOM);

  const line = (pick: (r: SCurveRow) => number | null) => {
    const pts = rows
      .filter((r) => pick(r) !== null)
      .map((r) => `${x(r.week).toFixed(1)},${y(pick(r) as number).toFixed(1)}`);
    return pts.length ? `M${pts.join('L')}` : null;
  };

  const planPath = line((r) => r.planPct);
  const actualPath = line((r) => r.actualPct);

  const lastActual = [...rows].reverse().find((r) => r.actualPct !== null);
  const area =
    actualPath && lastActual
      ? `${actualPath}L${x(lastActual.week).toFixed(1)},${H}L${x(minW).toFixed(1)},${H}Z`
      : null;

  // Quarter lines only. On a card this short anything denser reads as texture
  // rather than as a scale, and the figures themselves are stated above.
  const grid = [0.25, 0.5, 0.75].map((f) => H - BOTTOM - f * (H - TOP - BOTTOM));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Planned and actual progress curve"
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
      {/* "You are here" as a vertical rule rather than a dot: the viewBox is
          stretched horizontally (preserveAspectRatio="none"), which would turn
          any circle into an ellipse and clip it at the right edge. */}
      {lastActual && (
        <line
          x1={x(lastActual.week)}
          y1={y(lastActual.actualPct as number)}
          x2={x(lastActual.week)}
          y2={H}
          stroke="var(--color-chart-1)"
          strokeOpacity="0.5"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      </g>
    </svg>
  );
}
