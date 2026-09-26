import { notFound } from 'next/navigation';
import { computeHealth, validateWeek } from '@/lib/analysis';
import { computeRollup, flattenTree, promoteNestedSpkContracts } from '@/lib/rollup';
import { getOpenDb } from '@/lib/data';
import WeekChecks from '@/components/weekly/WeekChecks';
import { RouteTransition } from '@/components/motion/RouteTransition';
import LegacyGate from '@/components/projects/LegacyGate';
import PageHeader from '@/components/layout/PageHeader';
import SectionSwitch from '@/components/weekly/SectionSwitch';
import { weekPeriodShort } from '@/lib/weeks';

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
 * The sign-off panel was taken off this screen too, and on 26 Sep 2026 its code
 * went with the imported project it wrote for: `ApprovalPanel`,
 * `approveWeekAction` and `applyApproval` all edited db.json, which no project
 * keeps its weekly figures in any more. Signed weeks on the project database
 * are read by `signedWeeksSqlite`; a sign-off screen for them is new work.
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
        {/* Here for the Report button more than for the title: Fill in and
            Weights carry the way to the report beside their headers, and a
            door that is missing on one of three screens reads as broken. */}
        <PageHeader
          section="Data Overall"
          title="Check"
          className="mb-4 animate-enter"
          action={<SectionSwitch week={week} to="report" />}
        >
          <span className="font-semibold text-foreground">
            Week {week} · {weekPeriodShort(db.project.weekAnchorEndDate, week)}
          </span>
        </PageHeader>
        <div className="animate-enter">
          <WeekChecks week={week} validation={validation} handTyped={handTyped} />
        </div>
      </div>
    </RouteTransition>
  );
}
