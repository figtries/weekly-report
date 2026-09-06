import { RouteTransition } from '@/components/motion/RouteTransition';
import { getDb } from '@/lib/data';
import DailyReportsView from '@/components/daily/DailyReportsView';
import NoLegacyData from '@/components/projects/NoLegacyData';
import { getOpenProject } from '@/lib/legacy-bridge';

function nextDateAfter(lastDate: string | undefined): string {
  if (!lastDate) return new Date().toISOString().slice(0, 10);
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function DailyListPage() {
  // The v1 pages read db.json, and projects are chosen in SQLite — so the open
  // project may have no data here at all. Saying so beats drawing another
  // project's numbers under a sidebar naming this one. See lib/legacy-bridge.ts.
  const open = getOpenProject();
  if (open && !open.hasLegacyData) return <NoLegacyData what="daily reports" />;

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
