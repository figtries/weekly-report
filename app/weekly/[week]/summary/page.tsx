import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import SummaryCards from '@/components/weekly/SummaryCards';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

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
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Overall Summary</h1>
        <p className="text-gray-600">
          Progress per SPK contract — Week {week}. The ▲ mark on each bar shows where progress should be by now.
        </p>
      </div>

      <SummaryCards roots={summaryRows} grandTotal={grandTotal} />
    </div>
  );
}
