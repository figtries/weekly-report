import { notFound } from 'next/navigation';
import { getDb, getWeekMeta } from '@/lib/data';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';

export default async function DocumentationPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const meta = getWeekMeta(db, week);
  if (!meta) notFound();

  return (
    <div className="p-8 animate-fade-in-up">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Documentation</h1>
        <p className="text-gray-600">Field photos for Week {week} — up to 6 images</p>
      </div>
      <PhotoUploadGrid photos={meta.documentation} uploadUrl={`/api/weeks/${week}/photos`} />
    </div>
  );
}
