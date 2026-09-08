import { Skeleton } from '@/components/ui/skeleton';

/**
 * Held space for a section that streams.
 *
 * Which project is open is read from a cookie now (see lib/projects.ts), and a
 * cookie is an uncached read — so every screen that depends on it renders per
 * request behind a boundary rather than landing in a shared static shell. This
 * is what those boundaries show for the moment it takes. It is deliberately
 * dumb: a spinner says "wait", held space says "this is the shape of what is
 * coming", and the second one is what stops the page jumping.
 */
export default function SectionSkeleton() {
  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
