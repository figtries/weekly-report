import { notFound } from 'next/navigation';
import { getOpenWeekRollup, getOpenDb } from '@/lib/data';
import { weekPeriodShort } from '@/lib/weeks';
import { buildWorklist } from '@/lib/worklist';
import OverallMap from '@/components/weekly/OverallMap';
import { buildOverallMap, type RowFact } from '@/lib/overall-map';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import PageHeader from '@/components/layout/PageHeader';
import SectionSwitch from '@/components/weekly/SectionSwitch';
import { Reveal } from '@/components/motion/Reveal';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { Card, CardContent } from '@/components/ui/card';
import { MOTION, TYPE } from '@/lib/design';
import { cn } from '@/lib/utils';
import LegacyGate from '@/components/projects/LegacyGate';
import SetupGuideCard from '@/components/weekly/SetupGuideCard';
import { getOpenProject } from '@/lib/legacy-bridge';
import { loadWeightsScreen } from '@/lib/weights-screen';
import { formatMoney } from '@/lib/currency';
import { blockingIds, validateWeek } from '@/lib/analysis';

export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts); this validation
  // refuses any read it has not been told about. A null value samples the
  // visitor who has never chosen a project.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
  unstable_disableValidation: true,
};

type PageProps = {
  params: Promise<{ week: string }>;
  // `?lens=manual` arrives from the Check screen's "N of M figures were typed
  // by hand" line — see WeekChecks.tsx. Reading it here rather than adding a
  // second uncached read: `DataOverallPageBody` sits inside `LegacyGate`'s own
  // `<Suspense>` already (for `connection()`), which is what a dynamic read
  // needs under cacheComponents — and `unstable_disableValidation` above is
  // what keeps a new searchParam from failing the build the way `?only=` did
  // under this same `/weekly/[week]` layout (see app/print/weekly/[week]).
  //
  // `?item=` and `?lens=blocking` arrive the same way, from the Check screen's
  // item rows and its "Back to Fill in" button.
  searchParams: Promise<{ lens?: string; item?: string }>;
};

/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function DataOverallPage({ params, searchParams }: PageProps) {
  return (
    <LegacyGate what="weekly reports" planned>
      <DataOverallPageBody params={params} searchParams={searchParams} />
    </LegacyGate>
  );
}

async function DataOverallPageBody({ params, searchParams }: PageProps) {
  const [{ week: weekParam }, { lens, item }] = await Promise.all([params, searchParams]);
  const week = Number(weekParam);
  const [db, result] = await Promise.all([getOpenDb(), getOpenWeekRollup(week)]);
  if (!result) notFound();

  // The items that stop this week, asked of the same `validateWeek` the Check
  // screen shows, so "Back to Fill in" opens exactly the rows listed there.
  // With none behind it (every failure is a total, not an item) the lens has
  // nothing to show, so it falls back to the whole map.
  const blocking = lens === 'blocking' ? blockingIds(validateWeek(db, week)) : [];
  const initialLens =
    lens === 'manual'
      ? ('manual' as const)
      : blocking.length > 0
        ? ('blocking' as const)
        : null;
  const initialItem = item ?? blocking[0] ?? null;
  const { roots, grandTotal } = result;
  const period = weekPeriodShort(db.project.weekAnchorEndDate, week);

  // What this week actually asks of whoever is filling it in. Built here rather
  // than in the client so the queue is part of the prerendered page — the first
  // thing on screen should be the work, not a spinner deciding what the work is.
  //
  // It is no longer a LIST on this screen. The map comes first and this is the
  // lens over it, which is what the 13 Sep 2026 brief asked for after two cuts
  // that led with a queue were rejected.
  const worklist = buildWorklist({
    roots,
    schedule: db.schedule,
    week,
    changeLog: db.changeLog,
    weightsLocked: db.project.weightsLocked,
  });

  // The one thing still missing, if anything is. One card, in dependency
  // order, and it collapses to nothing once the project is set up: a banner
  // that is always there is furniture, and furniture is what people learn to
  // stop seeing.
  //
  // "Not weighted from prices" needs BOTH conditions. `basis !== 'boq'` alone
  // would show the card forever on a project whose prices genuinely never
  // cover the whole plan, and a card that cannot be dismissed is worse than no
  // card. `wouldChange > 0` is what lets it finish.
  const open = await getOpenProject();
  const wscreen = open && !open.legacyJsonId ? loadWeightsScreen(open.id) : null;
  const estimated = wscreen
    ? [...wscreen.units.flatMap((u) => u.rows), ...wscreen.looseRows].filter(
        (r) => r.isLeaf && r.estimated
      ).length
    : 0;
  const money = wscreen?.summary;

  // Price and dates for the panel. They live in SQLite and have no equivalent
  // on the db.json side, so the imported project simply gets a panel with two
  // read-only sections rather than a screen that pretends to offer them.
  const facts: Record<string, RowFact> = {};
  if (wscreen) {
    [...wscreen.units.flatMap((u) => u.rows), ...wscreen.looseRows].forEach((r) => {
      facts[r.id] = { price: r.price, start: r.start, finish: r.finish };
    });
  }

  const map = buildOverallMap({
    roots,
    snapshots: result.meta.leafData,
    worklist,
    schedule: db.schedule,
    changeLog: db.changeLog,
    facts,
    weightsLocked: db.project.weightsLocked,
  });

  // WHICH TOTAL GOVERNS. A locked project reports on its STORED weights and
  // the prices no longer move them; everything else reports on whatever the
  // prices derive. Gundih stores 100.000000 and derives 154.58, so asking the
  // wrong one would put a red card on the one project in the database whose
  // weights are correct.
  const governing = wscreen?.locked ? money?.storedTotal : money?.derivedTotal;
  const weightsOff = governing != null && Math.abs(governing - 100) > 0.5;

  const guide =
    !money || !open
      ? null
      : money.leaves === 0
        ? {
            title: 'Lay out the work first',
            body: 'This project has no activities yet, so there is nothing to weigh or report on.',
            cta: 'Open the planner',
            href: `/projects/${open.id}`,
          }
        : weightsOff
          ? {
              // The weights are the one figure here that is not negotiable:
              // every percentage in every report is measured against this
              // total, so a plan that does not close at 100 is reporting
              // against the wrong denominator everywhere at once. Said here
              // as well as on Weights because this is the screen people
              // actually open.
              title: `The weights add up to ${governing!.toFixed(2)}%, not 100%`,
              body:
                money.overrun.branches > 0
                  ? `${money.overrun.branches} headings hand out more than they hold, ${formatMoney(money.overrun.amount, money.currency)} over between them. Every figure above is measured against that total.`
                  : `The prices cover ${formatMoney(money.allocated, money.currency)} of a ${formatMoney(money.contractValue, money.currency)} contract and nothing is left to take the rest. Every figure above is measured against that total.`,
              cta: 'Check the prices',
              href: `/weekly/${week}/weights`,
              tone: 'warn' as const,
            }
          : money.basis !== 'boq' && money.wouldChange > 0
            ? {
                title: `${money.leaves} activities are not weighted from prices yet`,
                body: 'Every activity counts the same until prices say otherwise, so the report cannot tell big work from small.',
                cta: 'Set prices',
                href: `/weekly/${week}/weights`,
              }
            : estimated > 0
              ? {
                  title: `${estimated} activities are still measured by a typed percent`,
                  body: 'Say how each one is counted and the weekly figure comes from evidence instead of a guess.',
                  cta: 'Set how they are counted',
                  href: `/weekly/${week}/weights`,
                }
              : null;

  // Four figures on one calm ground, not four tinted cards — the backgrounds
  // stay white; only the numerals carry colour.
  //
  // A fixed colour per figure, so the four are told apart at a glance rather
  // than read one by one. Plan and Actual take the chart tokens they are named
  // after — `--chart-2` IS "plan, red" and `--chart-1` IS "actual, blue" — so
  // this row and the S-Curve teach the same two colours instead of two
  // different ones.
  //
  // Deviation is YELLOW ALWAYS (`--deviation`), which means it no longer turns
  // green when the project is ahead. The verdict has not been dropped, it has
  // moved into the word underneath: colour here identifies which figure you are
  // looking at, and the line below says how to feel about it.
  const stats = [
    { label: 'Plan', value: grandTotal.targetWF, tone: 'text-chart-2', sub: undefined as string | undefined },
    { label: 'Actual', value: grandTotal.curProgressPct, tone: 'text-chart-1', sub: undefined },
    { label: 'Added this week', value: grandTotal.thisWeekProgressPct, tone: 'text-ok', sub: undefined },
    {
      label: 'Deviation',
      value: grandTotal.variance,
      tone: 'text-deviation',
      // One word, not a sentence: the figure above already says how much, and
      // the sign is the one thing about it a newcomer reads wrong.
      sub: grandTotal.variance < 0 ? 'behind plan' : grandTotal.variance > 0 ? 'ahead of plan' : 'on plan',
    },
  ];

  return (
    <RouteTransition id="weekly-overall">
    {/* One order on every width: the four figures, then the work. They were
       briefly flipped on phones to get the first queue card above the fold, but
       cutting the header down to its dates bought back most of that height, and
       a summary you have to scroll DOWN to stops being a summary. */}
    <div className="flex flex-col gap-4 px-3 py-4 sm:p-6 lg:p-8">
      <PageHeader
        section="Data Overall"
        title="Update progress"
        className="mb-0 animate-enter"
        action={<SectionSwitch week={week} to="report" />}
      >
        {/* The dates and nothing else. The sentence that used to follow them
            explained how the screen works, which is a thing you read once and
            then scroll past every week — while the dates are what someone
            actually checks before typing a number into the wrong week. Bold,
            because at this size the muted body colour made the one piece of
            information here look like a caption. */}
        <span className="font-semibold text-foreground">
          Week {week} · {period}
        </span>
      </PageHeader>

      {guide && (
        <Reveal delay={MOTION.stagger}>
          <SetupGuideCard {...guide} />
        </Reveal>
      )}

      <Reveal delay={MOTION.stagger * (guide ? 2 : 1)}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} size="sm" className="h-full gap-2">
              <CardContent>
                <p className={TYPE.statLabel}>{s.label}</p>
                <p
                  className={cn(
                    'mt-1.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl',
                    s.tone
                  )}
                >
                  <AnimatedNumber value={s.value} suffix="%" />
                </p>
                {s.sub && <p className="mt-0.5 text-xs text-muted-foreground">{s.sub}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </Reveal>

      {/* The project itself. Everything about one activity — its figure, how it
          is counted, what it is worth, when it runs — is one press away inside
          it, which is what took Weights off the menu as a screen people had
          to know about. */}
      <Reveal delay={MOTION.stagger * (guide ? 3 : 2)}>
        <OverallMap
          map={map}
          week={week}
          projectId={open?.id ?? null}
          canPrice={!!open && !open.legacyJsonId}
          projectHref={open && !open.legacyJsonId ? `/projects/${open.id}` : null}
          initialLens={initialLens}
          blockingIds={blocking}
          initialItem={initialItem}
        />
      </Reveal>
    </div>
    </RouteTransition>
  );
}
