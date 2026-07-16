import { notFound } from 'next/navigation';
import { getCachedWeekRollup } from '@/lib/data';
import { flattenTree } from '@/lib/rollup';
import WbsTreeVisual from '@/components/weekly/WbsTreeVisual';

export const unstable_instant = {
  prefetch: 'runtime',
  samples: [{ params: { week: '1' } }],
  unstable_disableValidation: true,
};

export default async function DetailProgressPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const result = await getCachedWeekRollup(week);
  if (!result) notFound();
  const { roots } = result;
  const leafCount = flattenTree(roots).filter((n) => n.children.length === 0).length;

  return (
    <>
      <div className="px-3 py-4 sm:p-6 lg:p-8 animate-fade-in-up print:hidden">
        <div className="mb-5 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-1 sm:mb-2">Detail Progress</h1>
          <p className="text-xs sm:text-base text-gray-600">
            <span className="font-medium text-gray-900">Week {week}</span> · {leafCount} activities.{' '}
            <span className="hidden sm:inline">Explore by contract — numbers are edited in </span>
            <span className="sm:hidden">Edit in </span>
            <span className="font-medium text-blue-600">Data Overall</span>.
          </p>
        </div>
        <WbsTreeVisual roots={roots} />
      </div>
    </>
  );
}
