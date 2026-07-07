import { notFound } from 'next/navigation';
import { getCachedWeekRollup, getDb } from '@/lib/data';
import { flattenTree } from '@/lib/rollup';
import WbsTreeVisual from '@/components/weekly/WbsTreeVisual';
import PrintDetailLazy from '@/components/print/PrintDetailLazy';

export const unstable_instant = {
  prefetch: 'runtime',
  samples: [{ params: { week: '1' } }],
  unstable_disableValidation: true,
};

export default async function DetailProgressPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const [db, result] = await Promise.all([getDb(), getCachedWeekRollup(week)]);
  if (!result) notFound();
  const { meta, roots } = result;
  const leafCount = flattenTree(roots).filter((n) => n.children.length === 0).length;

  return (
    <>
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in-up print:hidden">
        <div className="mb-5 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-1 sm:mb-2">Detail Progress</h1>
          <p className="text-xs sm:text-base text-gray-600">
            Week {week} · {leafCount} activities.{' '}
            <span className="hidden sm:inline">Explore by contract — numbers are edited in </span>
            <span className="sm:hidden">Edit in </span>
            <span className="font-medium text-blue-600">Data Overall</span>.
          </p>
        </div>
        <WbsTreeVisual roots={roots} />
      </div>
      {/* A4 report sheet, only visible on paper — lazy-loaded client-side to
         avoid blocking the server render with ~3 000 table cells */}
      <PrintDetailLazy project={db.project} meta={meta} roots={roots} />
    </>
  );
}
