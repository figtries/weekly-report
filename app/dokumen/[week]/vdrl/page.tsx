import { Suspense } from 'react';
import SectionSkeleton from '@/components/ui/SectionSkeleton';

import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import { StageWeightsCard } from '@/components/dokumen/StageWeightsCard';
import {
  getNumbering, getObstacles, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree, getStageWeights, getWeekMovement,
} from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'VDRL Summary' };


/**
 * The vendor register, read the same way and telling a different story.
 *
 * No vendor gave a submission date, so there is no plan curve to draw and none
 * is invented; most of what was ordered has never been sent, and that is what
 * the screen leads with. 76 packages would be a wall of empty cards, so they
 * are folded by status — only the ones that have actually moved get a card.
 */
/**
 * Behind a boundary because the open project is a cookie now, and a cookie is
 * an uncached read (see lib/projects.ts). Prerendering this screen would mean
 * baking one person's register into a page everyone is served.
 */
export default function VdrlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <VdrlSummaryPageBody params={params} />
    </Suspense>
  );
}

async function VdrlSummaryPageBody({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  // The open project comes from a cookie now, so this is a per-request read
  // and cannot be baked into a shell. See lib/projects.ts.
  const projectId = (await getActiveProjectId()) ?? '';
  const shape = getRegisterShape(projectId, 'vdrl');
  const summary = shape.documents > 0 ? getRegisterSummary(projectId, 'vdrl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(projectId);
    return (
      <RouteTransition id="dokumen-vdrl-summary">
        <RegisterBuilder
          projectId={projectId}
          register="vdrl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
          existingSections={[]}
          numbering={getNumbering(projectId, 'vdrl')}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition id="dokumen-vdrl-summary">
    <SummaryScreen
      summary={summary}
      // Vendor packages are the top level here — one card per package.
      groups={getRegisterTree(projectId, 'vdrl', week)}
      obstacles={getObstacles(projectId, 'vdrl', week)}
      movement={getWeekMovement(projectId, 'vdrl', week)}
      groupNoun="packages"
      groupsTitle="By vendor package"
      foldEmptyGroups
    />

    <div className="mt-6">
      <StageWeightsCard
        projectId={projectId}
        register="vdrl"
        weights={getStageWeights(projectId, 'vdrl')}
      />
    </div>
    </RouteTransition>
  );
}
