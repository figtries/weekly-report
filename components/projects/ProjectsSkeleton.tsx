import { Skeleton } from '@/components/ui/skeleton';

/**
 * Held space for the project list.
 *
 * Shared by the page's own Suspense fallback and by `app/projects/loading.tsx`
 * so a navigation and a page load show the SAME shape — two different skeletons
 * for one screen reads as a flicker, not as loading.
 */
export default function ProjectsSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-3 py-5 sm:p-6 lg:p-8">
      <Skeleton className="h-9 w-40" />
      <Skeleton className="mt-3 h-4 w-2/3 max-w-lg" />
      <Skeleton className="mt-5 h-11 w-full max-w-md rounded-xl" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    </div>
  );
}
