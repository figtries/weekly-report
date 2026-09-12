import { ScrollReveal } from '@/components/motion/ScrollReveal';
import { Suspense } from 'react';
import Link from 'next/link';
import { connection } from 'next/server';
import { weatherLabels } from '@/lib/catalogs';
import { getDb, getOpenJsonDb } from '@/lib/data';
import { readOpenDb } from '@/lib/db';
import DailyForm from '@/components/daily/DailyForm';
import CreateReportHere from '@/components/daily/CreateReportHere';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import DailyDetailLoading from './loading';

// No unstable_instant here: with every date enumerated by generateStaticParams
// and the whole page cached, default link prefetching already carries the full
// content. The previous `prefetch: 'runtime'` config made navigations stop at
// the loading skeleton — the rest of the payload never streamed in, so day
// clicks appeared to hang.

/**
 * A HEAD START, NOT A WHITELIST — and it cannot be per project.
 *
 * This runs at build time, where there is no request and therefore no open
 * project (see the weekly layout's copy of this note). It names the imported
 * project's dates because those are the only ones a build can see; every other
 * project's day renders on demand, which is correct — the whole body of this
 * page sits behind `<Suspense>` and is resolved per request anyway.
 */
export async function generateStaticParams() {
  const db = await getDb();
  return db.daily.map((d) => ({ date: d.date }));
}

async function DailyDetail({ date }: { date: string }) {
  // The OPEN project's day, not the file's. See lib/legacy-bridge.ts.
  const db = await getOpenJsonDb();
  const labels = weatherLabels(db);
  let report = db.daily.find((d) => d.date === date);

  if (!report) {
    // Render this branch per request, never from cache: on Vercel a lambda
    // that hasn't seen the latest tag purge could otherwise render a miss for
    // a date that DOES exist, and that stale miss would be stored as the
    // path's cached entry until the next mutation. With connection() the miss
    // is dynamic — every visit re-checks.
    await connection();
    // The cached read above can lag behind a just-created or just-edited
    // report on such a lambda. Re-check the source of truth before declaring
    // the report missing, so tapping an existing report never lands on the
    // empty "no report" state.
    const fresh = await readOpenDb();
    report = fresh?.daily.find((d) => d.date === date);
  }

  if (!report) {
    const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <Link
          href="/daily"
          className="mb-4 inline-flex items-center gap-2 text-muted-foreground transition-all duration-200 ease-ios hover:text-foreground active:scale-[0.96]"
          aria-label="Back to daily reports"
        >
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </Link>
        <div className="rounded-lg border border-dashed border-input bg-card p-10 text-center animate-fade-in-up">
          <p className="text-muted-foreground">No daily report exists for {date} yet.</p>
          {isValidDate && <CreateReportHere date={date} />}
          <Link href="/daily" className="mt-3 inline-block text-sm text-chart-1 transition-colors hover:text-chart-1">
            Back to Daily Reports
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 print:p-0">
      <DailyForm report={report} weatherLabels={labels} />
      {/* The last thing on the longest screen in the app: reached, not
          animated on a delay two screens above it. */}
      <ScrollReveal>
      <section className="mt-6 rounded-lg border border-border bg-card p-4 sm:p-6 shadow-sm print:hidden">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Documentation</h2>
        <PhotoUploadGrid photos={report.photos} uploadUrl={`/api/daily/${date}/photos`} />
      </section>
      </ScrollReveal>
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
