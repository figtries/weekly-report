import { notFound } from 'next/navigation';
import { getOpenDb, getOpenWeekRollup } from '@/lib/data';
import { flattenTree } from '@/lib/rollup';
import WbsTreeVisual from '@/components/weekly/WbsTreeVisual';
import PageHeader from '@/components/layout/PageHeader';
import SectionSwitch from '@/components/weekly/SectionSwitch';
import { RouteTransition } from '@/components/motion/RouteTransition';
import LegacyGate from '@/components/projects/LegacyGate';
import { weightGateView } from '@/components/weekly/WeightGateView';

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
 *
 * THE TRANSITION WRAPS THE GATE, NOT THE BODY, as it does on the dashboard.
 * Inside the gate, the boundary only mounted when the streamed body arrived,
 * so that arrival ran a SECOND view transition after the route's own: the
 * screen froze for the snapshot, then the skeleton's picture was laid over the
 * page and faded out for 250ms, right across the Set-as-current button and the
 * progress card while they played their entrances (27 Sep 2026, arriving from
 * the dashboard's "All items"). Mounted with the route, the body's arrival is
 * an update this boundary does not animate, and the entrances run clean.
 */
export default function DetailProgressPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <RouteTransition id="weekly-detail">
      <LegacyGate what="weekly reports" planned>
        <DetailProgressPageBody params={params} />
      </LegacyGate>
    </RouteTransition>
  );
}

async function DetailProgressPageBody({ params }: { params: Promise<{ week: string }> }) {

  const { week: weekParam } = await params;
  const week = Number(weekParam);

  // No figure until the weights close — see lib/weight-gate.ts.
  const held = await weightGateView(week);
  if (held) return held;
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
    <div className="px-3 py-4 sm:p-6 lg:p-8 print:hidden">
      <PageHeader
        section="Weekly Progress"
        title="Detail Progress"
        className="animate-enter"
        action={<SectionSwitch week={week} to="data" />}
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
  );
}
