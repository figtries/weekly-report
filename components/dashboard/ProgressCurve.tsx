import type { SCurveRow } from '@/lib/scurve';

/**
 * The plan and actual lines, drawn small.
 *
 * A project-control dashboard without a curve is missing the one shape everyone
 * in this trade reads instinctively — the gap between two lines says more at a
 * glance than any percentage does. Plain SVG on purpose: it renders in the
 * static shell with no chart library, no hydration, and no layout shift.
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

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      role="img"
      aria-label="Kurva progress rencana dan aktual"
    >
      <defs>
        <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      {area && <path d={area} fill="url(#curve-fill)" />}
      {planPath && (
        <path
          d={planPath}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="2"
          strokeDasharray="7 6"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {actualPath && (
        <path
          d={actualPath}
          fill="none"
          stroke="currentColor"
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
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
