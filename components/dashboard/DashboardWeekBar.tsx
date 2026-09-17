'use client';

import { m } from 'framer-motion';
import { useOptimistic, useTransition } from 'react';

import { pressMotion } from '@/components/motion/Press';
import WeekSelect from '@/components/weekly/WeekSelect';
import { setCurrentWeekAction } from '@/lib/actions';

/**
 * The dashboard's week picker, with the two companions every other section's
 * picker already had: the green "Current" badge, and the button that MOVES the
 * current week.
 *
 * Weekly Progress, Reports and Document Control all read the project's current
 * week and all say so on screen; the dashboard was the one section that did
 * neither. It picked its own week — the last one with recorded progress — so
 * Gundih opened on week 43 while every other screen called week 36 current, and
 * there was no way to move the pointer from here. Same value, same badge, same
 * button now (reported 15 September 2026).
 *
 * There used to be a `settable` flag here, the inverse of `WeekTabs`'
 * `derivedCurrent`, because only db.json could store a pinned week: the button
 * was shown on the imported project and withheld everywhere else, and the
 * projects that could not pin had their current week guessed from whatever was
 * last filled in. Both stores hold a pin now (`projects.current_week`), so
 * there is no project the button can only fail on and no flag to carry.
 */
export default function DashboardWeekBar({
  weeks,
  selectedWeek,
  projectCurrentWeek,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
}) {
  const [isPending, startTransition] = useTransition();
  // Optimistic, exactly as the weekly header is: the badge flips on the press
  // and the server action confirms behind it.
  const [optimisticCurrent, setOptimisticCurrent] = useOptimistic(projectCurrentWeek);
  const isCurrent = selectedWeek === optimisticCurrent;

  function setAsCurrent() {
    startTransition(async () => {
      setOptimisticCurrent(selectedWeek);
      const res = await setCurrentWeekAction(selectedWeek);
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <WeekSelect
        weeks={weeks}
        selectedWeek={selectedWeek}
        projectCurrentWeek={optimisticCurrent}
        activeTab=""
        hrefPattern="/?week={week}"
        // OFF here for the same reason it always was: one prefetch is roughly
        // three segment requests and every dashboard week is a whole rollup.
        prefetch={false}
      />
      {isCurrent && (
        <span className="inline-flex shrink-0 animate-pop-in items-center gap-1.5 whitespace-nowrap rounded-full bg-ok-soft px-3 py-1 text-xs font-semibold text-ok">
          <span className="h-1.5 w-1.5 rounded-full bg-ok" />
          Current
        </span>
      )}
      {!isCurrent && (
        <m.button
          {...pressMotion}
          onClick={setAsCurrent}
          disabled={isPending}
          className="inline-flex min-h-11 animate-scale-in items-center justify-center gap-1.5 rounded-lg bg-ok px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-300 ease-ios hover:brightness-110 disabled:opacity-70"
          title="Pin this as the week the project is in. It is where the app opens, until you move it or clear it."
        >
          <span className="hidden sm:inline">Set Week {selectedWeek} as Current</span>
          <span className="sm:hidden">Set as Current</span>
        </m.button>
      )}
    </div>
  );
}
