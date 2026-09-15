import Link from 'next/link';

import { deriveInitial } from '@/lib/initial';
import { getActiveProject } from '@/lib/projects';

/**
 * WHICH PROJECT THE APP IS FOLLOWING, on the phone's top bar.
 *
 * On a laptop the answer is always on screen: the sidebar's project card sits
 * above the nav on every route. On a phone that card is inside the drawer, so
 * the answer was one tap away at all times and the bar itself said only
 * "Progress Report" — the same eleven characters whichever project you had
 * open. Reported 15 Sep 2026, alongside the same complaint about the badge on
 * the Projects list.
 *
 * Three letters, because that is all the room there is next to a hamburger and
 * a title, and because the app already has a name for a project in three
 * letters. The full name is on the `title` and the `aria-label`, and pressing
 * it goes to Projects — a marker you cannot act on is a marker people read as
 * decoration.
 *
 * NO `<Suspense>` OF ITS OWN, and that is a hard budget rather than a
 * preference. The shell must own fewer than four streamed boundaries or Next's
 * PPR resume segments collide with React's own (see the long note in
 * `Sidebar.tsx` and `scripts/verify-hydration.mjs`), and this is request data:
 * `getActiveProject()` reads the cookie, so it cannot be prerendered into a
 * shell that is shared by everybody. It is rendered INSIDE the boundary the
 * mobile drawer already owns instead, which adds nothing to the count.
 */
export default async function OpenProjectTag() {
  const project = await getActiveProject();
  if (!project) return null;

  // `alias` when the project has one, derived when it does not — the three
  // projects made before that column existed would otherwise show nothing at
  // all here, which is the state being fixed.
  const initial = project.alias || deriveInitial(project.name);
  if (!initial) return null;

  return (
    <Link
      href="/projects"
      title={project.name}
      aria-label={`${project.name} is open. Go to Projects`}
      className="flex min-h-11 shrink-0 items-center rounded-lg px-1 transition-colors active:bg-muted"
    >
      {/* The same blue as the Open badge on the Projects list, deliberately:
          one colour answering one question in both places. */}
      <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground">
        {initial}
      </span>
    </Link>
  );
}
