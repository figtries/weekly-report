'use client';

import WeekRow from '@/components/weekly/WeekRow';
import WeekSteps from '@/components/weekly/WeekSteps';
import { usePathname } from 'next/navigation';
import { Download, Settings2 } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Pressed in the header, heard by the Data screen (`RegisterWorkbench`). */
export const OPEN_SETUP = 'register:setup';

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
  anchorEnd,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
  anchorEnd?: string;
}) {
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'summary';
  const register = active === 'data' ? 'edl' : active === 'vdrl-data' ? 'vdrl' : null;

  return (
    <div className="px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
      {/* THE SAME HEADER AS THE WEEKLY PAGES (25 Sep 2026): the shared
          `WeekRow` over the shared `WeekSteps` bar, in a column that hugs the
          bar so the week picker and Current share its edges. This section had
          its own copy before, a small pill and a grey full-width tab strip,
          and moving between the two sections read as moving between apps. */}
      <div className="flex w-full animate-enter flex-col gap-3 sm:w-fit">
        {/* Export and Setup as two small marks at the row's end (4 Oct 2026):
            as buttons in the register's toolbar they were three more things
            between the tabs and the list. Data screens only. */}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <WeekRow
              weeks={weeks}
              selectedWeek={selectedWeek}
              projectCurrentWeek={projectCurrentWeek}
              activeTab={active}
              basePath="/dokumen"
              anchorEnd={anchorEnd}
            />
          </div>
          {register && <RegisterMarks register={register} className="hidden sm:flex" />}
        </div>
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

      {/* The line explaining EDL against VDRL went on 3 Oct 2026: the people
          who work here know the pair, and on every screen it was the first
          thing between the tabs and the figures. REGISTER_INFO still says it
          where a register is first built. */}
    </div>
  );
}

/**
 * Export and Setup as two small marks: Lucille blue for the file, violet for
 * the register's own settings. Beside Set as current from a tablet up; a
 * phone's week row has no room, so there they sit beside the list's title.
 */
export function RegisterMarks({ register, className }: { register: 'edl' | 'vdrl'; className?: string }) {
  const name = register === 'edl' ? 'EDL' : 'VDRL';
  return (
    <div className={cn('shrink-0 items-center gap-2.5', className)}>
      <a
        href={`/api/register/export?register=${register}`}
        download
        aria-label={`Export the ${name} to Excel`}
        title="Export to Excel"
        className="inline-flex size-11 items-center justify-center rounded-lg bg-primary-soft text-primary shadow-[0_0_0_1px_rgba(29,78,216,.12)] transition-colors duration-200 ease-ios hover:bg-primary hover:text-primary-foreground"
      >
        <Download className="h-[18px] w-[18px]" />
      </a>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_SETUP))}
        aria-label={`Set up the ${name}`}
        title="Setup"
        className="inline-flex size-11 items-center justify-center rounded-lg bg-check-soft text-check shadow-[0_0_0_1px_rgba(109,40,217,.14)] transition-colors duration-200 ease-ios hover:bg-check hover:text-white"
      >
        <Settings2 className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
