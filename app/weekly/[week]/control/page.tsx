import { notFound } from 'next/navigation';
import { computeHealth, validateWeek } from '@/lib/analysis';
import { computeRollup, flattenTree, promoteNestedSpkContracts } from '@/lib/rollup';
import { getOpenDb } from '@/lib/data';
import WeekChecks from '@/components/weekly/WeekChecks';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts); this validation
  // refuses any read it has not been told about. A null value samples the
  // visitor who has never chosen a project.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
};

/**
 * Step ② — the gate, and nothing else.
 *
 * This page used to be the whole "Control Panel": six stat cards, the contract
 * value, a narrative paragraph, a look-ahead, a laggard table, the checks and
 * the sign-off, all as equal-sized cards. The one thing it exists to answer —
 * may this week be issued? — was a small panel in the corner, and the checks
 * were invisible unless one failed, so the screen could not be described by
 * anyone who used it.
 *
 * Everything that is a READING rather than a CHECK moved to step ③ with the
 * report it belongs to (`WeekAnalysis`). What is left is the verdict and the
 * list of what was examined.
 *
 * The sign-off panel was taken off this screen too. Only the SCREEN — the
 * approval record itself is untouched: `applyApproval`, `approveWeekAction` and
 * `db.approvals` all still work, existing approvals are still stored, and the
 * Portfolio still reads `approvedThroughWeek` from them. Putting the panel back
 * is re-adding `<ApprovalPanel>` here and nothing else.
 */
/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function CheckPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <LegacyGate what="weekly reports" planned>
      <CheckPageBody params={params} />
    </LegacyGate>
  );
}

async function CheckPageBody({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);

  const db = await getOpenDb();
  // computeHealth still gates the 404 — it returns null for a week that does
  // not exist, which is the cheapest way to reject a bad :week param.
  const health = computeHealth(db, week);
  if (!health) notFound();
  const validation = validateWeek(db, week);

  // How much of this week's standing figures were typed by hand rather than
  // counted, over the same leaf set `validateWeek` reports "Weights total...
  // All N leaf items add up" against (weighted leaves, promoted the same
  // way) so this number never disagrees with the checklist beside it.
  // `WeekChecks` gets only the count: it cannot see leaf snapshots itself.
  const weekMeta = db.weeks.find((w) => w.week === week);
  const roots = promoteNestedSpkContracts(
    computeRollup(db.wbsItems, weekMeta?.leafData ?? {}, null)
  );
  const leaves = flattenTree(roots).filter((n) => n.isLeaf && n.bobot > 0);
  const handTyped = {
    total: leaves.length,
    count: weekMeta
      ? leaves.filter((n) => weekMeta.leafData[n.id]?.source === 'manual').length
      : 0,
  };

  return (
    <RouteTransition id="weekly-control">
      <div className="space-y-4 px-3 py-4 sm:p-6 lg:p-8 print:hidden">
        <PageHeader
          section="Data Overall"
          title="Check the figures"
          className="mb-0 animate-enter"
        >
          <span className="font-medium text-foreground">Week {week}</span> · Nothing to fill in
          here. The app goes through what you entered and says what is wrong with it, before the
          report is printed.
        </PageHeader>

        <div className="animate-enter stagger-1">
          <WeekChecks week={week} validation={validation} handTyped={handTyped} />
        </div>
      </div>
    </RouteTransition>
  );
}
