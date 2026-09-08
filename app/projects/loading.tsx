import ProjectsSkeleton from '@/components/projects/ProjectsSkeleton';

/**
 * A `loading` file is not decoration here — it is what makes this route
 * PREFETCHABLE again.
 *
 * Which project is open moved into a cookie, and a cookie is an uncached read,
 * so this route became dynamic. Next does not prefetch a dynamic route AT ALL
 * unless it has a loading boundary; without one, clicking Projects in the
 * sidebar waited on a server round trip showing the page you were leaving. With
 * one, everything down to this boundary is prefetched and the click paints
 * immediately while the list streams in behind it.
 */
export default function Loading() {
  return <ProjectsSkeleton />;
}
