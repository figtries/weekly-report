import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import { buildSCurveSeries } from '@/lib/scurve';
import WeeklyPrintSummary from '@/components/print/WeeklyPrintSummary';
import WeeklyPrintDetail from '@/components/print/WeeklyPrintDetail';
import WeeklyPrintSCurve from '@/components/print/WeeklyPrintSCurve';
import WeeklyPrintDocumentation from '@/components/print/WeeklyPrintDocumentation';
import PrintTrigger from '@/components/ui/PrintTrigger';

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
    <div className="bg-gray-100 min-h-full">
      <div className="sticky top-0 z-20 flex justify-center border-b border-gray-200 bg-white py-3 print:hidden">
        <PrintTrigger label={`Print Weekly Report No. ${week}`} />
      </div>
      <div className="flex flex-col items-center gap-6 py-6">
        <WeeklyPrintSummary project={db.project} meta={meta} roots={summaryRows} grandTotal={grandTotal} />
        <WeeklyPrintDetail project={db.project} meta={meta} roots={roots} />
        <WeeklyPrintSCurve project={db.project} meta={meta} series={series} />
        <WeeklyPrintDocumentation project={db.project} meta={meta} />
      </div>
    </div>
  );
}
