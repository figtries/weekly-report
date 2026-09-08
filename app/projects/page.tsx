import { Suspense } from 'react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import NewProjectDialog from '@/components/projects/NewProjectDialog';
import PlannerWarmup from '@/components/projects/PlannerWarmup';
import ProjectList from '@/components/projects/ProjectList';
import { listProjects } from '@/lib/projects';
import ProjectsSkeleton from '@/components/projects/ProjectsSkeleton';

export const metadata = { title: 'Projects' };

/**
 * Where the app starts.
 *
 * This replaces `/portfolio`, which was a board-level money table wearing a
 * project list's name: plan, actual, deviation, deferred, forecast and status
 * across nine columns, with Switch and Delete crammed into a pinned cell at the
 * right edge and Setup posing as a sibling tab. That page reported ON projects.
 * This one is where you keep them.
 *
 * No searchParams are read here, deliberately. Under `cacheComponents` that is
 * an uncached read and would need a `<Suspense>` around it; the archive toggle
 * is client state instead, which is what it always should have been for a
 * handful of rows already on the page.
 *
 * `listProjects()` reads which project is OPEN, and that now lives in a cookie
 * (see lib/projects.ts) — an uncached read, so the list streams behind a
 * boundary instead of prerendering. It has to: the badge saying which card is
 * open is a per-person answer, and this page baked into a shared static shell
 * is precisely how one person's choice ended up on everybody's screen.
 */
export default function ProjectsPage() {
  return (
    <Suspense fallback={<ProjectsSkeleton />}>
      <ProjectsBody />
    </Suspense>
  );
}

async function ProjectsBody() {
  const all = await listProjects({ includeArchived: true });

  return (
    <RouteTransition id="projects">
      <div className="mx-auto max-w-6xl px-3 py-5 sm:p-6 lg:p-8">
        <header className="animate-enter mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every project you keep. Open one and the whole app follows it — dashboard, weekly
              progress, daily, reports and document control.
            </p>
          </div>
          <NewProjectDialog />
        </header>

        <ProjectList all={all} />
      </div>

      {/* Nothing to look at. It spends the quiet moment after this page settles
          fetching the planner's chunks, so opening a project is not also the
          moment the browser first hears about 119 KB of code. */}
      <PlannerWarmup hasProjects={all.length > 0} />
    </RouteTransition>
  );
}
