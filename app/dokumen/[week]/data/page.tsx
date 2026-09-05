import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import {
  getNumbering, getObstacles, getRegisterCards, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree,
} from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'EDL Data' };

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

/** Where the engineering register is written to, not just read. */
export default async function EdlDataPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const shape = getRegisterShape(activeProjectId(), 'edl');
  const summary = shape.documents > 0 ? getRegisterSummary(activeProjectId(), 'edl', week) : null;

  const parties = getRegisterParties(activeProjectId());

  if (!summary) {
    return (
      <RouteTransition id="dokumen-edl-data">
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

  return (
    <RouteTransition id="dokumen-edl-data">
    <RegisterWorkbench
      projectId={activeProjectId()}
      register="edl"
      tree={getRegisterTree(activeProjectId(), 'edl', week)}
      cards={getRegisterCards(activeProjectId(), 'edl', week)}
      obstacles={getObstacles(activeProjectId(), 'edl', week)}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
      clientName={parties.clientName}
      contractorName={parties.contractorName}
      numbering={getNumbering(activeProjectId(), 'edl')}
    />
    </RouteTransition>
  );
}
