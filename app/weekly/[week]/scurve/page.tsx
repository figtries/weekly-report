import { notFound } from 'next/navigation';
import { getDb, getWeekMeta, getCachedSCurveSeries } from '@/lib/data';
import SCurveClient from '@/components/weekly/SCurveClient';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';
import NoLegacyData from '@/components/projects/NoLegacyData';
import { getOpenProject } from '@/lib/legacy-bridge';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function SCurvePage({ params }: { params: Promise<{ week: string }> }) {
  // The v1 pages read db.json while projects are chosen in SQLite, so the open
  // project may have nothing here. The check sits on the page rather than the
  // layout because a layout that skips its children fails unstable_instant
  // validation at build time. See lib/legacy-bridge.ts.
  const openProject = getOpenProject();
  if (openProject && !openProject.hasLegacyData) return <NoLegacyData what="weekly reports" />;

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