import { notFound } from 'next/navigation';
import { getCachedWeekRollup, getDb } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import { buildSCurveSeries } from '@/lib/scurve';
import WeeklyPrintSummary from '@/components/print/WeeklyPrintSummary';
import WeeklyPrintDetail from '@/components/print/WeeklyPrintDetail';
import WeeklyPrintSCurve from '@/components/print/WeeklyPrintSCurve';
import WeeklyPrintDocumentation from '@/components/print/WeeklyPrintDocumentation';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function WeeklyPrintPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <LegacyGate what="weekly reports">
      <WeeklyPrintPageBody params={params} />
    </LegacyGate>
  );
}

async function WeeklyPrintPageBody({ params }: { params: Promise<{ week: string }> }) {

  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const [db, result] = await Promise.all([getDb(), getCachedWeekRollup(week)]);
  if (!result) notFound();
  const { meta, roots, grandTotal } = result;
  const summaryRows = getSummaryRows(roots);
  const series = buildSCurveSeries(db, week);

  return (
    <div className="bg-gray-100 min-h-full overflow-x-auto print:overflow-visible">
      {/* w-max keeps the fixed-width A4 sheets scrollable (not left-clipped) on small
          screens; print:block because WebKit drops page fragments inside flexboxes */}
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:block print:w-auto print:min-w-0 print:gap-0 print:p-0">
        <WeeklyPrintSummary project={db.project} meta={meta} roots={summaryRows} grandTotal={grandTotal} />
        <WeeklyPrintDetail project={db.project} meta={meta} roots={roots} />
        <WeeklyPrintSCurve project={db.project} meta={meta} series={series} />
        <WeeklyPrintDocumentation project={db.project} meta={meta} />
      </div>
    </div>
  );
}
