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
  const chartData = series.map((r) => ({ week: `W${r.week}`, plan: r.planPct, actual: r.actualPct }));

  return (
    <div
      className="border-[3px] border-black bg-white text-black"
      style={{ width: '210mm', height: '297mm', padding: '15mm', margin: '0 auto', pageBreakAfter: 'always' }}
    >
      <div className="mb-4 border-2 border-black p-3 text-center">
        <h1 className="mb-2 text-xl font-bold">PROGRESS S-CURVE OVERALL</h1>
        <div className="flex justify-center gap-8 text-sm">
          <span>
            <strong>Weeks:</strong> W{meta.week}
          </span>
          <span>
            <strong>Period:</strong> {weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
          </span>
        </div>
      </div>

      <div className="mb-4 border-2 border-black" style={{ width: '100%', height: '450px', padding: '10px' }}>
        <LineChart width={750} height={430} data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#999" />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 7, fill: '#000' }}
            interval={Math.ceil(chartData.length / 36)}
            angle={-45}
            textAnchor="end"
            height={60}
            stroke="#000"
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#000' }}
            domain={[0, 100]}
            ticks={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]}
            stroke="#000"
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 5 }} iconType="line" />
          <Line
            type="monotone"
            dataKey="plan"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ fill: '#ef4444', r: 1.5 }}
            name="CUM. PLAN"
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ fill: '#3b82f6', r: 1.5 }}
            name="CUM. ACTUAL"
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </div>

      <div className="mb-4 overflow-hidden border-2 border-black">
        <table className="w-full border-collapse" style={{ fontSize: '5px', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th className="border border-black bg-gray-200 px-0.5 py-0.5 text-left" style={{ width: '34px' }}>
                Week
              </th>
              {series.map((r) => (
                <th key={r.week} className="border border-black bg-gray-200 px-0 py-0.5 text-center">
                  {r.week}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-0.5 py-0.5 text-left font-bold" style={{ color: '#3b82f6' }}>
                ACTUAL
              </td>
              {series.map((r) => (
                <td key={r.week} className="border border-black px-0 py-0.5 text-center">
                  {r.actualPct !== null ? r.actualPct.toFixed(1) : ''}
                </td>
              ))}
            </tr>
            <tr>
              <td className="border border-black px-0.5 py-0.5 text-left font-bold" style={{ color: '#ef4444' }}>
                PLAN
              </td>
              {series.map((r) => (
                <td key={r.week} className="border border-black px-0 py-0.5 text-center">
                  {r.planPct !== null ? r.planPct.toFixed(1) : ''}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-8">
        <div className="text-center">
          <p className="mb-16 text-sm font-bold">{project.signatureLeft.company}</p>
          <div className="border-t-2 border-black pt-2">
            <p className="text-sm">{project.signatureLeft.name}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="mb-16 text-sm font-bold">{project.signatureRight.company}</p>
          <div className="border-t-2 border-black pt-2">
            <p className="text-sm">{project.signatureRight.name}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
