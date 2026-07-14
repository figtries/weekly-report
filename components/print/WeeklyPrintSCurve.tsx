'use client';

import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import PrintHeader from './PrintHeader';
import PrintFooter from './PrintFooter';
import type { SCurveRow } from '@/lib/scurve';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { formatDateShort, weekEndDate, weekPeriodLabel } from '@/lib/weeks';

// The chart is a fixed pixel size because Recharts needs one, so it must fit the
// sheet's content box (180mm ≈ 680px) minus the card's padding.
const CHART_W = 636;
const CHART_H = 392;

// Weeks per row of the figures table under the chart.
const WEEKS_PER_BLOCK = 30;

// A short last block gets empty cells so its columns line up with the block
// above it instead of stretching to double width.
function padding(used: number): number[] {
  return Array.from({ length: WEEKS_PER_BLOCK - used }, (_, i) => i);
}

// Excel-style callout ("18-Jun-26; 65.90%") anchored to one point of a line.
// Recharts calls this for every point; all but targetIndex render nothing.
function makeEndCallout(color: string, dateLabel: string, targetIndex: number, dy: number) {
  return function EndCallout(props: unknown) {
    const { viewBox, index, value } = props as {
      viewBox?: { x?: number; y?: number };
      index?: number;
      value?: number | null;
    };
    if (index !== targetIndex || viewBox?.x == null || viewBox?.y == null || value == null) return null;
    const text = `${dateLabel}; ${Number(value).toFixed(2)}%`;
    const width = text.length * 5.4 + 12;
    const height = 16;
    const px = viewBox.x;
    const py = viewBox.y;
    // Box sits left of the point; flip right if the point is too close to the
    // left edge, and clamp vertically so a ~100% point can't push it off-canvas.
    let boxX = px - width - 16;
    if (boxX < 4) boxX = px + 16;
    const boxY = Math.max(4, py + dy - height / 2);
    const anchorX = boxX > px ? boxX : boxX + width;
    return (
      <g>
        <path d={`M${px},${py} L${anchorX},${boxY + height / 2}`} stroke={color} strokeWidth={1} fill="none" />
        <rect x={boxX} y={boxY} width={width} height={height} fill="#fff" stroke={color} strokeWidth={1.2} rx={3} />
        {/* Manual vertical centering (y + ~1/3 font size) — iOS Safari and some
            print rasterizers ignore dominant-baseline on <text>. */}
        <text x={boxX + width / 2} y={boxY + height / 2 + 3.5} textAnchor="middle" fontSize={9} fontWeight={700} fill={color}>
          {text}
        </text>
      </g>
    );
  };
}

export default function WeeklyPrintSCurve({
  project,
  meta,
  series,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
  series: SCurveRow[];
}) {
  // Anchor both lines at the same 0% origin so they start aligned.
  const chartData = [
    { week: 'W0', weekNum: 0, plan: 0, actual: 0 },
    ...series.map((r) => ({ week: `W${r.week}`, weekNum: r.week, plan: r.planPct, actual: r.actualPct })),
  ];

  const lastIdxOf = (key: 'plan' | 'actual') => {
    for (let i = chartData.length - 1; i > 0; i--) if (chartData[i][key] != null) return i;
    return -1;
  };
  const lastPlanIdx = lastIdxOf('plan');
  const lastActualIdx = lastIdxOf('actual');
  const weekBlocks: SCurveRow[][] = [];
  for (let i = 0; i < series.length; i += WEEKS_PER_BLOCK) {
    weekBlocks.push(series.slice(i, i + WEEKS_PER_BLOCK));
  }
  const dateAt = (idx: number) => formatDateShort(weekEndDate(project.weekAnchorEndDate, chartData[idx].weekNum));

  return (
    <div className="print-sheet-a4">
      <PrintHeader
        title="Progress S-Curve Overall"
        subtitle={project.name}
        period={weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
      />

      <div
        data-print-chart
        className="rpt-card flex items-center justify-center"
        style={{ padding: '4mm 2mm' }}
      >
        <LineChart
          width={CHART_W}
          height={CHART_H}
          data={chartData}
          margin={{ top: 28, right: 44, left: 4, bottom: 46 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 8, fill: '#475569', fontWeight: 500 }}
            interval={Math.ceil(chartData.length / 36)}
            angle={-45}
            textAnchor="end"
            height={60}
            stroke="#475569"
            strokeWidth={1}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#475569', fontWeight: 500 }}
            domain={[0, 100]}
            ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
            stroke="#475569"
            strokeWidth={1}
            unit="%"
            width={44}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8, fontWeight: 600, textAlign: 'center', width: '100%' }}
            iconType="line"
          />
          <Line
            type="monotone"
            dataKey="plan"
            stroke="#dc2626"
            strokeWidth={2}
            dot={{ fill: '#dc2626', r: 1.8 }}
            name="CUM. PLAN"
            isAnimationActive={false}
            connectNulls
            label={lastPlanIdx > 0 ? makeEndCallout('#dc2626', dateAt(lastPlanIdx), lastPlanIdx, -30) : undefined}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#1d4ed8"
            strokeWidth={2}
            dot={{ fill: '#1d4ed8', r: 1.8 }}
            name="CUM. ACTUAL"
            isAnimationActive={false}
            connectNulls
            label={lastActualIdx > 0 ? makeEndCallout('#1d4ed8', dateAt(lastActualIdx), lastActualIdx, 30) : undefined}
          />
        </LineChart>
      </div>

      {/* Past ~30 weeks the figures stop fitting their columns and the row turns
          into a grey smear. Wrap onto stacked tables instead of shrinking. */}
      {weekBlocks.map((block, i) => (
        <div key={i} style={{ marginTop: i === 0 ? '4mm' : '2mm' }}>
          <table className="rpt-table rpt-table--micro" style={{ tableLayout: 'fixed' }}>
            <thead>
              <tr>
                <th style={{ width: '13mm', textAlign: 'left' }}>Week</th>
                {block.map((r) => (
                  <th key={r.week}>{r.week}</th>
                ))}
                {padding(block.length).map((k) => (
                  <th key={k} />
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ fontWeight: 700, color: '#1d4ed8' }}>ACTUAL</td>
                {block.map((r) => (
                  <td key={r.week} className="rpt-num">
                    {r.actualPct !== null ? r.actualPct.toFixed(1) : ''}
                  </td>
                ))}
                {padding(block.length).map((k) => (
                  <td key={k} />
                ))}
              </tr>
              <tr>
                <td style={{ fontWeight: 700, color: '#dc2626' }}>PLAN</td>
                {block.map((r) => (
                  <td key={r.week} className="rpt-num">
                    {r.planPct !== null ? r.planPct.toFixed(1) : ''}
                  </td>
                ))}
                {padding(block.length).map((k) => (
                  <td key={k} />
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      <div className="grid grid-cols-2" style={{ marginTop: '6mm', columnGap: '20mm' }}>
        <div className="rpt-sign">
          <p className="rpt-sign-company">{project.signatureLeft.company}</p>
          <div className="rpt-sign-line">{project.signatureLeft.name}</div>
        </div>
        <div className="rpt-sign">
          <p className="rpt-sign-company">{project.signatureRight.company}</p>
          <div className="rpt-sign-line">{project.signatureRight.name}</div>
        </div>
      </div>

      <PrintFooter docNo={project.documentNoWeekly} page={1} total={1} />
    </div>
  );
}
