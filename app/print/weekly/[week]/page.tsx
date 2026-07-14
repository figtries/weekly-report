import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { getCachedWeekRollup, getDb } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import { buildSCurveSeries } from '@/lib/scurve';
import WeeklyPrintSummary from '@/components/print/WeeklyPrintSummary';
import WeeklyPrintDetail from '@/components/print/WeeklyPrintDetail';
import WeeklyPrintSCurve from '@/components/print/WeeklyPrintSCurve';
import WeeklyPrintDocumentation from '@/components/print/WeeklyPrintDocumentation';

// The page headless Chromium renders into the weekly PDF (see lib/pdf.ts).
// `?only=` narrows it to one report; without it you get the whole weekly pack.
//
// Lives under /print, OUTSIDE the /weekly/[week] segment, on purpose: that
// layout's `unstable_instant` validation covers every page beneath it and
// requires each searchParam a page reads to be enumerated in its samples —
// reading `only` under the layout failed the Vercel build (July 2026), and a
// page-level `unstable_instant = false` did not exempt it.
type ReportKey = 'summary' | 'detail' | 'scurve' | 'documentation';

type Props = {
  params: Promise<{ week: string }>;
  searchParams: Promise<{ only?: string }>;
};

// Reading searchParams is dynamic, and under cacheComponents dynamic reads must
// sit behind Suspense or the build fails with "Uncached data was accessed
// outside of <Suspense>". A null fallback is fine: lib/pdf.ts waits for the
// .print-sheet-a4 selector before it snapshots anything.
export default function WeeklyPrintTarget(props: Props) {
  return (
    <Suspense fallback={null}>
      <WeeklyPrintBody {...props} />
    </Suspense>
  );
}

async function WeeklyPrintBody({ params, searchParams }: Props) {
  const [{ week: weekParam }, { only }] = await Promise.all([params, searchParams]);
  const week = Number(weekParam);
  const [db, result] = await Promise.all([getDb(), getCachedWeekRollup(week)]);
  if (!result) notFound();
  const { meta, roots, grandTotal } = result;

  const show = (key: ReportKey) => !only || only === key;

  return (
    <div className="bg-gray-100 min-h-full overflow-x-auto print:overflow-visible">
      {/* w-max keeps the fixed-width A4 sheets scrollable (not left-clipped) on small
          screens; print:block because WebKit drops page fragments inside flexboxes */}
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:block print:w-auto print:min-w-0 print:gap-0 print:p-0">
        {show('summary') && (
          <WeeklyPrintSummary
            project={db.project}
            meta={meta}
            roots={getSummaryRows(roots)}
            grandTotal={grandTotal}
          />
        )}
        {show('detail') && <WeeklyPrintDetail project={db.project} meta={meta} roots={roots} />}
        {show('scurve') && (
          <WeeklyPrintSCurve project={db.project} meta={meta} series={buildSCurveSeries(db, week)} />
        )}
        {show('documentation') && <WeeklyPrintDocumentation project={db.project} meta={meta} />}
      </div>
    </div>
  );
}
