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
      {/* scrollbar-none: the global 10px classic scrollbar would otherwise
          reserve layout width on this scroller only (the header/print button
          sits outside it), pulling every card's right edge ~10px left of the
          print button. Hiding it keeps content full-width so the card edges
          line up flush with the print button — scrolling still works by
          touch/wheel. */}
      <div className="flex-1 overflow-auto scrollbar-none print:overflow-visible">{children}</div>
    </div>
  );
}
