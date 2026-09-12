import { notFound } from 'next/navigation';
import { getOpenDb, getWeekMeta, getOpenSCurveSeries } from '@/lib/data';
import SCurveClient from '@/components/weekly/SCurveClient';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts); this validation
  // refuses any read it has not been told about. A null value samples the
  // visitor who has never chosen a project.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
};

/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function SCurvePage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <LegacyGate what="weekly reports" planned>
      <SCurvePageBody params={params} />
    </LegacyGate>
  );
}

async function SCurvePageBody({ params }: { params: Promise<{ week: string }> }) {

  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const [db, series] = await Promise.all([
    getOpenDb(),
    getOpenSCurveSeries(week),
  ]);
  const meta = getWeekMeta(db, week);
  if (!meta) notFound();

  const current = series.find((r) => r.week === week);
  // Future weeks have no actual point on the curve — fall back to the latest
  // reported actual so the stat card matches the Data Overall page.
  const lastActual = [...series].reverse().find((r) => r.actualPct !== null)?.actualPct ?? null;

  return (
    <RouteTransition id="weekly-scurve">
      {/* Scrolls like the other three sheets. It used to be a viewport-height
          flex column with the chart as the only growing child — see
          SCurveClient for why that had to go. */}
      <div className="px-3 py-4 sm:px-6 sm:py-6 lg:px-8 print:hidden">
        <PageHeader section="Weekly Progress" title="S-Curve" className="mb-4 animate-enter">
          <span className="font-medium text-foreground">Week {week}</span> · Plan against actual,
          week by week.
        </PageHeader>
        <div className="animate-enter stagger-1">
          <SCurveClient
            series={series}
            currentWeek={week}
            planPct={current?.planPct ?? null}
            actualPct={current?.actualPct ?? lastActual}
            project={db.project}
          />
        </div>
      </div>
    </RouteTransition>
  );
}