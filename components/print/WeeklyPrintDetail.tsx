'use client';

import PrintHeader from './PrintHeader';
import PrintFooter from './PrintFooter';
import { flattenTree, type RollupNode } from '@/lib/rollup';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { weekPeriodLabel } from '@/lib/weeks';

// Rows per printed page. Sized so a sheet stays well under the smallest
// printable area on any device (see .print-sheet-a4) even when several
// descriptions wrap to two lines — never raise it without re-measuring.
const ROWS_PER_PAGE = 32;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function WeeklyPrintDetail({
  project,
  meta,
  roots,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
  roots: RollupNode[];
}) {
  const flat = flattenTree(roots).filter(
    (n) => !(n.children.length === 0 && n.bobot === 0),
  );
  const pages = chunk(flat, ROWS_PER_PAGE);

  return (
    <>
      {pages.map((rows, pageIdx) => (
        <div key={pageIdx} className="print-sheet-a4">
          <PrintHeader
            title={`Detail Overall Progress — Week ${meta.week}`}
            subtitle={project.name}
            period={weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
          />
          <table className="rpt-table rpt-table--dense">
            <thead>
              <tr>
                <th rowSpan={2} style={{ width: '9%' }}>
                  WBS
                </th>
                <th rowSpan={2} style={{ width: '29%', textAlign: 'left' }}>
                  Description
                </th>
                <th rowSpan={2}>Weight (%)</th>
                <th colSpan={2}>Last Week</th>
                <th colSpan={2}>This Week</th>
                <th colSpan={2}>Cumm. This Week</th>
                <th rowSpan={2}>Plan (%)</th>
                <th rowSpan={2}>Variance (%)</th>
              </tr>
              <tr>
                <th>Progress</th>
                <th>WF (%)</th>
                <th>Progress</th>
                <th>WF (%)</th>
                <th>Progress</th>
                <th>WF (%)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((node) => (
                <tr key={node.id} className={node.children.length ? 'rpt-group' : undefined}>
                  <td>{node.wbsCode}</td>
                  <td style={{ paddingLeft: `${1.1 + node.depth * 1.6}mm` }}>{node.deskripsi}</td>
                  <td className="rpt-num">{node.bobot ? node.bobot.toFixed(2) : ''}</td>
                  <td className="rpt-num">{node.prevProgressPct.toFixed(2)}%</td>
                  <td className="rpt-num">{node.prevWF.toFixed(2)}%</td>
                  <td className="rpt-num">{node.thisWeekProgressPct.toFixed(2)}%</td>
                  <td className="rpt-num">{node.thisWeekWF.toFixed(2)}%</td>
                  <td className="rpt-num">{node.curProgressPct.toFixed(2)}%</td>
                  <td className="rpt-num">{node.curWF.toFixed(2)}%</td>
                  <td className="rpt-num">{node.targetWF.toFixed(2)}%</td>
                  <td className="rpt-num">{node.variance.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <PrintFooter docNo={project.documentNoWeekly} page={pageIdx + 1} total={pages.length} />
        </div>
      ))}
    </>
  );
}
