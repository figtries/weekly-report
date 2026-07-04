import { notFound } from 'next/navigation';
import { getDb, getWeekMeta } from '@/lib/data';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import WeeklyPrintDocumentation from '@/components/print/WeeklyPrintDocumentation';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function DocumentationPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const meta = getWeekMeta(db, week);
  if (!meta) notFound();

  return (
    <>
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in-up print:hidden">
        <div className="mb-5 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-1 sm:mb-2">Documentation</h1>
          <p className="text-sm sm:text-base text-gray-600">Field photos for Week {week} — 6 photos per printed page</p>
        </div>
        <PhotoUploadGrid photos={meta.documentation} uploadUrl={`/api/weeks/${week}/photos`} />
      </div>
      {/* A4 report sheet, only visible on paper */}
      <div className="hidden print:block">
        <WeeklyPrintDocumentation project={db.project} meta={meta} />
      </div>
    </>
  );
}
