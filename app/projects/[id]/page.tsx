import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import OpenProjectButton from '@/components/projects/OpenProjectButton';
import ScheduleSheet from '@/components/projects/ScheduleSheet';
import { getActiveProjectId, getProject, getProjectContents } from '@/lib/projects';
import { getSheet } from '@/lib/sheet';

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
  // <Suspense>" — the same wall `/print/*` hit. A `null` fallback is right
  // here: everything on this page depends on which project it is, so there is
  // no honest skeleton to draw before the id is known.
  return (
    <Suspense fallback={null}>
      <ProjectBody params={params} />
    </Suspense>
  );
}

async function ProjectBody({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProject(id);
  if (!project) notFound();

  const contents = getProjectContents(id);
  const sheet = getSheet(id);
  const isOpen = getActiveProjectId() === id;

  const money =
    project.contractValue && project.contractValue > 0
      ? new Intl.NumberFormat('en-GB', {
          style: 'currency',
          currency: project.currency,
          maximumFractionDigits: 0,
        }).format(project.contractValue)
      : null;

  const facts = [
    `${contents.wbsRows} rows`,
    `${contents.leaves} measurable`,
    contents.reportingUnits ? `${contents.reportingUnits} reporting units` : null,
    `${contents.weeks} weeks`,
    contents.documents ? `${contents.documents} documents` : null,
    // Said as a count rather than hidden: pricing is a separate job from
    // scheduling, and this is how far along it is.
    sheet.pricedRows ? `${sheet.pricedRows} priced` : 'no prices yet',
    money,
  ].filter(Boolean);

  return (
    <RouteTransition id="project-home">
      <div className="flex h-full min-h-0 flex-col">
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
            <OpenProjectButton id={id} isOpen={isOpen} />
          </div>
        </header>

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
        />
      </div>
    </RouteTransition>
  );
}
