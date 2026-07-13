'use client';

import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { SCurveRow } from '@/lib/scurve';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { formatDateShort, weekEndDate, weekPeriodLabel } from '@/lib/weeks';

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
        <rect x={boxX} y={boxY} width={width} height={height} fill="#fff" stroke={color} strokeWidth={1.2} />
        {/* Manual vertical centering (y + ~1/3 font size) — iOS Safari and some
            print rasterizers ignore dominant-baseline on <text>. */}
        <text x={boxX + width / 2} y={boxY + height / 2 + 3.5} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={color}>
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
  const dateAt = (idx: number) => formatDateShort(weekEndDate(project.weekAnchorEndDate, chartData[idx].weekNum));

  return (
    <div
      className="border-[3px] border-black bg-white text-black"
      style={{ width: '210mm', height: '297mm', padding: '12mm', margin: '0 auto', boxSizing: 'border-box', pageBreakInside: 'avoid', pageBreakAfter: 'auto' }}
    >
      <div className="mb-4 border-2 border-black p-4 text-center">
        <h1 className="mb-2 text-2xl font-bold">PROGRESS S-CURVE OVERALL</h1>
        <div className="flex justify-center gap-12 text-base">
          <span>
            <strong>Weeks:</strong> W{meta.week}
          </span>
          <span>
            <strong>Period:</strong> {weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
          </span>
        </div>
      </div>

      <div data-print-chart className="mb-6 flex items-center justify-center border-2 border-black" style={{ width: '100%', height: '470px', padding: '16px' }}>
        <LineChart width={650} height={432} data={chartData} margin={{ top: 30, right: 50, left: 15, bottom: 58 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#999" />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 9, fill: '#000', fontWeight: 500 }}
            interval={Math.ceil(chartData.length / 36)}
            angle={-45}
            textAnchor="end"
            height={70}
            stroke="#000"
            strokeWidth={1.5}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#000', fontWeight: 500 }}
            domain={[0, 100]}
            ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
            stroke="#000"
            strokeWidth={1.5}
          />
          <Legend wrapperStyle={{ fontSize: 13, paddingTop: 10, fontWeight: 600, textAlign: 'center', width: '100%' }} iconType="line" />
          <Line
            type="monotone"
            dataKey="plan"
            stroke="#ef4444"
            strokeWidth={2.5}
            dot={{ fill: '#ef4444', r: 2 }}
            name="CUM. PLAN"
            isAnimationActive={false}
            connectNulls
            label={lastPlanIdx > 0 ? makeEndCallout('#ef4444', dateAt(lastPlanIdx), lastPlanIdx, -30) : undefined}
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#3b82f6"
            strokeWidth={2.5}
            dot={{ fill: '#3b82f6', r: 2 }}
            name="CUM. ACTUAL"
            isAnimationActive={false}
            connectNulls
            label={lastActualIdx > 0 ? makeEndCallout('#3b82f6', dateAt(lastActualIdx), lastActualIdx, 30) : undefined}
          />
        </LineChart>
      </div>

      <div className="mb-4 overflow-hidden border-2 border-black">
        <table className="w-full border-collapse" style={{ fontSize: '6.5px', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th className="border border-black bg-gray-200 px-1 py-1 text-left font-bold" style={{ width: '40px' }}>
                Week
              </th>
              {series.map((r) => (
                <th key={r.week} className="border border-black bg-gray-200 px-0.5 py-1 text-center font-semibold">
                  {r.week}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-1 py-1 text-left font-bold" style={{ color: '#3b82f6' }}>
                ACTUAL
              </td>
              {series.map((r) => (
                <td key={r.week} className="border border-black px-0.5 py-1 text-center font-medium">
                  {r.actualPct !== null ? r.actualPct.toFixed(1) : ''}
                </td>
              ))}
            </tr>
            <tr>
              <td className="border border-black px-1 py-1 text-left font-bold" style={{ color: '#ef4444' }}>
                PLAN
              </td>
              {series.map((r) => (
                <td key={r.week} className="border border-black px-0.5 py-1 text-center font-medium">
                  {r.planPct !== null ? r.planPct.toFixed(1) : ''}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-12">
        <div className="text-center">
          <p className="mb-32 text-base font-bold">{project.signatureLeft.company}</p>
          <div className="border-t-2 border-black pt-2">
            <p className="text-base font-medium">{project.signatureLeft.name}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="mb-32 text-base font-bold">{project.signatureRight.company}</p>
          <div className="border-t-2 border-black pt-2">
            <p className="text-base font-medium">{project.signatureRight.name}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
