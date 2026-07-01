import { getDb } from '@/lib/data';
import WeekTabs from '@/components/weekly/WeekTabs';

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
    <div className="flex h-full flex-col">
      <WeekTabs weeks={weeks} selectedWeek={Number(week)} projectCurrentWeek={db.project.currentWeek} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
