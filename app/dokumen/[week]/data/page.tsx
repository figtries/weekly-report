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
  const shape = await getRegisterShape(projectId, 'edl');
  const summary = shape.documents > 0 ? await getRegisterSummary(projectId, 'edl', week) : null;

  const parties = await getRegisterParties(projectId);

  if (!summary) {
    const [existing, settings, sources, numbering] = await Promise.all([
      getRegisterExisting(projectId, 'edl'),
      getRegisterSettings(projectId, 'edl'),
      getRegisterSources(projectId, 'edl'),
      getNumbering(projectId, 'edl'),
    ]);
    return (
      <RouteTransition id="dokumen-edl-data">
        <RegisterSetup
          // Saved headings come back as fixed rows to keep adding into: the
          // page only becomes the workbench once a document exists.
          key={shape.categories}
          existing={existing}
          projectId={projectId}
          register="edl"
          clientName={parties.clientName}
          contractorName={parties.contractorName}
          hasDocuments={false}
          settings={settings}
          sources={sources}
          numbering={numbering}
        />
      </RouteTransition>
    );
  }

  const [tree, cards, currentCards, currentObstacles, settings, numbering, sources, nextLetters] = await Promise.all([
    getRegisterTree(projectId, 'edl', week),
    getRegisterCards(projectId, 'edl', week),
    getRegisterCards(projectId, 'edl'),
    getObstacles(projectId, 'edl'),
    getRegisterSettings(projectId, 'edl'),
    getNumbering(projectId, 'edl'),
    getRegisterSources(projectId, 'edl'),
    getNextLetterNumbers(projectId, 'edl'),
  ]);

  return (
    <RouteTransition id="dokumen-edl-data">
    <RegisterWorkbench
      projectId={projectId}
      register="edl"
      tree={tree}
      cards={cards}
      totalDocuments={summary.documents}
      weekNo={summary.asOfWeek}
      clientName={parties.clientName}
      contractorName={parties.contractorName}
      numbering={numbering}
      sources={sources}
      // Recording a letter is a fact about today, whatever week is on screen,
      // so the transmittal dialog reads the register as it stands now.
      currentCards={currentCards}
      currentObstacles={currentObstacles}
      settings={settings}
      nextLetters={nextLetters}
      overview={{ actual: summary.actual, plan: summary.plan, stages: summary.stages.filter((x) => ['IFR', 'IFA', 'AFC'].includes(x.stage) || isAddedStage(x.stage)) }}
    />
    </RouteTransition>
  );
}
