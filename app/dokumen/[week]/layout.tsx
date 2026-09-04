import { RegisterTabs } from '@/components/dokumen/RegisterTabs';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { getDb, getLatestWeek } from '@/lib/data';
import { getRegisterWeeks } from '@/lib/register';

export const metadata = { title: 'Document Control' };

const PROJECT_ID = 'gundih';

export function generateStaticParams() {
  return getRegisterWeeks(PROJECT_ID).map((w) => ({ week: String(w.weekNo) }));
}

/**
 * Document Control is one workplace with four screens, and it wears the weekly
 * report's shell so the two feel like one app.
 *
 * The header this replaced carried a contract number, a page title and a
 * paragraph explaining the two registers, all inside a centred `max-w-6xl`
 * column — three rows of furniture above the control people actually came for,
 * and a content width that matched nothing else in the app. The week now sits
 * at the top exactly as it does on the weekly report, and the body uses the
 * same scroller and the same padding, so every card edge lines up between the
 * two sections.
 *
 * The week stays in the address, so a controller can bookmark the week they are
 * reporting and a reload lands back on it.
 */
export default async function DocumentControlLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ week: string }>;
}) {
  const { week } = await params;
  const weeks = getRegisterWeeks(PROJECT_ID).map((w) => w.weekNo);
  const db = await getDb();

  return (
    // Stable across all four screens and every week: this fires on the way
    // into Document Control and stays still inside it. See the weekly layout.
    <RouteTransition id="dokumen">
    <div className="flex h-full flex-col">
      <RegisterTabs
        weeks={weeks}
        selectedWeek={Number(week)}
        projectCurrentWeek={getLatestWeek(db) || 1}
      />
      {/* scrollbar-none for the same reason the weekly report hides it: the
          global classic scrollbar reserves width on this scroller alone and
          would pull every card's right edge in from the tab row above it. */}
      {/* Same placement as the weekly report's: each screen's own boundary sits
          inside this scroller, so moving between the four never disturbs the
          week picker or the tab row. */}
      <div className="flex-1 overflow-auto scrollbar-none">
        <div className="px-3 py-4 sm:p-6 lg:p-8">{children}</div>
      </div>
    </div>
    </RouteTransition>
  );
}
