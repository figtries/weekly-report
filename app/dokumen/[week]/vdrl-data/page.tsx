import { Suspense } from 'react';
import SectionSkeleton from '@/components/ui/SectionSkeleton';

import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterSetup } from '@/components/dokumen/RegisterSetup';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import {
  getNumbering, getObstacles, getRegisterCards, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree, getRegisterSettings, getNextLetterNumbers,
  getRegisterSources, getRegisterExisting,
} from '@/lib/register';
import { isAddedStage } from '@/lib/register-shared';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'VDRL Data' };


/** The same working screen, pointed at what the vendors owe us. */
/**
 * Behind a boundary because the open project is a cookie now, and a cookie is
 * an uncached read (see lib/projects.ts). Prerendering this screen would mean
 * baking one person's register into a page everyone is served.
 */
export default function VdrlDataPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <VdrlDataPageBody params={params} />
    </Suspense>
  );
}

async function VdrlDataPageBody({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  // The open project comes from a cookie now, so this is a per-request read
  // and cannot be baked into a shell. See lib/projects.ts.
  const projectId = (await getActiveProjectId()) ?? '';
  const shape = getRegisterShape(projectId, 'vdrl');
  const summary = shape.documents > 0 ? getRegisterSummary(projectId, 'vdrl', week) : null;

  const parties = getRegisterParties(projectId);

  if (!summary) {
    return (
      <RouteTransition id="dokumen-vdrl-data">
        <RegisterSetup
          // Saved headings come back as fixed rows to keep adding into: the
          // page only becomes the workbench once a document exists.
          key={shape.categories}
          existing={getRegisterExisting(projectId, 'vdrl')}
          projectId={projectId}
          register="vdrl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}
          hasDocuments={false}
          settings={getRegisterSettings(projectId, 'vdrl')}
          sources={getRegisterSources(projectId, 'vdrl')}
          numbering={getNumbering(projectId, 'vdrl')}
        />
      </RouteTransition>
    );
  }

  return (
    <RouteTransition id="dokumen-vdrl-data">
    <RegisterWorkbench
      projectId={projectId}
      register="vdrl"
      tree={getRegisterTree(projectId, 'vdrl', week)}
      cards={getRegisterCards(projectId, 'vdrl', week)}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
      clientName={parties.clientName}
      contractorName={parties.contractorName}
      numbering={getNumbering(projectId, 'vdrl')}
      sources={getRegisterSources(projectId, 'vdrl')}
      // Recording a letter is a fact about today, whatever week is on screen,
      // so the transmittal dialog reads the register as it stands now.
      currentCards={getRegisterCards(projectId, 'vdrl')}
      currentObstacles={getObstacles(projectId, 'vdrl')}
      settings={getRegisterSettings(projectId, 'vdrl')}
      nextLetters={getNextLetterNumbers(projectId, 'vdrl')}
      overview={{ actual: summary.actual, plan: summary.plan, stages: summary.stages.filter((x) => ['IFR', 'IFA', 'AFC'].includes(x.stage) || isAddedStage(x.stage)) }}
    />
    </RouteTransition>
  );
}
