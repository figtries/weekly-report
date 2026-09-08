import { Suspense } from 'react';
import SectionSkeleton from '@/components/ui/SectionSkeleton';

import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import { StageWeightsCard } from '@/components/dokumen/StageWeightsCard';
import {
  getEngineeringBridge, getNumbering, getObstacles, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree, getStageWeights, getWeekMovement,
} from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'EDL Summary' };


/**
 * The EDL, read as of the week in the address.
 *
 * Everything on it is counted, nothing is carried over: the total, what moved
 * that week, the plan it is measured against and each discipline's deviation
 * all come out of the dates in the register. The client's own summary keeps the
 * same figures as pasted literals, which is why its "this week" column reads
 * 0.70% while the real difference is 15.99%.
 *
 * The switch that points the WBS's engineering leaves at this register used to
 * sit on this page. It is a setting, not a report, and it now lives in Project
 * Settings — the seam band on the screen links to it.
 */
/**
 * Behind a boundary because the open project is a cookie now, and a cookie is
 * an uncached read (see lib/projects.ts). Prerendering this screen would mean
 * baking one person's register into a page everyone is served.
 */
export default function EdlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <EdlSummaryPageBody params={params} />
    </Suspense>
  );
}

async function EdlSummaryPageBody({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  // The open project comes from a cookie now, so this is a per-request read
  // and cannot be baked into a shell. See lib/projects.ts.
  const projectId = (await getActiveProjectId()) ?? '';
  const shape = getRegisterShape(projectId, 'edl');
  const summary = shape.documents > 0 ? getRegisterSummary(projectId, 'edl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(projectId);
    return (
      <RouteTransition id="dokumen-edl-summary">
        <RegisterBuilder
          projectId={projectId}
          register="edl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
          existingSections={[]}
          numbering={getNumbering(projectId, 'edl')}
        />
      </RouteTransition>
    );
  }

  const tree = getRegisterTree(projectId, 'edl', week);
  // A and B are the sheet's own two bands; what a controller works in is the
  // level below — General, Procedure, Process, Mechanical, Electrical, Instrument.
  const groups = tree.flatMap((root) => (root.children.length > 0 ? root.children : [root]));

  return (
    <RouteTransition id="dokumen-edl-summary">
    <SummaryScreen
      summary={summary}
      groups={groups}
      obstacles={getObstacles(projectId, 'edl', week)}
      movement={getWeekMovement(projectId, 'edl', week)}
      bridge={getEngineeringBridge(projectId, week)}
      groupNoun="disciplines"
      groupsTitle="By discipline"
    />

    <div className="mt-6">
      <StageWeightsCard
        projectId={projectId}
        register="edl"
        weights={getStageWeights(projectId, 'edl')}
      />
    </div>
    </RouteTransition>
  );
}
