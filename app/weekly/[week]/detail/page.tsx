import { notFound } from 'next/navigation';
import { getOpenDb, getOpenWeekRollup } from '@/lib/data';
import { flattenTree } from '@/lib/rollup';
import WbsTreeVisual from '@/components/weekly/WbsTreeVisual';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts); this validation
  // refuses any read it has not been told about. A null value samples the
  // visitor who has never chosen a project.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
  unstable_disableValidation: true,
};

/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function DetailProgressPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <LegacyGate what="weekly reports" planned>
      <DetailProgressPageBody params={params} />
    </LegacyGate>
  );
}

async function DetailProgressPageBody({ params }: { params: Promise<{ week: string }> }) {

  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const [db, result] = await Promise.all([getOpenDb(), getOpenWeekRollup(week)]);
  if (!result) notFound();
  const { roots } = result;
  const weightsLocked = db.project.weightsLocked !== false;
  // The same leaves the page itself counts: on a LOCKED plan a zero-weight row
  // is a milestone marker rather than an activity, and every weekly UI hides
  // it — counting them here put "218 activities" in the title above a hero
  // reading "176 activities". Where the weights are derived the tree shows
  // those rows, so the title has to count them too or it disagrees with the
  // page underneath it.
  const leafCount = flattenTree(roots).filter(
    (n) => n.children.length === 0 && (!weightsLocked || n.bobot > 0)
  ).length;

  return (
    <RouteTransition id="weekly-detail">
      <div className="px-3 py-4 sm:p-6 lg:p-8 print:hidden">
        <PageHeader
          section="Weekly Progress"
          title="Detail Progress"
          className="animate-enter"
        >
          <span className="font-medium text-foreground">Week {week}</span> · {leafCount} activities.{' '}
          <span className="hidden sm:inline">The numbers are edited in </span>
          <span className="sm:hidden">Edit in </span>
          <span className="font-semibold text-foreground">Fill in</span>.
        </PageHeader>
        {/* One step behind the header, and no further: this tree can render
            every leaf at once, so nothing inside it is staggered per row. */}
        <div className="animate-enter stagger-1">
          <WbsTreeVisual roots={roots} weightsLocked={weightsLocked} />
        </div>
      </div>
    </RouteTransition>
  );
}
