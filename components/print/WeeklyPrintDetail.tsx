import PrintHeader from './PrintHeader';
import { flattenTree, type RollupNode } from '@/lib/rollup';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { weekPeriodLabel } from '@/lib/weeks';

const ROWS_PER_PAGE = 34;

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
  const flat = flattenTree(roots);
  const pages = chunk(flat, ROWS_PER_PAGE);

  return (
    <>
      {pages.map((rows, pageIdx) => (
        <div
          key={pageIdx}
          className="bg-white text-black"
          style={{ width: '210mm', minHeight: '297mm', padding: '12mm', margin: '0 auto', pageBreakAfter: 'always' }}
        >
          <PrintHeader
            title="DETAIL OVERALL PROGRESS"
            subtitle={project.name.toUpperCase()}
            period={weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
          />
          <table className="w-full border-collapse border-2 border-black" style={{ fontSize: '7px' }}>
            <thead>
              <tr className="bg-gray-300">
                <th rowSpan={2} className="border border-black px-1 py-1 text-center font-bold" style={{ width: '9%' }}>
                  WBS
                </th>
                <th rowSpan={2} className="border border-black px-1 py-1 text-left font-bold" style={{ width: '29%' }}>
                  DESKRIPSI
                </th>
                <th rowSpan={2} className="border border-black px-1 py-1 text-center font-bold">
                  BOBOT (%)
                </th>
                <th colSpan={2} className="border border-black px-1 py-1 text-center font-bold">
                  MINGGU LALU
                </th>
                <th colSpan={2} className="border border-black px-1 py-1 text-center font-bold">
                  MINGGU INI
                </th>
                <th colSpan={2} className="border border-black px-1 py-1 text-center font-bold">
                  CUMM. MINGGU INI
                </th>
                <th rowSpan={2} className="border border-black px-1 py-1 text-center font-bold">
                  TARGET (%)
                </th>
                <th rowSpan={2} className="border border-black px-1 py-1 text-center font-bold">
                  VARIANCE (%)
                </th>
              </tr>
              <tr className="bg-gray-300">
                <th className="border border-black px-1 py-0.5 text-center font-bold">Progress</th>
                <th className="border border-black px-1 py-0.5 text-center font-bold">WF (%)</th>
                <th className="border border-black px-1 py-0.5 text-center font-bold">Progress</th>
                <th className="border border-black px-1 py-0.5 text-center font-bold">WF (%)</th>
                <th className="border border-black px-1 py-0.5 text-center font-bold">Progress</th>
                <th className="border border-black px-1 py-0.5 text-center font-bold">WF (%)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((node) => (
                <tr key={node.id} className={node.children.length ? 'font-semibold' : ''}>
                  <td className="border border-black px-1 py-0.5">{node.wbsCode}</td>
                  <td className="border border-black px-1 py-0.5" style={{ paddingLeft: 2 + node.depth * 6 }}>
                    {node.deskripsi}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-center">
                    {node.bobot ? node.bobot.toFixed(2) : ''}
                  </td>
                  <td className="border border-black px-1 py-0.5 text-center">{node.prevProgressPct.toFixed(2)}%</td>
                  <td className="border border-black px-1 py-0.5 text-center">{node.prevWF.toFixed(2)}%</td>
                  <td className="border border-black px-1 py-0.5 text-center">
                    {node.thisWeekProgressPct.toFixed(2)}%
                  </td>
                  <td className="border border-black px-1 py-0.5 text-center">{node.thisWeekWF.toFixed(2)}%</td>
                  <td className="border border-black px-1 py-0.5 text-center">{node.curProgressPct.toFixed(2)}%</td>
                  <td className="border border-black px-1 py-0.5 text-center">{node.curWF.toFixed(2)}%</td>
                  <td className="border border-black px-1 py-0.5 text-center">{node.targetWF.toFixed(2)}%</td>
                  <td className="border border-black px-1 py-0.5 text-center">{node.variance.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-right text-gray-500" style={{ fontSize: '9px' }}>
            {pageIdx + 1} of {pages.length}
          </p>
        </div>
      ))}
    </>
  );
}
