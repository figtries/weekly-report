import { RouteTransition } from '@/components/motion/RouteTransition';
import { getDb } from '@/lib/data';
import DailyReportsView from '@/components/daily/DailyReportsView';
import LegacyGate from '@/components/projects/LegacyGate';

function nextDateAfter(lastDate: string | undefined): string {
  if (!lastDate) return new Date().toISOString().slice(0, 10);
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The gate is asked PER REQUEST (see components/projects/LegacyGate.tsx): this
 * page's static HTML used to carry the open project's NAME, and the CDN served
 * it to whoever had a different one open.
 */
export default function DailyListPage() {
  return (
    <LegacyGate what="daily reports">
      <DailyListBody />
    </LegacyGate>
  );
}

async function DailyListBody() {

  const db = await getDb();
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
