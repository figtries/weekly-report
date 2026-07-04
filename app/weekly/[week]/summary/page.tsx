import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import SummaryCards from '@/components/weekly/SummaryCards';
import WeeklyPrintSummary from '@/components/print/WeeklyPrintSummary';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function SummaryPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const result = getWeekRollup(db, week);
  if (!result) notFound();
  const { meta, roots, grandTotal } = result;
  const summaryRows = getSummaryRows(roots);

  return (
    <>
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in-up print:hidden">
        <div className="mb-5 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-1 sm:mb-2">Overall Summary</h1>
          <p className="text-sm sm:text-base text-gray-600">
            Progress per SPK contract — Week {week}.
          </p>
        </div>

        <SummaryCards roots={summaryRows} grandTotal={grandTotal} />
      </div>
      {/* A4 report sheet, only visible on paper */}
      <div className="hidden print:block">
        <WeeklyPrintSummary project={db.project} meta={meta} roots={summaryRows} grandTotal={grandTotal} />
      </div>
    </>
  );
}
