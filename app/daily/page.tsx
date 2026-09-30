import { Suspense } from 'react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import SectionSkeleton from '@/components/ui/SectionSkeleton';
import { dailyProgressFor } from '@/lib/daily-progress';
import { weekAndDay, weekRangeLabel } from '@/lib/daily-week';
import { getOpenJsonDb, getOpenProjectStatus } from '@/lib/data';
import DailyReportsView from '@/components/daily/DailyReportsView';

function nextDateAfter(lastDate: string | undefined): string {
  if (!lastDate) return new Date().toISOString().slice(0, 10);
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * EVERY PROJECT KEEPS ITS OWN DAYS.
 *
 * This page used to stand behind `LegacyGate`, which told every project but
 * the imported one that it had no daily reports "yet" — a yet with no way out,
 * because the only record the store would hand anybody was the imported
 * project's. A daily report is a form filled in from the site, not something
 * derived from a plan: there is no reason a project has to be imported before
 * it can have one. `getOpenJsonDb()` gives each project a record of its own
 * (see lib/legacy-bridge.ts), so the gate has nothing left to refuse.
 *
 * Behind `<Suspense>` because the open project is a cookie, and this page's
 * static HTML used to carry the open project's NAME to whoever the CDN served
 * it to next.
 */
export default function DailyListPage() {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <DailyListBody />
    </Suspense>
  );
}

async function DailyListBody() {

  const db = await getOpenJsonDb();
  // Weekly is the source of a day's percentage (see lib/daily-progress.ts), so
  // the list reads the same figures the report does. After the cookie read above.
  const status = await getOpenProjectStatus();
  const sorted = [...db.daily].sort((a, b) => b.date.localeCompare(a.date));
  // The days are grouped by the week they fall in ("Week 40, 28 Sep to 4 Oct"). Nobody
  // types the day of the project either: both come from the plan's dates.
  const anchor = status?.anchorEnd ?? '';
  const rows = sorted.map((d) => {
    const p = dailyProgressFor(status, d.date);
    const wd = anchor ? weekAndDay(anchor, d.date) : null;
    return {
      date: d.date,
      hariKe: d.hariKe,
      week: wd?.week ?? null,
      day: wd?.day ?? null,
      progress: !p ? null : p.state === 'held' ? ('held' as const) : { plan: p.plan, actual: p.actual },
    };
  });
  const weekLabels: Record<number, string> = {};
  for (const r of rows) if (r.week !== null && !weekLabels[r.week]) weekLabels[r.week] = weekRangeLabel(anchor, r.week);
  const defaultDate = nextDateAfter(sorted[0]?.date);

  // No entrance on the wrapper at all: the RouteTransition fades this whole
  // block on a navigation and the list rows do their own staggered rise, so a
  // translate here would be a third animation on top of two.
  return (
    <RouteTransition id="daily">
    <div className="p-4 sm:p-6 lg:p-8">
      <DailyReportsView
        reports={rows}
        weekLabels={weekLabels}
        defaultDate={defaultDate}
      />
    </div>
    </RouteTransition>
  );
}
