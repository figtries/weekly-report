import { createElement, type ComponentProps, type ComponentType } from 'react';

import type LinkDragCardType from './LinkDragCard';
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

/** The same, for the card a Gantt drag opens: warmed on the drag's first press. */
type CardProps = ComponentProps<typeof LinkDragCardType>;
let card: ComponentType<CardProps> | null = null;
let cardPending: Promise<void> | null = null;

export function warmLinkDragCard(): Promise<void> {
  cardPending ??= import('./LinkDragCard').then((m) => {
    card = m.default;
  });
  return cardPending;
}

export function loadedLinkDragCard(): ComponentType<CardProps> | null {
  return card;
}

/**
 * A fixed component that renders the warmed card, so the screen never picks a
 * component in render (React Compiler's static-components rule). Renders
 * nothing until the card is loaded; ScheduleSheet only asks once it is.
 */
export function ReadyLinkDragCard(props: CardProps) {
  return card ? createElement(card, props) : null;
}
