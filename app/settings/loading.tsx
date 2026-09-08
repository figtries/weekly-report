import SectionSkeleton from '@/components/ui/SectionSkeleton';

/**
 * Not decoration — this is what keeps the route CHEAP to prefetch.
 *
 * Which project is open lives in a cookie, and a cookie is an uncached read, so
 * this route is dynamic. Next will not prefetch a dynamic route at all unless
 * it has a loading boundary; without one, the sidebar's `<Link>` still asks for
 * the route and every segment of it comes back off a serverless function.
 * Measured on the deployment, 8 Sep 2026: landing on the planner fired 29 RSC
 * segment requests totalling 4,547ms of function time, the last finishing 7.3
 * seconds in. With a boundary, everything above it is a static shell — served
 * from the edge, and painted the instant the link is clicked.
 */
export default function Loading() {
  return <SectionSkeleton />;
}
