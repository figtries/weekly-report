import { Suspense } from 'react';
import { weatherLabels } from '@/lib/catalogs';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPrintJsonDb } from '@/lib/data';
import { readJsonProject, readOpenDb } from '@/lib/db';
import { jsonKeyFor } from '@/lib/legacy-bridge';
import DailyPrintReport from '@/components/print/DailyPrintReport';

// The page headless Chromium renders into the daily PDF (see lib/pdf.ts).
// The uncached readDb() fallback must sit behind Suspense or the build fails
// with "Uncached data was accessed outside of <Suspense>" (cacheComponents).
// A null fallback is fine: lib/pdf.ts waits for the .print-sheet-a4 selector
// before it snapshots anything.
type Props = {
  params: Promise<{ date: string }>;
  // `project` is set by app/api/pdf/daily/[date]/route.ts, which resolves the
  // open project in the USER's request — headless Chromium carries no cookie,
  // and a daily report belongs to one project now (see lib/legacy-bridge.ts).
  searchParams: Promise<{ project?: string }>;
};

export default function DailyPrintPage(props: Props) {
  return (
    <Suspense fallback={null}>
      <DailyPrintBody {...props} />
    </Suspense>
  );
}

async function DailyPrintBody({ params, searchParams }: Props) {
  const [{ date }, { project: projectParam }] = await Promise.all([params, searchParams]);
  const projectId = projectParam ?? null;
  const db = await getPrintJsonDb(projectId);
  const labels = weatherLabels(db);
  let report = db.daily.find((d) => d.date === date);
  let project = db.project;

  if (!report) {
    // Same reason as the daily editor: a lambda that hasn't seen the latest tag
    // purge can render a stale miss for a date that does exist. Re-check the
    // source of truth before giving up — a print that 404s on a report the user
    // is looking at would be baffling.
    await connection();
    const fresh = projectId ? await readJsonProject(jsonKeyFor(projectId)) : await readOpenDb();
    report = fresh?.daily.find((d) => d.date === date) ?? report;
    if (fresh) project = fresh.project;
  }
  if (!report) notFound();

  return (
    <div className="bg-gray-100 min-h-full overflow-x-auto print:overflow-visible">
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:block print:w-auto print:min-w-0 print:gap-0 print:p-0">
        <DailyPrintReport project={project} report={report} weatherLabels={labels} />
      </div>
    </div>
  );
}
