import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import { buildSCurveSeries } from '@/lib/scurve';
import WeeklyPrintSummary from '@/components/print/WeeklyPrintSummary';
import WeeklyPrintDetail from '@/components/print/WeeklyPrintDetail';
import WeeklyPrintSCurve from '@/components/print/WeeklyPrintSCurve';
import WeeklyPrintDocumentation from '@/components/print/WeeklyPrintDocumentation';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function WeeklyPrintPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const result = getWeekRollup(db, week);
  if (!result) notFound();
  const { meta, roots, grandTotal } = result;
  const summaryRows = getSummaryRows(roots);
  const series = buildSCurveSeries(db, week);

  return (
    <div className="bg-gray-100 min-h-full overflow-x-auto print:overflow-visible">
      {/* w-max keeps the fixed-width A4 sheets scrollable (not left-clipped) on small screens */}
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:w-auto print:min-w-0 print:p-0">
        <WeeklyPrintSummary project={db.project} meta={meta} roots={summaryRows} grandTotal={grandTotal} />
        <WeeklyPrintDetail project={db.project} meta={meta} roots={roots} />
        <WeeklyPrintSCurve project={db.project} meta={meta} series={series} />
        <WeeklyPrintDocumentation project={db.project} meta={meta} />
      </div>
    </div>
  );
}
