import { notFound } from 'next/navigation';
import { getCachedWeekRollup, getDb } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import { buildSCurveSeries } from '@/lib/scurve';
import WeeklyPrintSummary from '@/components/print/WeeklyPrintSummary';
import WeeklyPrintDetail from '@/components/print/WeeklyPrintDetail';
import WeeklyPrintSCurve from '@/components/print/WeeklyPrintSCurve';
import WeeklyPrintDocumentation from '@/components/print/WeeklyPrintDocumentation';
import NoLegacyData from '@/components/projects/NoLegacyData';
import { getOpenProject } from '@/lib/legacy-bridge';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function WeeklyPrintPage({ params }: { params: Promise<{ week: string }> }) {
  // The v1 pages read db.json while projects are chosen in SQLite, so the open
  // project may have nothing here. The check sits on the page rather than the
  // layout because a layout that skips its children fails unstable_instant
  // validation at build time. See lib/legacy-bridge.ts.
  const openProject = getOpenProject();
  if (openProject && !openProject.hasLegacyData) return <NoLegacyData what="weekly reports" />;

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
