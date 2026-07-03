'use client';

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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
  // Anchor both lines at the same 0% origin so they start aligned.
  const chartData = [
    { week: 'W0', plan: 0, actual: 0 },
    ...series.map((r) => ({ week: `W${r.week}`, plan: r.planPct, actual: r.actualPct })),
  ];
  const variance = planPct !== null && actualPct !== null ? actualPct - planPct : null;

  return (
    <div className="flex h-full flex-col animate-fade-in-up">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
        <h1 className="text-2xl font-semibold text-gray-900">S-Curve Overview</h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Progress S-Curve Overall</h2>
        </div>

        <div className="w-full min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 4 }}>
              <defs>
                <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="4 4" stroke="#eef2f7" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                interval={4}
                tickLine={false}
                axisLine={{ stroke: '#e5e7eb' }}
                tickMargin={10}
                padding={{ left: 12, right: 28 }}
              />
              <YAxis
                tick={{ fontSize: 12, fill: '#94a3b8' }}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
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
                  backgroundColor: 'rgba(255,255,255,0.98)',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.12)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 13, paddingTop: 12 }} iconType="plainline" />
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#3b82f6"
                strokeWidth={2.5}
                fill="url(#actualFill)"
                name="Actual"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#3b82f6' }}
                connectNulls
                animationBegin={120}
                animationDuration={700}
                animationEasing="ease-out"
              />
              <Line
                type="monotone"
                dataKey="plan"
                stroke="#ef4444"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#ef4444' }}
                name="Plan"
                connectNulls
                animationBegin={120}
                animationDuration={700}
                animationEasing="ease-out"
              />
            </ComposedChart>
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
