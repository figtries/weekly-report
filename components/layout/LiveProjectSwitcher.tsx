import { connection } from 'next/server';

import ProjectSwitcher from '@/components/portfolio/ProjectSwitcher';
import { getOpenProjectStatus } from '@/lib/data';
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
 *
 * The card's progress figures ride in the SAME boundary: they are request data
 * too (the open project is a cookie, the current week reads the clock), and a
 * boundary of their own would be one more than the shell may own — see the
 * note in `Sidebar.tsx`.
 */
export default async function LiveProjectSwitcher() {
  await connection();
  const [projects, status] = await Promise.all([listProjects(), getOpenProjectStatus()]);
  if (projects.length === 0) return null;

  return <ProjectSwitcher projects={projects} status={status} />;
}

/**
 * Held space, not a spinner: roughly the card's own height, so Settings below
 * it does not jump when the name arrives.
 */
export function ProjectSwitcherFallback() {
  return <div className="min-h-48 animate-pulse rounded-xl border bg-muted/40" />;
}
