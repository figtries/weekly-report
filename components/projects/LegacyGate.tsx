import { Suspense, type ReactNode } from 'react';
import { connection } from 'next/server';

import NoLegacyData from './NoLegacyData';
import SectionSkeleton from '@/components/ui/SectionSkeleton';
import { buildProjectDashboardData } from '@/lib/dashboard-db';
import { getOpenProject } from '@/lib/legacy-bridge';

/**
 * A project with no v1 data is not automatically a project with nothing to
 * show. The WEEKLY pages read SQLite for it now (`getOpenDb` in lib/data.ts),
 * so what stops them is not the store the project is in — it is whether it has
 * a plan to report against at all. Daily, Reports and Klaim have no SQLite path
 * yet (board item 14) and pass `planned={false}`, which is the old behaviour.
 */
function planOf(projectId: string) {
  const d = buildProjectDashboardData(projectId);
  return { weighed: d?.hasPlan ?? false, scheduled: d?.hasSchedule ?? false };
}

/**
 * What a page needs of a SQLite project before it can draw anything.
 * `true` is a weighed plan, which a weekly report cannot do without.
 * `'schedule'` is a WBS and weeks with or without weight: the Weights screen,
 * which is where weight comes from, and the week bar that leads to it.
 */
type Planned = boolean | 'schedule';

/** Null when the page may render; otherwise the card to show instead. */
async function gateFor(planned: Planned, what: string): Promise<ReactNode | null> {
  const open = await getOpenProject();
  if (!open || open.hasLegacyData) return null;
  if (!planned) return <NoLegacyData what={what} />;
  const plan = planOf(open.id);
  if (plan.weighed || (planned === 'schedule' && plan.scheduled)) return null;
  // Scheduled but nobody budgeted it: say what is missing and where it goes,
  // instead of a "Go to Data Overall" that lands on this same card.
  return <NoLegacyData what={what} noBudgets={plan.scheduled} />;
}

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
async function Decide({
  what,
  planned,
  children,
}: {
  what: string;
  planned: Planned;
  children: ReactNode;
}) {
  await connection();
  const card = await gateFor(planned, what);
  return <>{card ?? children}</>;
}

export default function LegacyGate({
  what,
  planned = false,
  fallback,
  children,
}: {
  /** Plural, lowercase, as it reads in the sentence: "has no weekly reports yet". */
  what: string;
  /** True where the page can render a SQLite project with a plan. */
  planned?: Planned;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={fallback ?? <SectionSkeleton />}>
      <Decide what={what} planned={planned}>
        {children}
      </Decide>
    </Suspense>
  );
}

/**
 * The chrome variant: shows its children only when the open project has v1
 * data, and NOTHING when it does not — a week picker and a stepper belonging to
 * another project are worse than no chrome at all.
 */
async function DecideChrome({ planned, children }: { planned: Planned; children: ReactNode }) {
  await connection();
  if (await gateFor(planned, '')) return null;
  return <>{children}</>;
}

export function LegacyChromeGate({
  planned = false,
  fallback,
  children,
}: {
  planned?: Planned;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={fallback ?? null}>
      <DecideChrome planned={planned}>{children}</DecideChrome>
    </Suspense>
  );
}

