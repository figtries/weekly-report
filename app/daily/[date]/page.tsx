import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { getDb } from '@/lib/data';
import { readDb } from '@/lib/db';
import DailyForm from '@/components/daily/DailyForm';
import CreateReportHere from '@/components/daily/CreateReportHere';
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
  let report = db.daily.find((d) => d.date === date);

  if (!report) {
    // Render this branch per request, never from cache: on Vercel a lambda
    // that hasn't seen the latest tag purge could otherwise render a miss for
    // a date that DOES exist, and that stale miss would be stored as the
    // path's cached entry until the next mutation. With connection() the miss
    // is dynamic — every visit re-checks.
    await connection();
    // The cached getDb() above can lag behind a just-created or just-edited
    // report on such a lambda. Re-check the source of truth before declaring
    // the report missing, so tapping an existing report never lands on the
    // empty "no report" state.
    const fresh = await readDb();
    report = fresh.daily.find((d) => d.date === date);
  }

  if (!report) {
    const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <Link
          href="/daily"
          className="mb-4 inline-flex items-center gap-2 text-gray-600 transition-all duration-200 ease-ios hover:text-gray-900 active:scale-[0.96]"
          aria-label="Back to daily reports"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </Link>
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-10 text-center animate-fade-in-up">
          <p className="text-gray-500">No daily report exists for {date} yet.</p>
          {isValidDate && <CreateReportHere date={date} />}
          <Link href="/daily" className="mt-3 inline-block text-sm text-blue-600 transition-colors hover:text-blue-800">
            Back to Daily Reports
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 print:p-0">
      <DailyForm report={report} />
      {/* Delay continues DailyForm's section cascade (its last card starts at 240ms). */}
      <section className="mt-6 rounded-lg border border-gray-200 bg-white p-4 sm:p-6 shadow-sm animate-fade-in-up print:hidden" style={{ animationDelay: '280ms' }}>
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
