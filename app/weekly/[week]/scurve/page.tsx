import { notFound } from 'next/navigation';
import { getDb, getWeekMeta, getCachedSCurveSeries } from '@/lib/data';
import PrintSCurveLazy from '@/components/print/PrintSCurveLazy';
import SCurveClient from '@/components/weekly/SCurveClient';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function SCurvePage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const [db, series] = await Promise.all([
    getDb(),
    getCachedSCurveSeries(week),
  ]);
  const meta = getWeekMeta(db, week);
  if (!meta) notFound();

  const current = series.find((r) => r.week === week);
  // Future weeks have no actual point on the curve — fall back to the latest
  // reported actual so the stat card matches the Data Overall page.
  const lastActual = [...series].reverse().find((r) => r.actualPct !== null)?.actualPct ?? null;

  return (
    <>
      <div className="h-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8 print:hidden">
        <SCurveClient
          series={series}
          currentWeek={week}
          planPct={current?.planPct ?? null}
          actualPct={current?.actualPct ?? lastActual}
          project={db.project}
        />
      </div>
      {/* A4 report sheet, only visible on paper — lazy-loaded client-side so
          it never blocks the server render of the on-screen view */}
      <PrintSCurveLazy project={db.project} meta={meta} series={series} />
    </>
  );
}