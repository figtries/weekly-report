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
    // Not a step, and deliberately not in `steps` below: the stepper is the
    // order a WEEK is worked through, and prices belong to the project. Being
    // listed here is what makes the tab detect as active and get prefetched;
    // its visible entry is the pill in the action group.
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
      n: '1',
      label: 'Fill in',
      href: `/weekly/${selectedWeek}/overall`,
      // No badge at zero rather than a "0": an empty week should read as
      // finished, and a grey nought beside every step is just furniture.
      badge: dueCount > 0 ? String(dueCount) : undefined,
      badgeTone: 'todo',
    },
    {
      key: 'control',
      n: '2',
      label: 'Check',
      href: `/weekly/${selectedWeek}/control`,
      badge: checkCount > 0 ? String(checkCount) : undefined,
      badgeTone: 'warn',
    },
    // Lands on Summary, and the four sheets appear as a tab row beneath.
    { key: 'report', n: '3', label: 'Report', href: `/weekly/${selectedWeek}/summary` },
    // NO NUMBER, because it is not a stage of the week: what an activity is
    // worth belongs to the project and is as true in week 4 as in week 40.
    // It is here all the same. It was left out of this bar on 13 Sep 2026,
    // reachable only from the setup card and a quiet link under the map, and
    // that reasoning was about not making it a fourth STEP. It skipped the
    // question of whether people could find it at all, and they could not.
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
      {/* ONE grid holds all four controls, and the stepper changes seat in it
          rather than being rendered twice — a second `WeekSteps` would mean two
          elements claiming the same shared-layout id and the sliding pill would
          jump between them.

          On a phone: week picker and actions share the top row, stepper spans
          beneath. From `md` up the stepper moves INTO that row, between the two,
          which is what closes the half-screen of white the actions used to be
          pushed across. Every control on the row stands 44px tall, so they read
          as one bar instead of three things that happen to be near each other. */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 md:grid-cols-[auto_1fr_auto] md:gap-x-4">
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
          <WeekSelect
            weeks={weeks}
            selectedWeek={selectedWeek}
            projectCurrentWeek={optimisticCurrent}
            activeTab={activeTab}
          />
          {isCurrent && (
            <span className="inline-flex shrink-0 animate-pop-in items-center gap-1.5 whitespace-nowrap rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              Current
            </span>
          )}
        </div>

        <WeekSteps
          // min-w-0: a grid item defaults to min-width:auto, which would let
          // the stepper push the row wider instead of scrolling inside it.
          className="col-span-2 col-start-1 row-start-2 -mx-3 min-w-0 px-3 sm:mx-0 sm:px-0 md:col-span-1 md:col-start-2 md:row-start-1"
          steps={steps}
          activeKey={activeStep}
          stretch
        />

        {/* The "set as current" button unmounts once the week is current; the
            group is justify-end, so the print button at the right edge never
            moves. */}
        <div className="col-start-2 row-start-1 flex shrink-0 flex-wrap items-center justify-end gap-2 md:col-start-3">
          {/* ACTIVITIES IS BACK IN THIS HEADER, as an unnumbered entry in the
              step row rather than as a fourth step. What an activity is worth
              and how it is counted moved into the row's own panel on Fill in on
              13 Sep 2026, and that is still where you change ONE of them; this
              is the screen for the afternoon when two hundred are set at once,
              and for seeing a heading's budget against what its rows have
              claimed, which no per-row panel can show. Taking it out of here
              answered "should it be a step" — it should not — but it also made
              it unfindable, which was never the intention. */}
          {!isCurrent && (
            <m.button {...pressMotion}
              onClick={setAsCurrent}
              disabled={isPending}
              className="inline-flex min-h-11 animate-scale-in items-center justify-center gap-1.5 rounded-lg bg-ok px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-300 ease-ios hover:brightness-110 disabled:opacity-70"
              title="Pin this as the week the project is in. It is where the app opens, until you move it or clear it."
            >
              <span className="hidden sm:inline">Set Week {selectedWeek} as Current</span>
              <span className="sm:hidden">Set as Current</span>
            </m.button>
          )}
          {active.printable && (
            <SavePdfButton
              url={`/api/pdf/weekly/${selectedWeek}?only=${activeTab}`}
              filename={`Week ${selectedWeek} - ${active.label}.pdf`}
              ariaLabel={`Save ${active.label} as PDF`}
            />
          )}
        </div>
        {/* The four sheets are siblings, not stages, so they stay a plain tab
            row — and only while step 3 is where you are. Showing them
            permanently put six destinations on a 390px screen and made
            "Report" look like a heading rather than somewhere to go.

            It lives INSIDE this grid, on the stepper's own column, and that is
            the whole fix for the "g rapih" of 10 September 2026. Rendered below
            the grid it ran the full width of the header while the stepper above
            it stopped short of the week picker and the Save PDF button, so the
            two bands were different widths and neither edge lined up with
            anything. Sharing the column makes them exactly one width, at every
            breakpoint, without either of them measuring the other. */}
        {onReport && (
          <SectionTabs
            className="col-span-2 col-start-1 row-start-3 -mx-3 min-w-0 px-3 sm:mx-0 sm:px-0 md:col-span-1 md:col-start-2 md:row-start-2"
            stretch
            tabs={GROUPS.laporan.map((t) => ({
              href: `/weekly/${selectedWeek}/${t.key}`,
              label: t.short,
            }))}
          />
        )}
      </div>
    </div>
  );
}
