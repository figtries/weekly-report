'use client';

import { pressMotion } from '@/components/motion/Press';

import { m } from 'framer-motion';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useTransition } from 'react';
import { setCurrentWeekAction } from '@/lib/actions';
import SavePdfButton from '@/components/print/SavePdfButton';
import SectionTabs from '@/components/layout/SectionTabs';
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

  const steps: WeekStep[] = [
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
      badgeTone: 'warn',
    },
    // Lands on Summary, and the four sheets appear as a tab row beneath.
    { key: 'report', label: 'Report', href: `/weekly/${selectedWeek}/summary` },
    // Not a stage of the week (what an activity is worth is as true in week 4
    // as in week 40), but it is here all the same: left out on 13 Sep 2026,
    // nobody could find it.
    { key: 'weights', label: 'Weights', href: `/weekly/${selectedWeek}/weights` },
  ];
  const activeStep = onReport ? 'report' : activeTab;

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
    <div className="px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
      {/* THE WEEK AND WHETHER IT IS CURRENT SIT TOGETHER, on their own row
          above the bar. On 25 Sep 2026 the stepper ran between the week picker
          and the "Set Week N as Current" button, so the button was half a
          screen from the week it acted on and he could not tell where
          "current" lived. Now the badge and the button take the SAME seat,
          right of the picker: one replaces the other, and the row reads
          "Week 31 · Current" or "Week 31 · Set as current". Save as PDF owns
          the far end and never moves. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <WeekSelect
            weeks={weeks}
            selectedWeek={selectedWeek}
            projectCurrentWeek={optimisticCurrent}
            activeTab={activeTab}
          />
          {isCurrent ? (
            <span className="inline-flex shrink-0 animate-pop-in items-center gap-1.5 whitespace-nowrap rounded-full bg-ok-soft px-3 py-1.5 text-[13px] font-semibold text-ok">
              <span className="h-2 w-2 rounded-full bg-ok" />
              Current
            </span>
          ) : (
            // The badge's own outline, before it is filled in: a hollow dot in
            // the same green, so the two read as one control in two states.
            <m.button {...pressMotion}
              onClick={setAsCurrent}
              disabled={isPending}
              className="inline-flex min-h-11 shrink-0 animate-scale-in items-center gap-2 whitespace-nowrap rounded-lg border border-ok/40 bg-card px-3.5 text-sm font-semibold text-ok shadow-sm transition-colors duration-300 ease-ios hover:bg-ok-soft disabled:opacity-70"
              title="Pin this as the week the project is in. It is where the app opens, until you move it or clear it."
            >
              <span aria-hidden className="h-2 w-2 rounded-full border-2 border-ok" />
              Set as current
            </m.button>
          )}
        </div>
        {active.printable && (
          <SavePdfButton
            url={`/api/pdf/weekly/${selectedWeek}?only=${activeTab}`}
            filename={`Week ${selectedWeek} - ${active.label}.pdf`}
            ariaLabel={`Save ${active.label} as PDF`}
          />
        )}
      </div>

      <WeekSteps className="mt-3" steps={steps} activeKey={activeStep} />

      {/* The four sheets are siblings, not stages, so they stay a plain tab
          row — and only while Report is where you are. Showing them
          permanently put eight destinations on a 390px screen and made
          "Report" look like a heading rather than somewhere to go. */}
      {onReport && (
        <SectionTabs
          className="mt-2"
          tabs={GROUPS.laporan.map((t) => ({
            href: `/weekly/${selectedWeek}/${t.key}`,
            label: t.short,
          }))}
        />
      )}
    </div>
  );
}
