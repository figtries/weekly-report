import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import {
  getObstacles, getRegisterCards, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree,
} from '@/lib/register';

export const metadata = { title: 'EDL Data' };

const PROJECT_ID = 'gundih';

/** Where the engineering register is written to, not just read. */
export default async function EdlDataPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const shape = getRegisterShape(PROJECT_ID, 'edl');
  const summary = shape.documents > 0 ? getRegisterSummary(PROJECT_ID, 'edl', week) : null;

  const parties = getRegisterParties(PROJECT_ID);

  if (!summary) {
    return (
      <RouteTransition id="dokumen-edl-data">
        <RegisterBuilder
          projectId={PROJECT_ID}
          register="edl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}

          hasDocuments={false}
          existingSections={[]}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition id="dokumen-edl-data">
    <RegisterWorkbench
      projectId={PROJECT_ID}
      register="edl"
      tree={getRegisterTree(PROJECT_ID, 'edl', week)}
      cards={getRegisterCards(PROJECT_ID, 'edl', week)}
      obstacles={getObstacles(PROJECT_ID, 'edl', week)}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
      clientName={parties.clientName}
      contractorName={parties.contractorName}
    />
    </RouteTransition>
  );
}
