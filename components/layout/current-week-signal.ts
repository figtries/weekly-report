'use client';

import { useSyncExternalStore } from 'react';

/**
 * The week somebody has just pressed "Set as current" on, before the server
 * has it.
 *
 * The green "Current" badge in the week bar flips the moment it is pressed
 * (`useOptimistic` in WeekRow), while the sidebar card is rendered on the
 * server and only changed once the write, the snapshot push to Blob and the
 * re-render had all landed: on the deployment that was seconds of the two
 * disagreeing about which week the project is in (28 Sep 2026). The badge
 * announces the week here, and the card reads that week's figures from the
 * ones the server already handed it (`OpenProjectStatus.byWeek`), so both move
 * together and neither invents a number.
 *
 * Module state, not context: the badge and the card sit in different trees
 * (the weekly layout and the root layout's sidebar).
 */
let announced: number | null = null;
const listeners = new Set<() => void>();

export function announceCurrentWeek(week: number | null) {
  if (announced === week) return;
  announced = week;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAnnouncedCurrentWeek(): number | null {
  return useSyncExternalStore(
    subscribe,
    () => announced,
    () => null
  );
}
