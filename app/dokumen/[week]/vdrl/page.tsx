import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import { StageWeightsCard } from '@/components/dokumen/StageWeightsCard';
import {
  getNumbering, getObstacles, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree, getStageWeights, getWeekMovement,
} from '@/lib/register';

export const metadata = { title: 'VDRL Summary' };

const PROJECT_ID = 'gundih';

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
  const shape = getRegisterShape(PROJECT_ID, 'vdrl');
  const summary = shape.documents > 0 ? getRegisterSummary(PROJECT_ID, 'vdrl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(PROJECT_ID);
    return (
      <RouteTransition id="dokumen-vdrl-summary">
        <RegisterBuilder
          projectId={PROJECT_ID}
          register="vdrl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
          existingSections={[]}
          numbering={getNumbering(PROJECT_ID, 'vdrl')}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition id="dokumen-vdrl-summary">
    <SummaryScreen
      summary={summary}
      // Vendor packages are the top level here — one card per package.
      groups={getRegisterTree(PROJECT_ID, 'vdrl', week)}
      obstacles={getObstacles(PROJECT_ID, 'vdrl', week)}
      movement={getWeekMovement(PROJECT_ID, 'vdrl', week)}
      groupNoun="packages"
      groupsTitle="By vendor package"
      foldEmptyGroups
    />

    <div className="mt-6">
      <StageWeightsCard
        projectId={PROJECT_ID}
        register="vdrl"
        weights={getStageWeights(PROJECT_ID, 'vdrl')}
      />
    </div>
    </RouteTransition>
  );
}
