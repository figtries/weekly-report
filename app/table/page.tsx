'use client';

import { summaryData } from '@/utils/mockData';
import PrintableTable from '@/components/print/PrintableTable';

export default function TablePage() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <>
      {/* Web View */}
      <div className="p-8 print:hidden">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Summary Table</h1>
          <p className="text-gray-600">Overall progress summary with detailed metrics</p>
        </div>

        {/* Table Card */}
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Progress Summary</h2>
              <p className="text-sm text-gray-600 mt-1">Detailed breakdown by SPK</p>
            </div>
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              Print Table
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {/* Main header row */}
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
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200 bg-blue-50">
                    Previous
                  </th>
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200 bg-purple-50">
                    Current
                  </th>
                  <th colSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200 bg-green-50">
                    Cumulative
                  </th>
                  <th rowSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700 border-r border-gray-200">
                    Target (%)
                  </th>
                  <th rowSpan={2} className="px-4 py-3 text-center font-semibold text-gray-700">
                    Variance (%)
                  </th>
                </tr>
                {/* Sub-header row */}
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
                {summaryData.map((item) => {
                  const isGrandTotal = item.no === 0;
                  return (
                    <tr
                      key={item.no}
                      className={`border-b border-gray-200 hover:bg-gray-50 transition-colors ${
                        isGrandTotal ? 'bg-yellow-50 font-semibold' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-center border-r border-gray-200">
                        {isGrandTotal ? '' : item.no}
                      </td>
                      <td className="px-4 py-3 border-r border-gray-200">
                        {item.deskripsi}
                      </td>
                      <td className="px-4 py-3 text-center border-r border-gray-200">
                        {item.bobot.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right border-r border-gray-200">
                        {item.prevProgress.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right border-r border-gray-200">
                        {item.prevWF.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right border-r border-gray-200">
                        {item.curProgress.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right border-r border-gray-200">
                        {item.curWF.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right border-r border-gray-200">
                        {item.cumProgress.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right border-r border-gray-200">
                        {item.cumWF.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right border-r border-gray-200">
                        {item.target.toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium ${
                          item.variance < 0 ? 'text-red-600' : 'text-green-600'
                        }`}
                      >
                        {item.variance.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Print View */}
      <PrintableTable />
    </>
  );
}
