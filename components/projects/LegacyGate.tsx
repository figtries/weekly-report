import { Suspense, type ReactNode } from 'react';
import { connection } from 'next/server';

import NoLegacyData from './NoLegacyData';
import { Skeleton } from '@/components/ui/skeleton';
import { getOpenProject } from '@/lib/legacy-bridge';

/**
 * "Does the open project have v1 data?" — asked PER REQUEST, never baked in.
 *
 * The question itself is old (see lib/legacy-bridge.ts). What was wrong was
 * WHERE it got answered. `getActiveProjectId()` reads SQLite synchronously, and
 * under `cacheComponents` a synchronous embedded read counts as deterministic —
 * so it completes during prerendering and the answer lands in the static shell.
 * Proved on 8 Sep 2026 by reading the build's own output:
 *
 *     .next/server/app/weekly/20/overall.html → "asdasd" has no weekly reports yet
 *     .next/server/app/daily.html             → "asdasd" has no daily reports yet
 *
 * A project's NAME, frozen into an HTML file, then served from the CDN to
 * everyone (`X-Vercel-Cache: HIT`, revalidate 30d). On Vercel the build runs
 * against `data/seed.db`, where the open project is Gundih — so the deployed
 * shell of `/weekly/20/overall` carried Gundih's week picker and stepper while
 * the streamed content below it said the OTHER project had no reports. Both on
 * screen at once. That is the bug this component exists to end.
 *
 * `connection()` is what opts the subtree out of the shell, which is the same
 * medicine `LiveProjectSwitcher` already takes for the sidebar. It must sit
 * behind `<Suspense>` or the build fails with "Uncached data was accessed
 * outside of `<Suspense>`".
 *
 * The cost is real and accepted: the gated content now streams instead of
 * prerendering. It has to. Content whose meaning depends on mutable global
 * state was never safely prerenderable — the static version was simply wrong
 * faster.
 */
async function Decide({ what, children }: { what: string; children: ReactNode }) {
  await connection();
  const open = getOpenProject();
  if (open && !open.hasLegacyData) return <NoLegacyData what={what} />;
  return <>{children}</>;
}

export default function LegacyGate({
  what,
  fallback,
  children,
}: {
  /** Plural, lowercase, as it reads in the sentence: "has no weekly reports yet". */
  what: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={fallback ?? <SectionSkeleton />}>
      <Decide what={what}>{children}</Decide>
    </Suspense>
  );
}

/**
 * The chrome variant: shows its children only when the open project has v1
 * data, and NOTHING when it does not — a week picker and a stepper belonging to
 * another project are worse than no chrome at all.
 */
async function DecideChrome({ children }: { children: ReactNode }) {
  await connection();
  const open = getOpenProject();
  if (open && !open.hasLegacyData) return null;
  return <>{children}</>;
}

export function LegacyChromeGate({
  fallback,
  children,
}: {
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return <Suspense fallback={fallback ?? null}>{<DecideChrome>{children}</DecideChrome>}</Suspense>;
}

/** Held space rather than a blank page, on the same reasoning as PlannerSkeleton. */
function SectionSkeleton() {
  return (
    <div className="space-y-4 p-4 sm:p-6 lg:p-8">
      <Skeleton className="h-7 w-2/5" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
