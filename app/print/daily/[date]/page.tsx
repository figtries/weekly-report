import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getDb } from '@/lib/data';
import { readDb } from '@/lib/db';
import DailyPrintReport from '@/components/print/DailyPrintReport';

// The page headless Chromium renders into the daily PDF (see lib/pdf.ts).
// The uncached readDb() fallback must sit behind Suspense or the build fails
// with "Uncached data was accessed outside of <Suspense>" (cacheComponents).
// A null fallback is fine: lib/pdf.ts waits for the .print-sheet-a4 selector
// before it snapshots anything.
export default function DailyPrintPage({ params }: { params: Promise<{ date: string }> }) {
  return (
    <Suspense fallback={null}>
      <DailyPrintBody params={params} />
    </Suspense>
  );
}

async function DailyPrintBody({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const db = await getDb();
  let report = db.daily.find((d) => d.date === date);
  let project = db.project;

  if (!report) {
    // Same reason as the daily editor: a lambda that hasn't seen the latest tag
    // purge can render a stale miss for a date that does exist. Re-check the
    // source of truth before giving up — a print that 404s on a report the user
    // is looking at would be baffling.
    await connection();
    const fresh = await readDb();
    report = fresh.daily.find((d) => d.date === date);
    project = fresh.project;
  }
  if (!report) notFound();

  return (
    <div className="bg-gray-100 min-h-full overflow-x-auto print:overflow-visible">
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:block print:w-auto print:min-w-0 print:gap-0 print:p-0">
        <DailyPrintReport project={project} report={report} />
      </div>
    </div>
  );
}
