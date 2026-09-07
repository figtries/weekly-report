'use client';

import SectionTabs from '@/components/layout/SectionTabs';
import WeekSelect from '@/components/weekly/WeekSelect';
import { usePathname } from 'next/navigation';

/**
 * The four screens of Document Control, laid out exactly like the weekly
 * report's header: the week first, the tabs under it, nothing above either.
 *
 * It used to sit below a page title, a contract number and a paragraph of
 * explanation, inside a centred `max-w-6xl` column — so every edge on this
 * screen landed a different distance from the window than the same edge on the
 * weekly report. The padding here is `WeekTabs`' own, and the tab row is the
 * shared `SectionTabs`, so the two sections now line up to the pixel.
 *
 * They are routes rather than tab state, so a controller can bookmark the
 * screen they live in and a reload lands where they were. The week picker is
 * the weekly report's own control pointed at these routes: one place to learn,
 * one behaviour to maintain, and the two sections stay in step when someone
 * moves between them.
 */
// `short` is what a phone shows. The four full labels come to 484px of text,
// which no phone has: at 390px the row was cut to "...VDRL Summary  V". The
// register name alone identifies the pair, and 'list' says the same thing to a
// reader as 'Data' does while costing four characters less.
const TABS = [
  { key: 'summary', label: 'EDL Summary', short: 'EDL' },
  { key: 'data', label: 'EDL Data', short: 'EDL list' },
  { key: 'vdrl', label: 'VDRL Summary', short: 'VDRL' },
  { key: 'vdrl-data', label: 'VDRL Data', short: 'VDRL list' },
] as const;

export function RegisterTabs({
  weeks,
  selectedWeek,
  projectCurrentWeek,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
}) {
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'summary';

  return (
    <div className="px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
      {/* The week picker leads, the tab row follows a step behind — the same
          two-beat shape the weekly report's header uses, so entering either
          section feels like the same app. */}
      <div className="flex animate-enter items-center gap-2">
        <WeekSelect
          weeks={weeks}
          selectedWeek={selectedWeek}
          projectCurrentWeek={projectCurrentWeek}
          activeTab={active}
          basePath="/dokumen"
        />
        {selectedWeek === projectCurrentWeek && (
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Current
          </span>
        )}
      </div>

      <SectionTabs
        className="-mx-3 mt-2 stagger-1 px-3 sm:mx-0 sm:px-0"
        tabs={TABS.map((t) => ({
          href: `/dokumen/${selectedWeek}/${t.key}`,
          label: t.label,
          short: t.short,
        }))}
      />
    </div>
  );
}
