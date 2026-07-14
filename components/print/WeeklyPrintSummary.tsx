'use client';

import PrintHeader from './PrintHeader';
import type { GrandTotal, SummaryRow } from '@/lib/rollup';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { weekPeriodLabel } from '@/lib/weeks';

export default function WeeklyPrintSummary({
  project,
  meta,
  roots,
  grandTotal,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
  roots: SummaryRow[];
  grandTotal: GrandTotal;
}) {
  return (
    <div className="print-sheet-a4 text-black" style={{ padding: '15mm' }}>
      <PrintHeader
        title={`WEEKLY REPORT NO.${meta.week}`}
        subtitle={project.name.toUpperCase()}
        period={weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
      />

      <div className="mb-4 text-center">
        <h2 className="inline-block border-b-2 border-black pb-1 text-sm font-bold">OVERALL PROGRESS SUMMARY</h2>
      </div>

      <table className="w-full border-collapse border-2 border-black" style={{ fontSize: '10px' }}>
        <thead>
          <tr className="bg-gray-300">
            <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              NO.
            </th>
            <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              DESCRIPTION
            </th>
            <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              WEIGHT
              <br />
              (%)
            </th>
            <th colSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              LAST WEEK
            </th>
            <th colSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              THIS WEEK
            </th>
            <th colSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              CUMM. THIS WEEK
            </th>
            <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              TARGET
              <br />
              (%)
            </th>
            <th rowSpan={2} className="border border-black px-2 py-2 text-center font-bold">
              VARIANCE
              <br />
              (%)
            </th>
          </tr>
          <tr className="bg-gray-300">
            <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
              Progress
            </th>
            <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
              WF
              <br />
              (%)
            </th>
            <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
              Progress
            </th>
            <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
              WF
              <br />
              (%)
            </th>
            <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
              Progress
            </th>
            <th className="border border-black px-2 py-1 text-center font-bold" style={{ fontSize: '9px' }}>
              WF
              <br />
              (%)
            </th>
          </tr>
        </thead>
        <tbody>
          {roots.map((item, idx) => (
            <tr key={item.id}>
              <td className="border border-black px-2 py-2 text-center">{idx + 1}</td>
              <td className="border border-black px-2 py-2">{item.deskripsi}</td>
              <td className="border border-black px-2 py-2 text-center">{item.bobot.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.prevProgressPct.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.prevWF.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.thisWeekProgressPct.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.thisWeekWF.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.curProgressPct.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.curWF.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.targetWF.toFixed(2)}%</td>
              <td className="border border-black px-2 py-2 text-center">{item.variance.toFixed(2)}%</td>
            </tr>
          ))}
          <tr className="bg-white font-bold">
            <td className="border border-black px-2 py-2 text-center" />
            <td className="border border-black px-2 py-2">GRAND TOTAL</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.bobot.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.prevProgressPct.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.prevWF.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.thisWeekProgressPct.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.thisWeekWF.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.curProgressPct.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.curWF.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.targetWF.toFixed(2)}%</td>
            <td className="border border-black px-2 py-2 text-center">{grandTotal.variance.toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
