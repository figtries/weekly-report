import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import {
  getObstacles, getRegisterCards, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree,
} from '@/lib/register';

export const metadata = { title: 'VDRL Data' };

const PROJECT_ID = 'gundih';

/** The same working screen, pointed at what the vendors owe us. */
export default async function VdrlDataPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const shape = getRegisterShape(PROJECT_ID, 'vdrl');
  const summary = shape.documents > 0 ? getRegisterSummary(PROJECT_ID, 'vdrl', week) : null;

  const parties = getRegisterParties(PROJECT_ID);

  if (!summary) {
    return (
      <RouteTransition id="dokumen-vdrl-data">
        <RegisterBuilder
          projectId={PROJECT_ID}
          register="vdrl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition id="dokumen-vdrl-data">
    <RegisterWorkbench
      projectId={PROJECT_ID}
      register="vdrl"
      tree={getRegisterTree(PROJECT_ID, 'vdrl', week)}
      cards={getRegisterCards(PROJECT_ID, 'vdrl', week)}
      obstacles={getObstacles(PROJECT_ID, 'vdrl', week)}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
      clientName={parties.clientName}
      contractorName={parties.contractorName}
    />
    </RouteTransition>
  );
}
