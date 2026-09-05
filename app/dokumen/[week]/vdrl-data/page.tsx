import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import {
  getNumbering, getObstacles, getRegisterCards, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree,
} from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'VDRL Data' };

/**
 * The project this screen is about — read per request, never at module scope.
 * A module-level read is evaluated once at import and goes stale the moment
 * anyone switches project. See lib/projects.ts.
 */
function activeProjectId(): string {
  return getActiveProjectId() ?? '';
}

/** The same working screen, pointed at what the vendors owe us. */
export default async function VdrlDataPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const shape = getRegisterShape(activeProjectId(), 'vdrl');
  const summary = shape.documents > 0 ? getRegisterSummary(activeProjectId(), 'vdrl', week) : null;

  const parties = getRegisterParties(activeProjectId());

  if (!summary) {
    return (
      <RouteTransition id="dokumen-vdrl-data">
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
    <RouteTransition id="dokumen-vdrl-data">
    <RegisterWorkbench
      projectId={activeProjectId()}
      register="vdrl"
      tree={getRegisterTree(activeProjectId(), 'vdrl', week)}
      cards={getRegisterCards(activeProjectId(), 'vdrl', week)}
      obstacles={getObstacles(activeProjectId(), 'vdrl', week)}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
      clientName={parties.clientName}
      contractorName={parties.contractorName}
      numbering={getNumbering(activeProjectId(), 'vdrl')}
    />
    </RouteTransition>
  );
}
