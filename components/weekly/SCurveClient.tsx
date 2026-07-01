'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import type { SCurveRow } from '@/lib/scurve';
import type { ProjectInfo } from '@/lib/types';

export default function SCurveClient({
  series,
  currentWeek,
  planPct,
  actualPct,
  project,
}: {
  series: SCurveRow[];
  currentWeek: number;
  planPct: number | null;
  actualPct: number | null;
  project: ProjectInfo;
}) {
  const chartData = series.map((r) => ({ week: `W${r.week}`, plan: r.planPct, actual: r.actualPct }));
  const variance = planPct !== null && actualPct !== null ? actualPct - planPct : null;

  return (
    <div className="flex h-full flex-col animate-fade-in-up">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="text-2xl font-semibold text-gray-900">S-Curve Overview</h1>
        <p className="text-sm text-gray-500">
          Week 1 to Week {series.length} · Plan vs Actual — {project.name}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Progress S-Curve Overall</h2>
        </div>

        <div className="w-full min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#6b7280' }} interval={4} stroke="#d1d5db" />
              <YAxis
                tick={{ fontSize: 12, fill: '#6b7280' }}
                stroke="#d1d5db"
                domain={[0, 100]}
                label={{
                  value: 'Progress (%)',
                  angle: -90,
                  position: 'insideLeft',
                  style: { fontSize: 14, fill: '#6b7280' },
                }}
              />
              <Tooltip
                formatter={(value) => {
                  const n = typeof value === 'number' ? value : Number(value);
                  return Number.isFinite(n) ? `${n.toFixed(2)}%` : '';
                }}
                contentStyle={{
                  fontSize: 13,
                  backgroundColor: 'rgba(255,255,255,0.98)',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 14, paddingTop: 20 }} />
              <Line
                type="monotone"
                dataKey="plan"
                stroke="#ef4444"
                strokeWidth={3}
                dot={false}
                name="Plan"
                connectNulls
                animationDuration={900}
              />
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#3b82f6"
                strokeWidth={3}
                dot={false}
                name="Actual"
                connectNulls
                animationDuration={900}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-3 grid shrink-0 grid-cols-4 gap-4 border-t border-gray-200 pt-3">
          <div>
            <p className="mb-0.5 text-[11px] font-medium uppercase text-gray-500">Current Week</p>
            <p className="text-xl font-semibold text-gray-900">Week {currentWeek}</p>
          </div>
          <div>
            <p className="mb-0.5 text-[11px] font-medium uppercase text-gray-500">Plan Progress</p>
            <p className="text-xl font-semibold text-red-600">
              <AnimatedNumber value={planPct ?? 0} suffix="%" />
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-[11px] font-medium uppercase text-gray-500">Actual Progress</p>
            <p className="text-xl font-semibold text-blue-600">
              <AnimatedNumber value={actualPct ?? 0} suffix="%" />
            </p>
          </div>
          <div>
            <p className="mb-0.5 text-[11px] font-medium uppercase text-gray-500">Deviation</p>
            <p className={`text-xl font-semibold ${variance !== null && variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
              <AnimatedNumber value={variance ?? 0} suffix="%" />
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
