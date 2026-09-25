'use client';

import WeekRow from '@/components/weekly/WeekRow';
import WeekSteps from '@/components/weekly/WeekSteps';
import { REGISTER_INFO } from '@/lib/register-shared';
import { usePathname } from 'next/navigation';

/**
 * The four screens of Document Control, laid out exactly like the weekly
 * report's header: the week first, the tabs under it, nothing above either.
 *
 * It used to sit below a page title, a contract number and a paragraph of
 * explanation, inside a centred `max-w-6xl` column — so every edge on this
 * screen landed a different distance from the window than the same edge on the
 * weekly report. The padding here is `WeekTabs`' own, and the week row and the
 * tab bar are the weekly pages' own components, so the two sections line up to
 * the pixel.
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
  const info = REGISTER_INFO[active.startsWith('vdrl') ? 'vdrl' : 'edl'];

  return (
    <div className="px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
      {/* THE SAME HEADER AS THE WEEKLY PAGES (25 Sep 2026): the shared
          `WeekRow` over the shared `WeekSteps` bar, in a column that hugs the
          bar so the week picker and Current share its edges. This section had
          its own copy before, a small pill and a grey full-width tab strip,
          and moving between the two sections read as moving between apps. */}
      <div className="flex w-full animate-enter flex-col gap-3 sm:w-fit">
        <WeekRow
          weeks={weeks}
          selectedWeek={selectedWeek}
          projectCurrentWeek={projectCurrentWeek}
          activeTab={active}
          basePath="/dokumen"
        />
        <WeekSteps
          className="sm:w-full"
          ariaLabel="Document Control"
          activeKey={active}
          steps={TABS.map((t) => ({
            key: t.key,
            href: `/dokumen/${selectedWeek}/${t.key}`,
            label: t.label,
            short: t.short,
          }))}
        />
      </div>

      {/* WHICH OF THE TWO YOU ARE LOOKING AT, AND WHAT THAT MEANS. Four tabs
          reading EDL, EDL list, VDRL, VDRL list told a document controller
          everything and everybody else nothing, and the difference is not
          decoration: one register is owed BY you and has promised dates, the
          other is owed TO you and has none, which is why only one of these
          screens draws a plan line or counts anything overdue. One line, on
          every screen of the section, because the pair is a choice you make
          again every time you come back. */}
      <p className="mt-3 stagger-1 animate-enter max-w-4xl text-[11px] leading-snug text-muted-foreground">
        <span className="font-semibold text-foreground">
          {info.short} · {info.long}
        </span>{' '}
        {info.owes}. {info.detail}
      </p>
    </div>
  );
}
