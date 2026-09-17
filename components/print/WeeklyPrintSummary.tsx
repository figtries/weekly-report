'use client';

import PrintHeader from './PrintHeader';
import PrintFooter from './PrintFooter';
import type { GrandTotal, SummaryRow } from '@/lib/rollup';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { weekPeriodLabel } from '@/lib/weeks';

/**
 * Units per printed page. The sheet's own chrome (header, section title, table
 * head, footer, print padding) measures ~94mm, leaving ~168mm of the 262mm
 * budget for rows; a row is 6.7mm on one line and 17.7mm when its description
 * wraps to two, so eight rows survive even if every one of them wraps.
 *
 * It only started mattering when the summary learned to group a plan with no
 * SPK contracts in it: four contracts were always going to fit, thirteen
 * sections came to 228mm, and the next project along would have split the
 * sheet and blanked the page before it. Never raise it without re-measuring.
 */
const ROWS_PER_PAGE = 8;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
  // An empty plan still prints its sheet, with the grand total on it: a report
  // that renders no sheet at all is what `lib/pdf.ts` waits forever for.
  const pages = roots.length ? chunk(roots, ROWS_PER_PAGE) : [[]];

  return (
    <>
      {pages.map((rows, pageIdx) => (
    <div key={pageIdx} className="print-sheet-a4">
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
          {rows.map((item, idx) => (
            <tr key={item.id}>
              <td className="rpt-num">{pageIdx * ROWS_PER_PAGE + idx + 1}</td>
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
          {/* The total belongs to the whole table, so it prints once, at the
              foot of the last sheet — a GRAND TOTAL repeated on page one of
              two is a figure the reader has to be told to ignore. */}
          {pageIdx === pages.length - 1 && (
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
          )}
        </tbody>
      </table>

      <PrintFooter docNo={project.documentNoWeekly} page={pageIdx + 1} total={pages.length} />
    </div>
      ))}
    </>
  );
}
