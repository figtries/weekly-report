'use client';

import WeekRow from '@/components/weekly/WeekRow';
import WeekSteps from '@/components/weekly/WeekSteps';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';

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
// which no phone has: at 390px the row was cut to "...VDRL Summary  V". So a
// phone shows the SAME words as the desktop, stacked on two lines (9 Oct 2026:
// 'EDL' / 'EDL list' read as a different menu from the desktop's).
const TABS = [
  { key: 'summary', label: 'EDL Summary', short: 'EDL\nSummary' },
  { key: 'data', label: 'EDL Data', short: 'EDL\nData' },
  { key: 'vdrl', label: 'VDRL Summary', short: 'VDRL\nSummary' },
  { key: 'vdrl-data', label: 'VDRL Data', short: 'VDRL\nData' },
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
    <div className="relative z-30 px-4 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
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
          anchorEnd={anchorEnd}
          compact={register !== null}
        >
          {/* Data screens only, placed as the weekly report places its Export
              Excel: in the row on a phone, the page's top corner from md. */}
          {register && <RegisterMarks register={register} className="flex md:hidden" />}
        </WeekRow>
        <PhoneRegisterBar active={active} selectedWeek={selectedWeek} />
        <WeekSteps
          className="max-sm:hidden sm:w-full"
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
      {register && <RegisterMarks register={register} className="absolute top-4 right-6 hidden md:flex lg:right-8" />}

      {/* The line explaining EDL against VDRL went on 3 Oct 2026: the people
          who work here know the pair, and on every screen it was the first
          thing between the tabs and the figures. REGISTER_INFO still says it
          where a register is first built. */}
    </div>
  );
}

/**
 * A phone's bar (9 Oct 2026, from the mockup he approved): two tabs, EDL and
 * VDRL, each opening its two screens in a menu exactly as wide as the tab and
 * flush under it. Words only. Hand-rolled, not Radix: one tiny menu does not
 * earn a portal and a lazy chunk.
 */
const REGISTERS = [
  { name: 'EDL', screens: [{ key: 'summary', label: 'Summary' }, { key: 'data', label: 'Data' }] },
  { name: 'VDRL', screens: [{ key: 'vdrl', label: 'Summary' }, { key: 'vdrl-data', label: 'Data' }] },
] as const;

function PhoneRegisterBar({ active, selectedWeek }: { active: string; selectedWeek: number }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <nav
      ref={ref}
      aria-label="Document Control"
      className="relative z-20 grid w-full grid-cols-2 gap-1 rounded-2xl bg-card p-1 shadow-sm ring-1 ring-foreground/5 sm:hidden print:hidden"
    >
      {REGISTERS.map((r) => {
        const here = r.screens.find((s) => s.key === active);
        const isOpen = open === r.name;
        return (
          <div key={r.name} className="relative">
            <button
              type="button"
              aria-expanded={isOpen}
              aria-haspopup="menu"
              onClick={() => setOpen(isOpen ? null : r.name)}
              className={cn(
                'flex min-h-11 w-full items-center justify-center rounded-lg text-sm transition-colors duration-300 ease-ios',
                here ? 'bg-chart-1/10 font-semibold text-chart-1' : 'font-medium text-foreground/80'
              )}
            >
              {r.name}
              {here && <span className="font-medium">&nbsp;·&nbsp;{here.label}</span>}
            </button>
            {isOpen && (
              <div
                role="menu"
                className="absolute inset-x-0 top-[calc(100%+0.5rem)] animate-fade-in-up rounded-xl bg-card p-1 shadow-lg ring-1 ring-foreground/10"
              >
                {r.screens.map((s) => (
                  <Link
                    key={s.key}
                    role="menuitem"
                    href={`/dokumen/${selectedWeek}/${s.key}`}
                    aria-current={s.key === active ? 'page' : undefined}
                    onClick={() => setOpen(null)}
                    className={cn(
                      'flex min-h-11 items-center justify-center rounded-lg text-sm',
                      s.key === active ? 'bg-chart-1/10 font-semibold text-chart-1' : 'font-medium text-foreground/80 active:bg-muted'
                    )}
                  >
                    {s.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * Export and Setup, as the weekly report shows its Export Excel (4 Oct 2026):
 * solid squares beside Current on a phone; from md they leave the row for the
 * page's top-right corner, and say what they are from lg ("Export", then
 * "Export Excel" from xl, where there is room). Export is Lucille
 * blue, Setup Lucille violet. The corner copy is a sibling of the week column,
 * never inside it: the column's entrance animation leaves a transform that
 * would anchor `absolute` to the column instead of the page.
 */
export function RegisterMarks({ register, className }: { register: 'edl' | 'vdrl'; className?: string }) {
  const name = register === 'edl' ? 'EDL' : 'VDRL';
  const mark = 'inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-sm font-medium text-white shadow-sm transition-colors duration-300 ease-ios hover:shadow-md max-[380px]:size-10 lg:w-auto lg:px-3 xl:px-4';
  return (
    <div className={cn('shrink-0 items-center gap-2 max-[380px]:gap-1.5', className)}>
      <a
        href={`/api/register/export?register=${register}`}
        download
        aria-label={`Export Excel (${name})`}
        title={`Export the ${name} to Excel`}
        className={cn(mark, 'bg-primary hover:bg-primary-hover')}
      >
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M14 3v5h5M9 13l3 4m0-4l-3 4" />
        </svg>
        <span className="hidden lg:inline">Export<span className="hidden xl:inline"> Excel</span></span>
      </a>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event(OPEN_SETUP))}
        aria-label={`Setup (${name})`}
        title={`Set up the ${name}`}
        className={cn(mark, 'bg-check hover:bg-check/90')}
      >
        <Settings2 className="h-4 w-4 shrink-0" />
        <span className="hidden lg:inline">Setup</span>
      </button>
    </div>
  );
}
