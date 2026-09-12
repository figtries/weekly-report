import { getDb, getOpenWeekRollup, getOpenDb } from '@/lib/data';
import { validateWeek } from '@/lib/analysis';
import { buildWorklist } from '@/lib/worklist';
import WeekTabs from '@/components/weekly/WeekTabs';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { LegacyChromeGate } from '@/components/projects/LegacyGate';
import { getOpenProject } from '@/lib/legacy-bridge';
import { Skeleton } from '@/components/ui/skeleton';


// Runtime prefetch (validated against the sample week) lets the router
// prefetch each tab's full cached content — no skeleton flash between
// subpages. 'static' isn't possible here: WeekTabs/Sidebar read usePathname().
export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts), and this validation
  // refuses any read it has not been told about. A null value is the sample
  // that matters: a visitor who has never chosen a project, which is every
  // first visit and every fresh phone.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
};

export async function generateStaticParams() {
  // `getDb()`, not `getOpenDb()`: this runs at BUILD time, where there is no
  // request and therefore no open project. It only decides which week numbers
  // get a prerendered shell, and a project whose weeks are not in that list
  // still renders — the params are a head start, not a whitelist.
  const db = await getDb();
  return db.weeks.map((w) => ({ week: String(w.week) }));
}

/**
 * The week picker and its two counts, read INSIDE the gate.
 *
 * These reads used to sit at the top of the layout, and the moment they became
 * project-aware that broke the build: the open project is a cookie, an uncached
 * read, and a layout is not behind `<Suspense>` — "Uncached data was accessed
 * outside of `<Suspense>`", exactly as AGENTS.md warns twice. `LegacyChromeGate`
 * already provides the boundary and already calls `connection()`, so the reads
 * belong on this side of it. The layout itself now reads nothing at all.
 */
async function WeeklyTabsFor({ week }: { week: number }) {
  const db = await getOpenDb();
  const weeks = db.weeks.map((w) => w.week).sort((a, b) => a - b);

  // The step counts. Both are read straight off data the section already
  // computes for its own pages, so the header costs a cached rollup and no
  // extra source of truth — a badge that disagreed with the screen it points
  // at would be worse than no badge.
  const rollup = await getOpenWeekRollup(week);
  const dueCount = rollup
    ? buildWorklist({
        roots: rollup.roots,
        schedule: db.schedule,
        week,
        changeLog: db.changeLog,
      }).due.length
    : 0;
  const validation = validateWeek(db, week);
  const open = await getOpenProject();

  return (
    <WeekTabs
      weeks={weeks}
      selectedWeek={week}
      projectCurrentWeek={db.project.currentWeek}
      derivedCurrent={!!open && !open.hasLegacyData}
      dueCount={dueCount}
      checkCount={validation.errors + validation.warnings}
    />
  );
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
      <LegacyChromeGate planned fallback={<WeekTabsFallback />}>
        <WeeklyTabsFor week={weekNo} />
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
      {/* Both bands run the full width now, so the held space does too — a
          narrower placeholder would make the row jump wider as it lands. */}
      <Skeleton className="mt-3 h-11 w-full rounded-xl" />
      <Skeleton className="mt-3 h-11 w-full rounded-xl" />
    </div>
  );
}
