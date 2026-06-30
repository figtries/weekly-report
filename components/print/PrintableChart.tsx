'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Legend } from 'recharts';
import { sCurveData } from '@/utils/mockData';

export default function PrintableChart() {
  return (
    <div className="hidden print:block print-color-adjust-exact">
      <div 
        className="bg-white text-black border-[3px] border-black" 
        style={{ 
          width: '210mm', 
          height: '297mm',
          padding: '15mm',
          margin: '0 auto',
          pageBreakAfter: 'always'
        }}
      >
        {/* Header */}
        <div className="text-center border-2 border-black p-3 mb-4">
          <h1 className="text-xl font-bold mb-2">PROGRESS S-CURVE SPK003</h1>
          <div className="text-sm flex justify-center gap-8">
            <span><strong>Weeks:</strong> W35</span>
            <span><strong>Period:</strong> 19 June 2026 to 25 June 2026</span>
          </div>
        </div>

        {/* Chart Container - Fixed size for print */}
        <div className="border-2 border-black mb-4" style={{ width: '100%', height: '450px', padding: '10px' }}>
          <LineChart
            width={750}
            height={430}
            data={sCurveData}
            margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#999" />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 7, fill: '#000' }}
              interval={1}
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
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 5 }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="plan"
              stroke="#ef4444"
              strokeWidth={2}
              dot={{ fill: '#ef4444', r: 2 }}
              name="CUM. PLAN"
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="actual"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={{ fill: '#3b82f6', r: 2 }}
              name="CUM. ACTUAL"
              isAnimationActive={false}
            />
          </LineChart>
        </div>

        {/* Data Table */}
        <div className="border-2 border-black p-2 mb-4 overflow-hidden">
          <div className="text-[7px]">
            <div className="flex border-b border-black pb-1 mb-1">
              <div className="font-bold w-24">CUM. ACTUAL</div>
              {sCurveData.map((item, idx) => (
                <div key={idx} className="flex-1 text-center">{item.actual.toFixed(1)}%</div>
              ))}
            </div>
            <div className="flex">
              <div className="font-bold w-24">CUM. PLAN</div>
              {sCurveData.map((item, idx) => (
                <div key={idx} className="flex-1 text-center">{item.plan.toFixed(1)}%</div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer with signatures */}
        <div className="grid grid-cols-2 gap-8 mt-8">
          <div className="text-center">
            <p className="font-bold text-sm mb-16">PT. PERTAMINA EP ZONA 11</p>
            <div className="border-t-2 border-black pt-2">
              <p className="text-sm">Andika Wijaya Kusumah</p>
            </div>
          </div>
          <div className="text-center">
            <p className="font-bold text-sm mb-16">PT. INDOTURBINE</p>
            <div className="border-t-2 border-black pt-2">
              <p className="text-sm">Yopi Budiana Perkasa</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
