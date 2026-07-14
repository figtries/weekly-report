import { notFound } from 'next/navigation';
import { getCachedWeekRollup, getDb } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import { buildSCurveSeries } from '@/lib/scurve';
import WeeklyPrintSummary from '@/components/print/WeeklyPrintSummary';
import WeeklyPrintDetail from '@/components/print/WeeklyPrintDetail';
import WeeklyPrintSCurve from '@/components/print/WeeklyPrintSCurve';
import WeeklyPrintDocumentation from '@/components/print/WeeklyPrintDocumentation';

// The page headless Chromium renders into a PDF (see lib/pdf.ts) — and a plain
// URL a human can open too. `?only=` narrows it to the report behind one tab;
// without it you get the whole weekly pack.
export const REPORTS = ['summary', 'detail', 'scurve', 'documentation'] as const;
export type ReportKey = (typeof REPORTS)[number];

export default async function WeeklyPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ week: string }>;
  searchParams: Promise<{ only?: string }>;
}) {
  const [{ week: weekParam }, { only }] = await Promise.all([params, searchParams]);
  const week = Number(weekParam);
  const [db, result] = await Promise.all([getDb(), getCachedWeekRollup(week)]);
  if (!result) notFound();
  const { meta, roots, grandTotal } = result;

  const show = (key: ReportKey) => !only || only === key;

  return (
    <div className="bg-gray-100 min-h-full overflow-x-auto print:overflow-visible">
      {/* w-max keeps the fixed-width A4 sheets scrollable (not left-clipped) on small
          screens; print:block because WebKit drops page fragments inside flexboxes */}
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:block print:w-auto print:min-w-0 print:gap-0 print:p-0">
        {show('summary') && (
          <WeeklyPrintSummary
            project={db.project}
            meta={meta}
            roots={getSummaryRows(roots)}
            grandTotal={grandTotal}
          />
        )}
        {show('detail') && <WeeklyPrintDetail project={db.project} meta={meta} roots={roots} />}
        {show('scurve') && (
          <WeeklyPrintSCurve project={db.project} meta={meta} series={buildSCurveSeries(db, week)} />
        )}
        {show('documentation') && <WeeklyPrintDocumentation project={db.project} meta={meta} />}
      </div>
    </div>
  );
}
