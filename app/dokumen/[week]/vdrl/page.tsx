import { Suspense } from 'react';
import SectionSkeleton from '@/components/ui/SectionSkeleton';

import { RouteTransition } from '@/components/motion/RouteTransition';
import { RegisterSetup } from '@/components/dokumen/RegisterSetup';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import {
  getNumbering, getObstacles, getRegisterParties, getRegisterShape, getRegisterSummary, getRegisterTree, getWeekMovement,
  getRegisterSources, getRegisterExisting, getRegisterSettings,
} from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'VDRL Summary' };


/**
 * The vendor register, read the same way and telling a different story.
 *
 * No vendor gave a submission date, so there is no plan curve to draw and none
 * is invented; most of what was ordered has never been sent, and that is what
 * the screen leads with. 76 packages would be a wall of empty cards, so they
 * are folded by status — only the ones that have actually moved get a card.
 */
/**
 * Behind a boundary because the open project is a cookie now, and a cookie is
 * an uncached read (see lib/projects.ts). Prerendering this screen would mean
 * baking one person's register into a page everyone is served.
 */
export default function VdrlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <VdrlSummaryPageBody params={params} />
    </Suspense>
  );
}

async function VdrlSummaryPageBody({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  // The open project comes from a cookie now, so this is a per-request read
  // and cannot be baked into a shell. See lib/projects.ts.
  const projectId = (await getActiveProjectId()) ?? '';
  const shape = getRegisterShape(projectId, 'vdrl');
  const summary = shape.documents > 0 ? getRegisterSummary(projectId, 'vdrl', week) : null;

  if (!summary) {
    const parties = getRegisterParties(projectId);
    return (
      <RouteTransition id="dokumen-vdrl-summary">
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
    <RouteTransition id="dokumen-vdrl-summary">
    <SummaryScreen
      summary={summary}
      // Vendor packages are the top level here — one card per package.
      groups={getRegisterTree(projectId, 'vdrl', week)}
      obstacles={getObstacles(projectId, 'vdrl', week)}
      movement={getWeekMovement(projectId, 'vdrl', week)}
      groupsTitle="By vendor package"
      foldEmptyGroups
      settings={getRegisterSettings(projectId, 'vdrl')}
      otherName={'vendors'}
      week={week}
    />
    </RouteTransition>
  );
}
