import { ViewTransition } from 'react';
import type { ReactNode } from 'react';

/**
 * The route change, at two heights, WITHOUT reading anything dynamic.
 *
 * THIS REPLACED `app/template.tsx`. A template at the app root remounts
 * everything below it on every navigation — that is what a template is for —
 * so switching from Summary to Detail tore down and rebuilt
 * `app/weekly/[week]/layout.tsx` as well: the week picker, the stepper and the
 * whole tab row destroyed and recreated between two tabs of the same week. You
 * could see it. The "Current" badge replayed its `animate-pop-in` and the
 * Set-Week button its `animate-scale-in`, every single time, on a header that
 * had not changed at all.
 *
 * THE FIRST ATTEMPT AT REPLACING IT WAS A CLIENT COMPONENT CALLING
 * `usePathname()`, and it failed the build in the way AGENTS.md already warns
 * about: under `cacheComponents` the pathname is uncached data, and reading it
 * in the root layout blocks every route in the app — the build died on
 * `/print/daily/[date]`, a page that has nothing to do with navigation. The
 * fix is that the route never had to be looked up. A page already knows which
 * page it is, so it passes `id` and this stays a server component with no
 * hooks, no hydration cost and no Suspense boundary.
 *
 * `id` IS THE WHOLE MECHANISM. React applies the `enter` / `exit` classes to a
 * boundary that genuinely mounts and unmounts; reconciling new children into a
 * surviving boundary is an update instead, which `default="none"` swallows.
 * Because each page renders a different `id` in the same slot of its layout,
 * React sees a keyed swap and the transition is unambiguous.
 *
 * Two heights fall out of that for free:
 *
 *   - A SECTION layout wraps its whole shell with a stable id ('weekly'). Two
 *     tabs of the same week both render it, so the key never changes, so the
 *     furniture never animates.
 *   - A PAGE wraps its own root with an id of its own ('weekly-summary'). That
 *     one changes on every tab, and it sits inside the scroller, so the body
 *     moves and the tab row above it does not.
 *
 * The animations are the `::view-transition-old/new(.page-exit / .page-enter)`
 * rules in globals.css. They fade and do not slide: the movement on a route
 * change comes from the sections inside playing `.animate-enter`, not from the
 * page travelling as one object.
 *
 * The child must be a single element — ViewTransition adds no DOM of its own,
 * it names the element it is given.
 */
export function RouteTransition({ id, children }: { id: string; children: ReactNode }) {
  return (
    <ViewTransition key={id} enter="page-enter" exit="page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
