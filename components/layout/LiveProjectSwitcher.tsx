import { connection } from 'next/server';

import ProjectSwitcher from '@/components/portfolio/ProjectSwitcher';
import { listProjects } from '@/lib/projects';

/**
 * The project name in the sidebar, read at REQUEST TIME rather than baked in.
 *
 * `listProjects()` is synchronous, which under Cache Components makes it
 * deterministic — so the root layout used to prerender the open project's name
 * into every route's static shell. Then opening a different project revalidated
 * the page you were on and nothing else, and the app disagreed with itself:
 * `/projects` correctly badged "asdasd" as open while `/` still named Gundih in
 * the sidebar beside it (proved on the deployment, 8 Sep 2026 — `X-Vercel-Cache:
 * HIT`, `Age: 44348`). The name of the project you are looking at is the last
 * thing that may be twelve hours old.
 *
 * `connection()` is what opts this subtree out of the shell. It must therefore
 * sit behind `<Suspense>` in `app/layout.tsx` — an uncached read in the root
 * layout blocks every route in the app and fails the build on `/_not-found`.
 * The rest of the sidebar still prerenders; only this card streams in.
 */
export default async function LiveProjectSwitcher() {
  await connection();
  const projects = await listProjects();
  if (projects.length === 0) return null;

  return (
    <div className="px-4 pt-3">
      <ProjectSwitcher projects={projects} />
    </div>
  );
}

/**
 * Held space, not a spinner: the card is 56px tall and the nav below it must
 * not jump when the name arrives.
 */
export function ProjectSwitcherFallback() {
  return (
    <div className="px-4 pt-3">
      <div className="min-h-14 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
