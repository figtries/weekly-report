import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { flattenTree } from '@/lib/rollup';
import WbsTreeVisual from '@/components/weekly/WbsTreeVisual';
import WeeklyPrintDetail from '@/components/print/WeeklyPrintDetail';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function DetailProgressPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const result = getWeekRollup(db, week);
  if (!result) notFound();
  const { meta, roots } = result;
  const leafCount = flattenTree(roots).filter((n) => n.children.length === 0).length;

  return (
    <>
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in-up print:hidden">
        <div className="mb-5 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-1 sm:mb-2">Detail Progress</h1>
          <p className="text-sm sm:text-base text-gray-600">
            Full WBS breakdown — Week {week} · {leafCount} activity items · edit in{' '}
            <span className="font-medium text-blue-600">Data Overall</span>
          </p>
        </div>
        <WbsTreeVisual roots={roots} />
      </div>
      {/* A4 report sheet, only visible on paper */}
      <div className="hidden print:block">
        <WeeklyPrintDetail project={db.project} meta={meta} roots={roots} />
      </div>
    </>
  );
}
