'use client';

import { CartesianGrid, Legend, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { SCurveRow } from '@/lib/scurve';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { weekPeriodLabel } from '@/lib/weeks';

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
    { week: 'W0', plan: 0, actual: 0 },
    ...series.map((r) => ({ week: `W${r.week}`, plan: r.planPct, actual: r.actualPct })),
  ];

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

      <div className="mb-4 flex items-center justify-center border-2 border-black" style={{ width: '100%', height: '440px', padding: '10px' }}>
        <LineChart width={770} height={420} data={chartData} margin={{ top: 20, right: 40, left: 25, bottom: 65 }}>
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
          <p className="mb-16 text-base font-bold">{project.signatureLeft.company}</p>
          <div className="border-t-2 border-black pt-2">
            <p className="text-base font-medium">{project.signatureLeft.name}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="mb-16 text-base font-bold">{project.signatureRight.company}</p>
          <div className="border-t-2 border-black pt-2">
            <p className="text-base font-medium">{project.signatureRight.name}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
