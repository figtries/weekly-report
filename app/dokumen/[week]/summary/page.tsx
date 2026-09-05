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
 * The project this screen is about.
 *
 * Until now this was the literal string 'gundih', written by hand in four
 * files, so choosing a project moved the rest of the app and left Document
 * Control behind on someone else's register. It is read per request, never
 * at module scope: a module-level read is evaluated once at import and would
 * go stale the moment anyone switched project.
 */
function activeProjectId(): string {
  // Empty is a real answer — no project means no register, and the screens
  // already know how to render nothing.
  return getActiveProjectId() ?? '';
}

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
  const shape = getRegisterShape(activeProjectId(), 'edl');
  const summary = shape.documents > 0 ? getRegisterSummary(activeProjectId(), 'edl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(activeProjectId());
    return (
      <RouteTransition id="dokumen-edl-summary">
        <RegisterBuilder
          projectId={activeProjectId()}
          register="edl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
          existingSections={[]}
          numbering={getNumbering(activeProjectId(), 'edl')}
        />
      </RouteTransition>
    );
  }

  const tree = getRegisterTree(activeProjectId(), 'edl', week);
  // A and B are the sheet's own two bands; what a controller works in is the
  // level below — General, Procedure, Process, Mechanical, Electrical, Instrument.
  const groups = tree.flatMap((root) => (root.children.length > 0 ? root.children : [root]));

  return (
    <RouteTransition id="dokumen-edl-summary">
    <SummaryScreen
      summary={summary}
      groups={groups}
      obstacles={getObstacles(activeProjectId(), 'edl', week)}
      movement={getWeekMovement(activeProjectId(), 'edl', week)}
      bridge={getEngineeringBridge(activeProjectId(), week)}
      groupNoun="disciplines"
      groupsTitle="By discipline"
    />

    <div className="mt-6">
      <StageWeightsCard
        projectId={activeProjectId()}
        register="edl"
        weights={getStageWeights(activeProjectId(), 'edl')}
      />
    </div>
    </RouteTransition>
  );
}
