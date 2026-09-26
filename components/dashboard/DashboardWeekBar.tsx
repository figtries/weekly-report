'use client';

import WeekRow from '@/components/weekly/WeekRow';

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
 * THE SAME COMPONENT, NOT A COPY (26 Sep 2026). This used to draw its own badge,
 * a small capsule, and its own solid green button, so the control changed shape
 * between the dashboard and Data Overall. It is `WeekRow` now, the row Weekly
 * Progress, Data Overall and Document Control use; the header gives it the
 * width Data Overall's row has, and a phone's full width.
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
  return (
    <WeekRow
      weeks={weeks}
      selectedWeek={selectedWeek}
      projectCurrentWeek={projectCurrentWeek}
      activeTab=""
      hrefPattern="/?week={week}"
      // OFF here for the same reason it always was: one prefetch is roughly
      // three segment requests and every dashboard week is a whole rollup.
      prefetch={false}
    />
  );
}
