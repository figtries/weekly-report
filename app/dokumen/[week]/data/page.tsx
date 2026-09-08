import { Suspense } from 'react';
import SectionSkeleton from '@/components/ui/SectionSkeleton';

import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterBuilder } from '@/components/dokumen/RegisterBuilder';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import {
  getNumbering, getObstacles, getRegisterCards, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree,
} from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'EDL Data' };


/** Where the engineering register is written to, not just read. */
/**
 * Behind a boundary because the open project is a cookie now, and a cookie is
 * an uncached read (see lib/projects.ts). Prerendering this screen would mean
 * baking one person's register into a page everyone is served.
 */
export default function EdlDataPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <EdlDataPageBody params={params} />
    </Suspense>
  );
}

async function EdlDataPageBody({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  // The open project comes from a cookie now, so this is a per-request read
  // and cannot be baked into a shell. See lib/projects.ts.
  const projectId = (await getActiveProjectId()) ?? '';
  const shape = getRegisterShape(projectId, 'edl');
  const summary = shape.documents > 0 ? getRegisterSummary(projectId, 'edl', week) : null;

  const parties = getRegisterParties(projectId);

  if (!summary) {
    return (
      <RouteTransition id="dokumen-edl-data">
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

  return (
    <RouteTransition id="dokumen-edl-data">
    <RegisterWorkbench
      projectId={projectId}
      register="edl"
      tree={getRegisterTree(projectId, 'edl', week)}
      cards={getRegisterCards(projectId, 'edl', week)}
      obstacles={getObstacles(projectId, 'edl', week)}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
      clientName={parties.clientName}
      contractorName={parties.contractorName}
      numbering={getNumbering(projectId, 'edl')}
    />
    </RouteTransition>
  );
}
