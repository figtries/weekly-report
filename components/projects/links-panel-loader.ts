import type { ComponentProps, ComponentType } from 'react';

import type LinksPanelType from './LinksPanel';

/**
 * The Links panel, loaded off the press path and then rendered WITHOUT
 * suspending.
 *
 * `next/dynamic` suspends once even when its module is already in the cache,
 * and React 19 throttles revealing a Suspense boundary (~300 ms), so pressing
 * Links took ~400 ms on a 4x-throttled phone (measured 7 Oct 2026) while
 * doing ~40 ms of actual work. ScheduleSheet warms this when the page goes
 * idle; once `loadedLinksPanel()` returns the component, RowMenu renders it
 * directly. The planner's first load still does not carry it.
 */
type Props = ComponentProps<typeof LinksPanelType>;

let loaded: ComponentType<Props> | null = null;
let pending: Promise<void> | null = null;

export function warmLinksPanel(): Promise<void> {
  pending ??= import('./LinksPanel').then((m) => {
    loaded = m.default;
  });
  return pending;
}

export function loadedLinksPanel(): ComponentType<Props> | null {
  return loaded;
}
