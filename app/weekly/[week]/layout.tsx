import { getCachedWeekRollup, getDb } from '@/lib/data';
import { validateWeek } from '@/lib/analysis';
import { buildWorklist } from '@/lib/worklist';
import WeekTabs from '@/components/weekly/WeekTabs';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { LegacyChromeGate } from '@/components/projects/LegacyGate';
import { Skeleton } from '@/components/ui/skeleton';


// Runtime prefetch (validated against the sample week) lets the router
// prefetch each tab's full cached content — no skeleton flash between
// subpages. 'static' isn't possible here: WeekTabs/Sidebar read usePathname().
export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export async function generateStaticParams() {
  const db = await getDb();
  return db.weeks.map((w) => ({ week: String(w.week) }));
}

export default async function WeeklyWeekLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const weekNo = Number(week);


  const db = await getDb();
  const weeks = db.weeks.map((w) => w.week).sort((a, b) => a - b);

  // The step counts. Both are read straight off data the section already
  // computes for its own pages, so the header costs a cached rollup and no
  // extra source of truth — a badge that disagreed with the screen it points
  // at would be worse than no badge.
  const rollup = await getCachedWeekRollup(weekNo);
  const dueCount = rollup
    ? buildWorklist({
        roots: rollup.roots,
        schedule: db.schedule,
        week: weekNo,
        changeLog: db.changeLog,
      }).due.length
    : 0;
  const validation = validateWeek(db, weekNo);
  const checkCount = validation.errors + validation.warnings;

  return (
    // 'weekly' is stable across every tab and every week, so this boundary
    // animates only on the way INTO the section and never between two tabs of
    // it — which is the whole point of moving off the root template. Each page
    // carries its own boundary inside the scroller below.
    <RouteTransition id="weekly">
    <div className="section-shell flex h-full flex-col print:block print:h-auto">
      {/* Covers Weekly Progress AND Reports — both live under this layout, so
          one gate serves five screens. The v1 pages read db.json while projects
          are chosen in SQLite; when the open project has no data here, this
          week picker and these step counts would be another project's.

          The gate reads per request (see LegacyGate). It used to be an early
          return in this function, which put the answer in the prerendered
          shell — so the deployment served Gundih's chrome above another
          project's empty state. The layout must still render `children`
          either way: a layout that returns early fails the build, because
          `unstable_instant` validates the segment beneath it and a child that
          never renders comes back as "the target segment was prevented from
          rendering for an unknown reason". So only the chrome is gated, and
          the page below says the rest. */}
      <LegacyChromeGate fallback={<WeekTabsFallback />}>
        <WeekTabs
          weeks={weeks}
          selectedWeek={weekNo}
          projectCurrentWeek={db.project.currentWeek}
          dueCount={dueCount}
          checkCount={checkCount}
        />
      </LegacyChromeGate>

      {/* scrollbar-none: the global 10px classic scrollbar would otherwise
          reserve layout width on this scroller only (the header/print button
          sits outside it), pulling every card's right edge ~10px left of the
          print button. Hiding it keeps content full-width so the card edges
          line up flush with the print button — scrolling still works by
          touch/wheel. */}
      {/* The tab change animates inside this scroller — each page wraps its own
          root in a RouteTransition of its own — so WeekTabs above is not even
          within the boundary that moves. */}
      <div className="section-scroll flex-1 overflow-auto scrollbar-none print:overflow-visible">{children}</div>
    </div>
    </RouteTransition>
  );
}

/**
 * Held space for the chrome while the gate resolves, mirroring WeekTabs' own
 * padding so the scroller below does not jump when the real thing lands. It is
 * deliberately not a fixed pixel height — that number would go stale the first
 * time the header changes.
 */
function WeekTabsFallback() {
  return (
    <div className="px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
      <div className="flex items-center gap-2">
        <Skeleton className="h-11 w-32 rounded-lg" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
      <Skeleton className="mt-3 h-11 w-full max-w-md rounded-xl" />
      <Skeleton className="mt-3 h-9 w-full rounded-lg" />
    </div>
  );
}
