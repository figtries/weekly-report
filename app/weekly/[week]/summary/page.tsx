import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import SummaryTable from '@/components/weekly/SummaryTable';

export default async function SummaryPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const result = getWeekRollup(db, week);
  if (!result) notFound();
  const { roots, grandTotal } = result;
  const summaryRows = getSummaryRows(roots);

  return (
    <div className="p-8 animate-fade-in-up">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Summary Table</h1>
        <p className="text-gray-600">Overall progress summary with detailed metrics — Week {week}</p>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">Progress Summary</h2>
          <p className="text-sm text-gray-600 mt-1">Rollup by SPK contract</p>
        </div>
        <SummaryTable roots={summaryRows} grandTotal={grandTotal} />
      </div>
    </div>
  );
}
