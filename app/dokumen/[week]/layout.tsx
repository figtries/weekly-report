import { Suspense } from 'react';

import { RegisterTabs } from '@/components/dokumen/RegisterTabs';
import { Skeleton } from '@/components/ui/skeleton';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { getLatestWeek, getOpenDb } from '@/lib/data';
import { getAllRegisterWeekNumbers, getRegisterWeeks } from '@/lib/register';
import { getActiveProjectId } from '@/lib/projects';

export const metadata = { title: 'Document Control' };


/**
 * Every week any project has, not the open project's.
 *
 * This used to ask which project was open and enumerate ITS weeks — a question
 * with no answer at build time now that the open project is a cookie, and one
 * that was wrong even before: on the deployment it resolved to whatever
 * `data/seed.db` happened to say, which is nobody's choice.
 *
 * It must still return something. Without `generateStaticParams` the `[week]`
 * segment is request-time-only, so `await params` in this layout becomes an
 * uncached read outside `<Suspense>` and the build refuses the route outright.
 * A superset is the right shape: unknown weeks still render on demand, and
 * every week that does exist gets its shell.
 */
export function generateStaticParams() {
  const weeks = new Set(getAllRegisterWeekNumbers());
  return [...weeks].sort((a, b) => a - b).map((w) => ({ week: String(w) }));
}

/**
 * Document Control is one workplace with four screens, and it wears the weekly
 * report's shell so the two feel like one app.
 *
 * The header this replaced carried a contract number, a page title and a
 * paragraph explaining the two registers, all inside a centred `max-w-6xl`
 * column — three rows of furniture above the control people actually came for,
 * and a content width that matched nothing else in the app. The week now sits
 * at the top exactly as it does on the weekly report, and the body uses the
 * same scroller and the same padding, so every card edge lines up between the
 * two sections.
 *
 * The week stays in the address, so a controller can bookmark the week they are
 * reporting and a reload lands back on it.
 */
export default async function DocumentControlLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;

  return (
    // Stable across all four screens and every week: this fires on the way
    // into Document Control and stays still inside it. See the weekly layout.
    <RouteTransition id="dokumen">
    <div className="section-shell flex h-full flex-col">
      {/* The week list belongs to the OPEN project, which is a cookie now —
          a per-request read, so the tab row streams while the screens below it
          keep their shell. Held space, not nothing: this row is the furniture
          everything else is measured against. */}
      <Suspense fallback={<RegisterTabsFallback />}>
        <RegisterTabsForOpenProject week={Number(week)} />
      </Suspense>
      {/* scrollbar-none for the same reason the weekly report hides it: the
          global classic scrollbar reserves width on this scroller alone and
          would pull every card's right edge in from the tab row above it. */}
      {/* Same placement as the weekly report's: each screen's own boundary sits
          inside this scroller, so moving between the four never disturbs the
          week picker or the tab row. */}
      <div className="section-scroll flex-1 overflow-auto scrollbar-none">
        <div className="px-3 py-4 sm:p-6 lg:p-8">{children}</div>
      </div>
    </div>
    </RouteTransition>
  );
}

/**
 * The tab row, resolved per request because its weeks come from whichever
 * project the visitor has open (see lib/projects.ts).
 */
async function RegisterTabsForOpenProject({ week }: { week: number }) {
  const projectId = (await getActiveProjectId()) ?? '';
  const weeks = getRegisterWeeks(projectId).map((w) => w.weekNo);
  const db = await getOpenDb();

  return <RegisterTabs weeks={weeks} selectedWeek={week} projectCurrentWeek={getLatestWeek(db) || 1} />;
}

/** Held space, so the scroller below does not jump when the real row lands. */
function RegisterTabsFallback() {
  return (
    <div className="px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8">
      <Skeleton className="h-11 w-32 rounded-lg" />
      <Skeleton className="mt-3 h-9 w-full rounded-lg" />
    </div>
  );
}
