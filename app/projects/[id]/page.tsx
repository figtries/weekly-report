import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import OpenProjectButton from '@/components/projects/OpenProjectButton';
import PlannerSkeleton from '@/components/projects/PlannerSkeleton';
import ProjectDetails from '@/components/projects/ProjectDetails';
import ScheduleSheet from '@/components/projects/ScheduleSheet';
import { getActiveProjectId, getProject, getProjectContents } from '@/lib/projects';
import { refreshDbSnapshot } from '@/lib/sqlite';
import { getSheet, getWeekSpans } from '@/lib/sheet';
import { getWeightSummary } from '@/lib/weights-read';
import ValueStrip from '@/components/projects/ValueStrip';
import { getBarStyles } from '@/lib/bar-styles-read';

// No `dynamicParams` export here: under `cacheComponents` it is rejected
// outright ("not compatible with nextConfig.cacheComponents"). Reading `params`
// is enough — this route resolves per id without it.

/**
 * A project, and the plan it holds.
 *
 * The page is a full-height column rather than a scrolling document: the sheet
 * and its Gantt each need their own scroller, and a page that scrolls as well
 * gives you three, which is the surest way to lose a row you were looking at.
 * The chrome above is deliberately thin — a header, one line of facts — because
 * the plan is what people came for.
 */
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  // `params` is a runtime read. Under `cacheComponents` awaiting it in the page
  // component itself fails with "Runtime data ... accessed outside of
  // <Suspense>" — the same wall `/print/*` hit.
  //
  // THIS FALLBACK IS THE PRERENDERED SHELL, which is why it may not be `null`.
  // It was, and the consequence was measured: Next served this route as a page
  // whose `<main>` held one empty `<template>`, so the shell painted instantly
  // and painted nothing, and the whole wait — segment fetch plus 119 KB of
  // client chunks that are not requested until the click — happened on a blank
  // screen. 496 ms on a five-row project, 1.4 s on Gundih, on localhost with no
  // network in the way. The frame does not depend on the id; only the words do.
  return (
    <Suspense fallback={<PlannerSkeleton />}>
      <ProjectBody params={params} />
    </Suspense>
  );
}

async function ProjectBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let project = getProject(id);
  // A project this instance has never heard of is the one case where staleness
  // is already proven rather than suspected: on a deployment the row may have
  // been written by a different lambda seconds ago. Pull the snapshot once and
  // ask again before deciding it does not exist — that redirect landing on a
  // 404 is exactly what lib/db-snapshot.ts was written for. Costs nothing
  // locally, where the refresh is a no-op.
  if (!project && (await refreshDbSnapshot())) project = getProject(id);
  if (!project) notFound();

  const contents = getProjectContents(id);
  const sheet = getSheet(id);
  const weights = getWeightSummary(id);
  const bars = getBarStyles(id, sheet.rows);
  const weeks = getWeekSpans(id);
  const isOpen = (await getActiveProjectId()) === id;

  const facts = [
    `${contents.wbsRows} rows`,
    `${contents.leaves} measurable`,
    contents.reportingUnits ? `${contents.reportingUnits} reporting units` : null,
    `${contents.weeks} weeks`,
    contents.documents ? `${contents.documents} documents` : null,
    // Said as a count rather than hidden: pricing is a separate job from
    // scheduling, and this is how far along it is.
    sheet.pricedRows ? `${sheet.pricedRows} priced` : 'no prices yet',
    // The contract figure is NOT repeated here. It is stated once, in the strip
    // directly below, where it stands next to what has actually been allocated
    // against it.
  ].filter(Boolean);

  return (
    <RouteTransition id="project-home">
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <header className="animate-enter shrink-0 border-b px-3 py-3 sm:px-6">
          <Link
            href="/projects"
            className="inline-flex h-8 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            All projects
          </Link>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-base font-semibold leading-tight tracking-tight sm:text-lg">
                {project.name}
              </h1>
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>{project.clientName || 'No client named yet'}</span>
                {facts.map((f) => (
                  <span key={f as string}>· {f}</span>
                ))}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ProjectDetails project={project} />
              <OpenProjectButton id={id} isOpen={isOpen} />
            </div>
          </div>
        </header>

        {weights && <ValueStrip summary={weights} projectId={id} />}

        {/* Always the sheet, even with nothing in it. An empty project used to
            get a separate panel here, which meant the one screen where you
            build a plan was missing on exactly the project that had none. */}
        <ScheduleSheet
          rows={sheet.rows}
          spanStart={sheet.spanStart}
          spanFinish={sheet.spanFinish}
          projectStart={project.startDate}
          projectFinish={project.finishDate}
          currency={project.currency}
          projectId={id}
          barStyles={bars.styles}
          barStyleSource={bars.source}
          barStyleAuto={bars.auto}
          barStylePruned={bars.pruned}
          weeks={weeks}
        />
      </div>
    </RouteTransition>
  );
}
