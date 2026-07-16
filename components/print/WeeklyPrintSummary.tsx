'use client';

import PrintHeader from './PrintHeader';
import PrintFooter from './PrintFooter';
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
    <div className="print-sheet-a4">
      <PrintHeader
        title={`Weekly Report No. ${meta.week}`}
        subtitle={project.name}
        period={weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
      />

      <h2 className="rpt-section">Overall Progress Summary</h2>

      <table className="rpt-table">
        <thead>
          <tr>
            <th rowSpan={2} style={{ width: '7%' }}>
              No.
            </th>
            <th rowSpan={2} style={{ textAlign: 'left' }}>
              Description
            </th>
            <th rowSpan={2}>
              Weight
              <br />
              (%)
            </th>
            <th colSpan={2}>Last Week</th>
            <th colSpan={2}>This Week</th>
            <th colSpan={2}>Cumm. This Week</th>
            <th rowSpan={2}>
              Plan
              <br />
              (%)
            </th>
            <th rowSpan={2}>
              Variance
              <br />
              (%)
            </th>
          </tr>
          <tr>
            <th>Progress</th>
            <th>
              WF
              <br />
              (%)
            </th>
            <th>Progress</th>
            <th>
              WF
              <br />
              (%)
            </th>
            <th>Progress</th>
            <th>
              WF
              <br />
              (%)
            </th>
          </tr>
        </thead>
        <tbody>
          {roots.map((item, idx) => (
            <tr key={item.id}>
              <td className="rpt-num">{idx + 1}</td>
              <td>{item.deskripsi}</td>
              <td className="rpt-num">{item.bobot.toFixed(2)}%</td>
              <td className="rpt-num">{item.prevProgressPct.toFixed(2)}%</td>
              <td className="rpt-num">{item.prevWF.toFixed(2)}%</td>
              <td className="rpt-num">{item.thisWeekProgressPct.toFixed(2)}%</td>
              <td className="rpt-num">{item.thisWeekWF.toFixed(2)}%</td>
              <td className="rpt-num">{item.curProgressPct.toFixed(2)}%</td>
              <td className="rpt-num">{item.curWF.toFixed(2)}%</td>
              <td className="rpt-num">{item.targetWF.toFixed(2)}%</td>
              <td className="rpt-num">{item.variance.toFixed(2)}%</td>
            </tr>
          ))}
          <tr className="rpt-total">
            <td />
            <td>GRAND TOTAL</td>
            <td className="rpt-num">{grandTotal.bobot.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.prevProgressPct.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.prevWF.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.thisWeekProgressPct.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.thisWeekWF.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.curProgressPct.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.curWF.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.targetWF.toFixed(2)}%</td>
            <td className="rpt-num">{grandTotal.variance.toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>

      <PrintFooter docNo={project.documentNoWeekly} page={1} total={1} />
    </div>
  );
}
