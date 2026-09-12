import { Suspense } from 'react';

import { RouteTransition } from '@/components/motion/RouteTransition';
import SectionSkeleton from '@/components/ui/SectionSkeleton';
import { getOpenJsonDb } from '@/lib/data';
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
  const sorted = [...db.daily].sort((a, b) => b.date.localeCompare(a.date));
  const defaultDate = nextDateAfter(sorted[0]?.date);

  // No entrance on the wrapper at all: the RouteTransition fades this whole
  // block on a navigation and the list rows do their own staggered rise, so a
  // translate here would be a third animation on top of two.
  return (
    <RouteTransition id="daily">
    <div className="p-4 sm:p-6 lg:p-8">
      <DailyReportsView
        reports={sorted.map((d) => ({
          date: d.date,
          hariKe: d.hariKe,
          planPct: d.planPct,
          actualPct: d.actualPct,
        }))}
        defaultDate={defaultDate}
      />
    </div>
    </RouteTransition>
  );
}
