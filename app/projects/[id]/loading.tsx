import PlannerSkeleton from '@/components/projects/PlannerSkeleton';
import { RouteTransition } from '@/components/motion/RouteTransition';

/**
 * The planner's loading boundary, and THE ONLY boundary above the page.
 *
 * `PlannerSkeleton` is the shape this route lands in (same header band, value
 * strip, toolbar and 44px rows), so the wait looks like the destination and
 * nothing moves when the words arrive. Wrapped in `RouteTransition` under the
 * page's own id, so the list crossfades into it and it crossfades into the
 * plan.
 *
 * Do not add a second `<Suspense>` between this and the page, and do not put a
 * `loading.tsx` in `app/projects/` itself (the list's is in `(list)/`): a
 * boundary that finishes during the prerender takes a segment id the resume
 * reuses, and every full load of a plan threw #418 (13 Nov 2026, see page.tsx).
 */
export default function Loading() {
  return (
    <RouteTransition id="project-home">
      <PlannerSkeleton />
    </RouteTransition>
  );
}
