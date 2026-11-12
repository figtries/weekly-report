import { useLayoutEffect } from 'react';

/**
 * A screen drawn without the app's chrome (sign in, checkout) marks <html> with
 * `data-bare` while it is on screen; globals.css hides `[data-app-chrome]` under
 * it. BARE_SCRIPT (lib/access-lock.ts) sets it before the first paint of a hard
 * load; this owns it after. A route the router keeps hidden runs its effect
 * cleanups, so the mark goes the moment the screen does.
 *
 * It replaced `body:has([data-login]...)` (12 Nov 2026): a :has on <body> with
 * an attribute test re-styled the WHOLE page on every DOM insert and every
 * inline style change anywhere, and the planner does both on every scroll.
 */
export function useBareScreen() {
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-bare', '');
    return () => html.removeAttribute('data-bare');
  }, []);
}
