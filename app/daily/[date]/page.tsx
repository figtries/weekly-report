import { getDb } from '@/lib/data';
import DailyForm from '@/components/daily/DailyForm';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { date: '2026-06-04' } }] };

export async function generateStaticParams() {
  const db = await getDb();
  return db.daily.map((d) => ({ date: d.date }));
}

export default async function DailyDetailPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const db = await getDb();
  const report = db.daily.find((d) => d.date === date);

  if (!report) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center animate-fade-in-up">
          <p className="text-gray-500">No daily report exists for {date} yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <DailyForm report={report} />
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm animate-fade-in-up">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Documentation</h2>
        <PhotoUploadGrid photos={report.photos} uploadUrl={`/api/daily/${date}/photos`} />
      </section>
    </div>
  );
}
