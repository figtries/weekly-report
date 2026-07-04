import { getDb } from '@/lib/data';
import WeekTabs from '@/components/weekly/WeekTabs';

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
  const db = await getDb();
  const weeks = db.weeks.map((w) => w.week).sort((a, b) => a - b);

  return (
    <div className="flex h-full flex-col print:block print:h-auto">
      <WeekTabs weeks={weeks} selectedWeek={Number(week)} projectCurrentWeek={db.project.currentWeek} />
      <div className="flex-1 overflow-auto print:overflow-visible">{children}</div>
    </div>
  );
}
