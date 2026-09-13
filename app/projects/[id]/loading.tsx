import PlannerSkeleton from '@/components/projects/PlannerSkeleton';
import { RouteTransition } from '@/components/motion/RouteTransition';

/**
 * The planner's own loading boundary, and it exists to STOP A PARENT'S.
 *
 * `app/projects/loading.tsx` sits one segment above this one, and a `loading`
 * file covers every route beneath it — so opening a project showed the PROJECT
 * LIST's skeleton: three card-shaped blocks and a search bar, the shape of the
 * page you had just left, on the way to a page that looks nothing like it.
 * Photographed at 390px it read as the click not having worked, followed by the
 * plan arriving in one frame with no transition at all. That is the whole of
 * "opening a project is not smooth".
 *
 * `PlannerSkeleton` is the shape this route actually lands in — same header
 * band, same value strip, same toolbar, same 44px rows — so the wait now looks
 * like the destination instead of the origin, and nothing moves when the words
 * arrive.
 *
 * Wrapped, like every other arrival in the app, so the list crossfades into it
 * rather than being replaced between two frames. The page's own `<Suspense>`
 * renders the same skeleton behind the same wrapper, so the hand-off from this
 * boundary to that one is one identical image fading into itself.
 */
export default function Loading() {
  return (
    <RouteTransition id="project-home">
      <PlannerSkeleton />
    </RouteTransition>
  );
}
