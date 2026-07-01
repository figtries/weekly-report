import type { GrandTotal, SummaryRow } from '@/lib/rollup';

export default function SummaryTable({ roots, grandTotal }: { roots: SummaryRow[]; grandTotal: GrandTotal }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th rowSpan={2} className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-gray-200">
              NO
            </th>
            <th rowSpan={2} className="px-4 py-3 text-left font-semibold text-gray-700 border-r border-gray-200">
              Deskripsi
            </th>
            <th rowSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200">
              Bobot (%)
            </th>
            <th
              colSpan={2}
              className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200 bg-blue-50"
            >
              Previous
            </th>
            <th
              colSpan={2}
              className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200 bg-purple-50"
            >
              Current
            </th>
            <th
              colSpan={2}
              className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200 bg-green-50"
            >
              Cumulative
            </th>
            <th rowSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200">
              Target (%)
            </th>
            <th rowSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700">
              Variance (%)
            </th>
          </tr>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-600 border-r border-gray-200 bg-blue-50">
              Progress (%)
            </th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-600 border-r border-gray-200 bg-blue-50">
              WF (%)
            </th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-600 border-r border-gray-200 bg-purple-50">
              Progress (%)
            </th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-600 border-r border-gray-200 bg-purple-50">
              WF (%)
            </th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-600 border-r border-gray-200 bg-green-50">
              Progress (%)
            </th>
            <th className="px-4 py-2 text-center text-xs font-medium text-gray-600 border-r border-gray-200 bg-green-50">
              WF (%)
            </th>
          </tr>
        </thead>
        <tbody>
          {roots.map((item, idx) => (
            <tr
              key={item.id}
              className="border-b border-gray-200 transition-colors hover:bg-gray-50 animate-fade-in-up"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <td className="px-4 py-3 text-center border-r border-gray-200">{idx + 1}</td>
              <td className="px-4 py-3 border-r border-gray-200">{item.deskripsi}</td>
              <td className="px-4 py-3 text-center border-r border-gray-200">{item.bobot.toFixed(2)}</td>
              <td className="px-4 py-3 text-right border-r border-gray-200">{item.prevProgressPct.toFixed(2)}</td>
              <td className="px-4 py-3 text-right border-r border-gray-200">{item.prevWF.toFixed(2)}</td>
              <td className="px-4 py-3 text-right border-r border-gray-200">{item.thisWeekProgressPct.toFixed(2)}</td>
              <td className="px-4 py-3 text-right border-r border-gray-200">{item.thisWeekWF.toFixed(2)}</td>
              <td className="px-4 py-3 text-right border-r border-gray-200">{item.curProgressPct.toFixed(2)}</td>
              <td className="px-4 py-3 text-right border-r border-gray-200">{item.curWF.toFixed(2)}</td>
              <td className="px-4 py-3 text-right border-r border-gray-200">{item.targetWF.toFixed(2)}</td>
              <td
                className={`px-4 py-3 text-right font-medium ${
                  item.variance < 0 ? 'text-red-600' : 'text-green-600'
                }`}
              >
                {item.variance.toFixed(2)}
              </td>
            </tr>
          ))}
          <tr className="bg-yellow-50 font-semibold animate-fade-in-up" style={{ animationDelay: `${roots.length * 60}ms` }}>
            <td className="px-4 py-3 text-center border-r border-gray-200"></td>
            <td className="px-4 py-3 border-r border-gray-200">GRAND TOTAL</td>
            <td className="px-4 py-3 text-center border-r border-gray-200">{grandTotal.bobot.toFixed(2)}</td>
            <td className="px-4 py-3 text-right border-r border-gray-200">{grandTotal.prevProgressPct.toFixed(2)}</td>
            <td className="px-4 py-3 text-right border-r border-gray-200">{grandTotal.prevWF.toFixed(2)}</td>
            <td className="px-4 py-3 text-right border-r border-gray-200">
              {grandTotal.thisWeekProgressPct.toFixed(2)}
            </td>
            <td className="px-4 py-3 text-right border-r border-gray-200">{grandTotal.thisWeekWF.toFixed(2)}</td>
            <td className="px-4 py-3 text-right border-r border-gray-200">{grandTotal.curProgressPct.toFixed(2)}</td>
            <td className="px-4 py-3 text-right border-r border-gray-200">{grandTotal.curWF.toFixed(2)}</td>
            <td className="px-4 py-3 text-right border-r border-gray-200">{grandTotal.targetWF.toFixed(2)}</td>
            <td className={`px-4 py-3 text-right ${grandTotal.variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
              {grandTotal.variance.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
