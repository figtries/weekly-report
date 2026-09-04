import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import { StageWeightsCard } from '@/components/dokumen/StageWeightsCard';
import {
  getEngineeringBridge, getObstacles, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree, getStageWeights, getWeekMovement,
} from '@/lib/register';

export const metadata = { title: 'EDL Summary' };

const PROJECT_ID = 'gundih';

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
export default async function EdlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const shape = getRegisterShape(PROJECT_ID, 'edl');
  const summary = shape.documents > 0 ? getRegisterSummary(PROJECT_ID, 'edl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(PROJECT_ID);
    return (
      <RouteTransition id="dokumen-edl-summary">
        <RegisterBuilder
          projectId={PROJECT_ID}
          register="edl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
        />
      </RouteTransition>
    );
  }

  const tree = getRegisterTree(PROJECT_ID, 'edl', week);
  // A and B are the sheet's own two bands; what a controller works in is the
  // level below — General, Procedure, Process, Mechanical, Electrical, Instrument.
  const groups = tree.flatMap((root) => (root.children.length > 0 ? root.children : [root]));

  return (
    <RouteTransition id="dokumen-edl-summary">
    <SummaryScreen
      summary={summary}
      groups={groups}
      obstacles={getObstacles(PROJECT_ID, 'edl', week)}
      movement={getWeekMovement(PROJECT_ID, 'edl', week)}
      bridge={getEngineeringBridge(PROJECT_ID, week)}
      groupNoun="disciplines"
      groupsTitle="By discipline"
    />

    <div className="mt-6">
      <StageWeightsCard
        projectId={PROJECT_ID}
        register="edl"
        weights={getStageWeights(PROJECT_ID, 'edl')}
      />
    </div>
    </RouteTransition>
  );
}
