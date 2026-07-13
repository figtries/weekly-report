import { getDb } from '@/lib/data';
import DailyReportsView from '@/components/daily/DailyReportsView';

function nextDateAfter(lastDate: string | undefined): string {
  if (!lastDate) return new Date().toISOString().slice(0, 10);
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function DailyListPage() {
  const db = await getDb();
  const sorted = [...db.daily].sort((a, b) => b.date.localeCompare(a.date));
  const defaultDate = nextDateAfter(sorted[0]?.date);

  // Opacity-only entrance on the wrapper: the route view transition already
  // moves the page and the list rows do their own staggered rise — a second
  // translate here made every navigation read as two animations.
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
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
  );
}
