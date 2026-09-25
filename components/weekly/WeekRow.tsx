'use client';

import { m } from 'framer-motion';
import { useOptimistic, useTransition, type ReactNode } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { setCurrentWeekAction } from '@/lib/actions';
import WeekSelect from './WeekSelect';

/**
 * The week picker and whether that week is current: the top row of Weekly
 * Progress, Data Overall and Document Control alike.
 *
 * THE WEEK AND WHETHER IT IS CURRENT SIT TOGETHER. On 25 Sep 2026 the stepper
 * ran between the week picker and the "Set Week N as Current" button, so the
 * button was half a screen from the week it acted on and he could not tell
 * where "current" lived. Now the badge and the button take the SAME seat,
 * right of the picker: one replaces the other, and the row reads "Week 31 ·
 * Current" or "Week 31 · Set as current".
 *
 * THE SEAT STRETCHES (25 Sep 2026, from a mockup he picked). Put this row in a
 * column that hugs the tab bar beneath it and the badge or the button fills
 * what the picker leaves, at the picker's height, so the two rows share both
 * edges and the seat keeps its size when one state replaces the other.
 * Stretched rather than pushed to the far end: moved away from the picker, the
 * button stops reading as the picker's.
 *
 * One component because Document Control used to draw its own copy: a smaller
 * pill, in its own greens, and no button at all when the week was not current.
 */
export default function WeekRow({
  weeks,
  selectedWeek,
  projectCurrentWeek,
  activeTab,
  basePath,
  children,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
  /** The tab the picker keeps you on when it changes week. */
  activeTab: string;
  basePath?: string;
  /** Anything that ends the row, after the seat. */
  children?: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  // Optimistic: the green "Current" badge flips instantly on click; the server
  // action confirms in the background and the value reverts only on failure.
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
    <div className="flex items-center gap-2">
      <WeekSelect
        weeks={weeks}
        selectedWeek={selectedWeek}
        projectCurrentWeek={optimisticCurrent}
        activeTab={activeTab}
        basePath={basePath}
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
      {children}
    </div>
  );
}
