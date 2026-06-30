'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { sCurveData } from '@/utils/mockData';
import PrintableChart from '@/components/print/PrintableChart';

export default function DashboardPage() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* Web View */}
      <div className="p-8 print:hidden">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Dashboard</h1>
          <p className="text-gray-600">S-Curve progress tracking for project monitoring</p>
        </div>

        {/* Chart Card */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">S-Curve Progress Chart</h2>
              <p className="text-sm text-gray-600 mt-1">Week 1 to Week 35 - Plan vs Actual</p>
            </div>
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              Print Chart
            </button>
          </div>

          <div className="w-full" style={{ height: '500px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={sCurveData}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="week"
                  tick={{ fontSize: 12, fill: '#6b7280' }}
                  interval={4}
                  stroke="#d1d5db"
                />
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
                  contentStyle={{
                    fontSize: 13,
                    backgroundColor: 'rgba(255,255,255,0.98)',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 14, paddingTop: 20 }}
                />
                <Line
                  type="monotone"
                  dataKey="plan"
                  stroke="#3b82f6"
                  strokeWidth={3}
                  dot={false}
                  name="Plan"
                  animationDuration={1000}
                />
                <Line
                  type="monotone"
                  dataKey="actual"
                  stroke="#10b981"
                  strokeWidth={3}
                  dot={false}
                  name="Actual"
                  animationDuration={1000}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Summary Stats */}
          <div className="mt-6 pt-6 border-t border-gray-200 grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium mb-1">Current Week</p>
              <p className="text-2xl font-semibold text-gray-900">Week 35</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium mb-1">Plan Progress</p>
              <p className="text-2xl font-semibold text-blue-600">
                {sCurveData[sCurveData.length - 1].plan.toFixed(2)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase font-medium mb-1">Actual Progress</p>
              <p className="text-2xl font-semibold text-green-600">
                {sCurveData[sCurveData.length - 1].actual.toFixed(2)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Print View */}
      <PrintableChart />
    </>
  );
}
