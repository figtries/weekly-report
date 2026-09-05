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
 * The project this screen is about — read per request, never at module scope.
 * A module-level read is evaluated once at import and goes stale the moment
 * anyone switches project. See lib/projects.ts.
 */
function activeProjectId(): string {
  return getActiveProjectId() ?? '';
}

/**
 * The vendor register, read the same way and telling a different story.
 *
 * No vendor gave a submission date, so there is no plan curve to draw and none
 * is invented; most of what was ordered has never been sent, and that is what
 * the screen leads with. 76 packages would be a wall of empty cards, so they
 * are folded by status — only the ones that have actually moved get a card.
 */
export default async function VdrlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const shape = getRegisterShape(activeProjectId(), 'vdrl');
  const summary = shape.documents > 0 ? getRegisterSummary(activeProjectId(), 'vdrl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(activeProjectId());
    return (
      <RouteTransition id="dokumen-vdrl-summary">
        <RegisterBuilder
          projectId={activeProjectId()}
          register="vdrl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
          existingSections={[]}
          numbering={getNumbering(activeProjectId(), 'vdrl')}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition id="dokumen-vdrl-summary">
    <SummaryScreen
      summary={summary}
      // Vendor packages are the top level here — one card per package.
      groups={getRegisterTree(activeProjectId(), 'vdrl', week)}
      obstacles={getObstacles(activeProjectId(), 'vdrl', week)}
      movement={getWeekMovement(activeProjectId(), 'vdrl', week)}
      groupNoun="packages"
      groupsTitle="By vendor package"
      foldEmptyGroups
    />

    <div className="mt-6">
      <StageWeightsCard
        projectId={activeProjectId()}
        register="vdrl"
        weights={getStageWeights(activeProjectId(), 'vdrl')}
      />
    </div>
    </RouteTransition>
  );
}
