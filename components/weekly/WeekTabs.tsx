'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useTransition } from 'react';
import { setCurrentWeekAction } from '@/lib/actions';
import SavePdfButton from '@/components/print/SavePdfButton';
import WeekSteps, { type WeekStep } from './WeekSteps';
import WeekSelect from './WeekSelect';

/**
 * The weekly pages, split the way people use them.
 *
 * These used to be seven flat entries in the sidebar, which put report SHEETS
 * beside the tools that fill them in. The sidebar now carries one entry per
 * group and the tabs live here, next to the week they belong to.
 *
 * The two groups are now the first two steps of `WeekSteps` and the third — the
 * four report sheets, which stay a tab row because they are siblings rather
 * than stages. Before that, the row swapped between the two groups depending on
 * where you already were, so the Update screen offered no route to the report.
 *
 * `printable` must match the ReportKey union in app/print/weekly/[week]/page.tsx.
 * A tab that claims printable without a sheet there makes lib/pdf.ts wait for a
 * '.print-sheet-a4' that never renders, so the PDF request hangs rather than
 * erroring — always set this deliberately when adding a tab.
 *
 * `label` is what the saved PDF is named, so it stays as the report calls it;
 * `short` is only what the tab shows.
 */
const GROUPS = {
  // These two must use the SAME WORDS as the steps in `WeekSteps` and as the
  // page titles they lead to. They used to disagree — the control screen was
  // "Review" here, "Control Panel" on the page and "Check" in the stepper —
  // and a screen with three names is a screen nobody can describe.
  progress: [
    { key: 'overall', label: 'Fill in', short: 'Fill in', printable: false },
    { key: 'control', label: 'Check', short: 'Check', printable: false },
    // Listed here so the tab detects as active and gets prefetched; its
    // visible entry is the last one in `steps` below.
    { key: 'weights', label: 'Weights', short: 'Weights', printable: false },
  ],
  laporan: [
    { key: 'summary', label: 'Overall Summary', short: 'Summary', printable: true },
    { key: 'detail', label: 'Detail Progress', short: 'Detail', printable: true },
    { key: 'scurve', label: 'S-Curve', short: 'S-Curve', printable: true },
    { key: 'documentation', label: 'Documentation', short: 'Photos', printable: true },
  ],
} as const;

const ALL = [...GROUPS.progress, ...GROUPS.laporan];

export default function WeekTabs({
  weeks,
  selectedWeek,
  projectCurrentWeek,
  dueCount,
  checkCount,
}: {
  weeks: number[];
  selectedWeek: number;
  /**
   * The week the project is in, by the one rule every project follows now —
   * `currentWeekOf` in `lib/current-week.ts`.
   *
   * There used to be a `derivedCurrent` flag beside this that hid the button
   * below on every project except the imported one, because only db.json could
   * store a pin and there was nothing for the button to write anywhere else.
   * Both stores hold one now (`projects.current_week`), so the flag is gone and
   * the control is the same on every project.
   */
  projectCurrentWeek: number;
  /** Items the schedule says are due this week and not yet dealt with. */
  dueCount: number;
  /** Validation findings that are errors or warnings. */
  checkCount: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Optimistic: the green "Current" badge flips instantly on click; the server
  // action confirms in the background and the value reverts only on failure.
  const [optimisticCurrent, setOptimisticCurrent] = useOptimistic(projectCurrentWeek);

  const active = ALL.find((t) => pathname.endsWith(`/${t.key}`)) ?? GROUPS.progress[0];
  const activeTab = active.key;
  const onReport = GROUPS.laporan.some((t) => t.key === activeTab);
  const isCurrent = selectedWeek === optimisticCurrent;

  // THE BAR HOLDS THE SECTION YOU ARE IN, AND ONLY THAT (25 Sep 2026). Report
  // was a fourth tab here beside Fill in, Check and Weights; it is now the
  // `SectionSwitch` button beside each page title, and on the report the four
  // sheets are the bar themselves instead of a second row under a "Report" tab.
  const steps: WeekStep[] = onReport
    ? GROUPS.laporan.map((t) => ({
        key: t.key,
        label: t.short,
        href: `/weekly/${selectedWeek}/${t.key}`,
      }))
    : [
        {
          key: 'overall',
          label: 'Fill in',
          href: `/weekly/${selectedWeek}/overall`,
          // No badge at zero rather than a "0": an empty week should read as
          // finished, and a grey nought beside every step is just furniture.
          badge: dueCount > 0 ? String(dueCount) : undefined,
          badgeTone: 'todo',
        },
        {
          key: 'control',
          label: 'Check',
          href: `/weekly/${selectedWeek}/control`,
          badge: checkCount > 0 ? String(checkCount) : undefined,
          badgeTone: 'todo',
        },
        // Not a stage of the week (what an activity is worth is as true in
        // week 4 as in week 40), but it is here all the same: left out on
        // 13 Sep 2026, nobody could find it.
        { key: 'weights', label: 'Weights', href: `/weekly/${selectedWeek}/weights` },
      ];

  // Keep the likeliest next hops warm: this week's sibling tabs and the daily
  // list. `weeks` gets a fresh identity on every server re-render (i.e. after
  // each mutation/refresh clears the client cache), so this re-warms exactly
  // when previously prefetched payloads have been invalidated.
  useEffect(() => {
    const warm = () => {
      for (const t of ALL) {
        if (t.key !== activeTab) router.prefetch(`/weekly/${selectedWeek}/${t.key}`);
      }
      router.prefetch('/daily');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 400);
    return () => window.clearTimeout(id);
  }, [selectedWeek, activeTab, weeks, router]);

  function setAsCurrent() {
    startTransition(async () => {
      setOptimisticCurrent(selectedWeek);
      const res = await setCurrentWeekAction(selectedWeek);
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <div className="relative px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
      {/* THE WEEK AND WHETHER IT IS CURRENT SIT TOGETHER, on their own row
          above the bar. On 25 Sep 2026 the stepper ran between the week picker
          and the "Set Week N as Current" button, so the button was half a
          screen from the week it acted on and he could not tell where
          "current" lived. Now the badge and the button take the SAME seat,
          right of the picker: one replaces the other, and the row reads
          "Week 31 · Current" or "Week 31 · Set as current".

          THE ROW IS AS WIDE AS THE BAR BENEATH IT (25 Sep 2026, from a mockup
          he picked). The column hugs the bar from `sm` up, and the badge and
          the button both STRETCH to fill what the picker leaves, at the
          picker's height, so the two rows share both edges and the seat does
          not change size when one state replaces the other. Stretched rather
          than pushed to the far end: moved away from the picker, the button
          stops reading as the picker's. */}
      <div className="flex w-full flex-col gap-3 sm:w-fit">
        <div className="flex items-center gap-2">
          <WeekSelect
            weeks={weeks}
            selectedWeek={selectedWeek}
            projectCurrentWeek={optimisticCurrent}
            activeTab={activeTab}
          />
          {isCurrent ? (
            <span className="inline-flex min-h-11 flex-1 animate-pop-in items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-ok-soft px-3.5 text-sm font-semibold text-ok">
              <span className="h-2 w-2 rounded-full bg-ok" />
              Current
            </span>
          ) : (
            // The badge's own outline, before it is filled in: a hollow dot in
            // the same green, so the two read as one control in two states.
            <m.button {...pressMotion}
              onClick={setAsCurrent}
              disabled={isPending}
              className="inline-flex min-h-11 flex-1 animate-scale-in items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-ok/40 bg-card px-3.5 text-sm font-semibold text-ok shadow-sm transition-colors duration-300 ease-ios hover:bg-ok-soft disabled:opacity-70"
              title="Pin this as the week the project is in. It is where the app opens, until you move it or clear it."
            >
              <span aria-hidden className="h-2 w-2 rounded-full border-2 border-ok" />
              Set as current
            </m.button>
          )}
          {/* In the row on a phone, where the bar is the screen's width and
              the row ends where the screen does. From `sm` it leaves the row
              for the page's top corner, so the row can stay the bar's width. */}
          {active.printable && (
            <div className="shrink-0 sm:absolute sm:top-4 sm:right-6 lg:right-8">
              <SavePdfButton
                url={`/api/pdf/weekly/${selectedWeek}?only=${activeTab}`}
                filename={`Week ${selectedWeek} - ${active.label}.pdf`}
                ariaLabel={`Save ${active.label} as PDF`}
              />
            </div>
          )}
        </div>

        {/* `sm:w-full` over the bar's own `sm:w-fit`: should the row ever be
            the wider of the two, the bar follows it instead of falling short. */}
        <WeekSteps className="sm:w-full" steps={steps} activeKey={activeTab} />
      </div>
    </div>
  );
}
