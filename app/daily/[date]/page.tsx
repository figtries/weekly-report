import { Suspense } from 'react';
import { getDb } from '@/lib/data';
import DailyForm from '@/components/daily/DailyForm';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import DailyDetailLoading from './loading';

// No unstable_instant here: with every date enumerated by generateStaticParams
// and the whole page cached, default link prefetching already carries the full
// content. The previous `prefetch: 'runtime'` config made navigations stop at
// the loading skeleton — the rest of the payload never streamed in, so day
// clicks appeared to hang.

export async function generateStaticParams() {
  const db = await getDb();
  return db.daily.map((d) => ({ date: d.date }));
}

async function DailyDetail({ date }: { date: string }) {
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
    <div className="p-4 sm:p-6 lg:p-8 print:p-0">
      <DailyForm report={report} project={db.project} />
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm animate-fade-in-up print:hidden">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Documentation</h2>
        <PhotoUploadGrid photos={report.photos} uploadUrl={`/api/daily/${date}/photos`} />
      </section>
    </div>
  );
}

export default function DailyDetailPage({ params }: { params: Promise<{ date: string }> }) {
  return (
    <Suspense fallback={<DailyDetailLoading />}>
      {params.then(({ date }) => (
        <DailyDetail date={date} />
      ))}
    </Suspense>
  );
}
