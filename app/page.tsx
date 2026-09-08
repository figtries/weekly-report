import { RouteTransition } from '@/components/motion/RouteTransition';
import { ScrollReveal } from '@/components/motion/ScrollReveal';
import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import { Suspense } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ChartLine,
  CircleAlert,
  FolderKanban,
  Scale,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

import {
  buildLookAhead,
  computeHealth,
  findLaggards,
  fmtNum,
  fmtPct,
  validateWeek,
} from '@/lib/analysis';
import { formatMoneyShort } from '@/lib/currency';
import { flattenTree, getSummaryRows, promoteNestedSpkContracts } from '@/lib/rollup';
import { getWeekRollup } from '@/lib/data';
import { buildProjectDashboardData } from '@/lib/dashboard-db';
import { getActiveProjectId } from '@/lib/projects';
import { buildSCurveSeries } from '@/lib/scurve';
import ProgressCurve from '@/components/dashboard/ProgressCurve';
import {
  DragList,
  MeasureLegend,
  ProgressSpread,
  UnitBreakdown,
  VelocityBars,
  type LeafSpread,
} from '@/components/dashboard/charts';
import WeekSelect from '@/components/weekly/WeekSelect';
import { Reveal } from '@/components/motion/Reveal';
import { CountUp } from '@/components/motion/CountUp';
import { TYPE, verdictChip, verdictOf, verdictText } from '@/lib/design';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Dashboard' };

/**
 * The dashboard is the product's main advantage, so it does not stop at the
 * number — it states the cause, and it shows it.
 *
 * IT ANSWERS FOR THE PROJECT THAT IS OPEN, AND FOR THE WEEK YOU PICK. It used
 * to read `db.json`, which holds exactly one project, so opening any other left
 * this page drawing Gundih under a sidebar naming something else — and it was
 * pinned to the latest week with no way to look at any other. Both come from
 * `lib/dashboard-db.ts` now: SQLite, per project, per week.
 *
 * THE WEEK LIVES IN THE QUERY, AND THAT IS WHAT KEEPS THIS PAGE HONEST. Reading
 * `searchParams` is an uncached read, so the body sits behind `<Suspense>` and
 * is rendered per request rather than baked into the prerendered shell — which
 * is exactly the bug that let a stale shell name one project while the projects
 * page named another.
 *
 * FOUR RULES HOLD THE LAYOUT TOGETHER.
 *
 * It reads in three tiers, and the tiers are what make it understandable: WHERE
 * WE ARE (the hero, which owns actual, plan, deviation and SPI and is the only
 * place they appear), WHY (the sentence and the three items dragging the number
 * down, given real room rather than buried in the seventh card), and THE
 * EVIDENCE (a uniform wide-then-narrow grid nobody has to rank by eye). Before
 * this, ten cards of equal weight sat in four different grid splits and the eye
 * was told nothing about where to go after the hero.
 *
 * Colour and type come from `lib/design.ts` and nothing here invents either.
 * Measurement is `--chart-1` actual / `--chart-2` plan on every line and bar;
 * verdict is `--ok` / `--bad` and lands only on figures, chips and words —
 * including the headline percentage itself, which turns red the week the
 * project falls behind its plan.
 *
 * Motion comes from framer-motion through `Reveal`, one curve and one duration
 * for the whole app. Every chart is hand-drawn SVG rather than Recharts: they
 * are all static, so drawing them by hand keeps them out of the hydration path.
 *
 * EVERY CARD IN A ROW IS THE SAME HEIGHT. `items-start` used to let the short
 * card in each pair stop early, which left a white hole the height of a hand
 * beside "Work spread" and again beside "Forecast".
 */
export default function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  return (
    <RouteTransition id="dashboard">
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardBody searchParams={searchParams} />
      </Suspense>
    </RouteTransition>
  );
}

async function DashboardBody({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week: weekParam } = await searchParams;

  const projectId = await getActiveProjectId();
  const data = projectId ? buildProjectDashboardData(projectId) : null;

  if (!data) {
    return (
      <Empty
        icon={FolderKanban}
        title="No project open"
        body="Make one, or open one you already keep — every number on this page belongs to a project."
        href="/projects"
        cta="Go to Projects"
      />
    );
  }

  // A project with rows but no weight cannot be measured, and a bar chart of
  // zeroes would say the work has not started rather than that nobody has
  // priced it. Weight is derived from the BOQ; the planner is where that lives.
  if (!data.hasPlan) {
    return (
      <Empty
        icon={Scale}
        title={`"${data.db.project.name}" has no weights yet`}
        body="Weight comes from the priced BOQ, and the plan curve from each item's dates. Fill those in and this page fills itself in."
        href={`/projects/${projectId}`}
        cta="Open the planner"
      />
    );
  }

  // The week being viewed: whatever was asked for if the project has it,
  // otherwise the last week anybody reported — never a week off the calendar.
  const asked = Number(weekParam);
  const fallback = data.currentWeek || data.weeks[0];
  const week = data.weeks.includes(asked) ? asked : fallback;

  const db = data.db;
  const rollup = getWeekRollup(db, week);
  const health = computeHealth(db, week);

  if (!rollup || !health) {
    return (
      <Empty
        icon={ChartLine}
        title="No progress data yet"
        body="Build the WBS and its weights first — every number on this page fills itself in after that."
        href={`/projects/${projectId}`}
        cta="Open the planner"
      />
    );
  }

  const laggards = findLaggards(rollup.roots, health.contractValue);
  const validation = validateWeek(db, week);
  const lookAhead = buildLookAhead(db, health);
  // The list below shows the three costliest; this is what all of them cost
  // together, which is the one figure the list itself cannot state.
  const totalDrag = Math.abs(laggards.reduce((sum, l) => sum + l.varianceWF, 0));
  const curve = buildSCurveSeries(db, week);
  const units = getSummaryRows(promoteNestedSpkContracts(rollup.roots));

  // By weight, not by count: a 3.3% leaf and a 0.03% leaf are not equals.
  const spread: LeafSpread = flattenTree(rollup.roots)
    .filter((n) => n.isLeaf && n.bobot > 0)
    .reduce<LeafSpread>(
      (acc, n) => {
        const bucket =
          n.curProgressPct >= 99.995 ? 'done' : n.curProgressPct > 0 ? 'running' : 'notStarted';
        acc[bucket] += 1;
        acc[`${bucket}Weight` as const] += n.bobot;
        return acc;
      },
      { notStarted: 0, running: 0, done: 0, notStartedWeight: 0, runningWeight: 0, doneWeight: 0 }
    );

  const verdict = verdictOf(health.deviationPct);
  const behind = verdict === 'behind';
  const urgent = validation.findings.filter((f) => f.level !== 'ok');
  const errors = urgent.filter((f) => f.level === 'error');
  const weeksLeft = Math.max(0, health.lastWeek - health.week);
  const curveWeeks = curve.map((r) => r.week);
  const firstWeek = curveWeeks.length ? Math.min(...curveWeeks) : health.week;
  const unreported = data.currentWeek > 0 && week > data.currentWeek;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-3 py-5 sm:p-6 lg:p-8">
      {/* Whose numbers these are, and which week of them. The name is here
          rather than only in the sidebar because this page is what somebody
          screenshots into a chat — and a percentage with no project on it is
          the same trap the sidebar mismatch was. */}
      {/* `flex-1` with a floor on the name, so the picker rides on the same
          line as the title on a desktop and drops below it on a phone rather
          than squeezing a 100-character project name into a third of the row. */}
      <header className="animate-enter flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-64 flex-1">
          <h1 className="line-clamp-2 text-xl font-semibold tracking-tight sm:text-2xl">
            {db.project.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {db.project.customer || 'No customer set'}
            {data.currentWeek > 0 ? ` · reported up to week ${data.currentWeek}` : ' · nothing reported yet'}
          </p>
        </div>
        <WeekSelect
          weeks={data.weeks}
          selectedWeek={week}
          projectCurrentWeek={data.currentWeek}
          activeTab=""
          hrefPattern="/?week={week}"
          prefetch={false}
        />
      </header>

      {unreported && (
        <p className="animate-fade-in-up rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
          Nothing has been reported after week {data.currentWeek}. The actual figures below are
          carried forward; the plan keeps climbing, so the gap you see is the weeks nobody has filed.
        </p>
      )}

      {/* ------------------------------------------------ tier 1 · where we are */}
      <Reveal>
        {/* py-0 because the curve runs to the card's own edges — shadcn's Card
            carries py-(--card-spacing) of its own, which would leave a white
            strip under a full-bleed child. Two columns on desktop so the figures
            and the curve each fill a side; stacked on a phone. */}
        <Card className="py-0">
          <div className="grid lg:grid-cols-[24rem_1fr]">
            <div className="p-5 sm:p-8 lg:border-r">
              <p className="text-sm font-medium text-muted-foreground">
                Week {health.week} of {health.lastWeek}
              </p>
              <p className={cn('mt-1.5', TYPE.hero, verdictText[verdict])}>
                <CountUp value={health.actualPct} />
              </p>
              <p className="mt-2.5 text-sm text-muted-foreground">Project completed to date</p>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <Badge
                  variant="secondary"
                  className={cn(
                    'gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold',
                    verdictChip[verdict]
                  )}
                >
                  {behind ? (
                    <TrendingDown className="h-4 w-4" />
                  ) : (
                    <TrendingUp className="h-4 w-4" />
                  )}
                  {fmtPct(Math.abs(health.deviationPct))} {behind ? 'behind' : 'ahead of'} schedule
                </Badge>
                {health.scheduleVarianceRp !== null && Math.abs(health.scheduleVarianceRp) > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {/* In the project's OWN currency. `formatRupiah` stamped
                        "Rp" on everything, which on a contract priced in
                        dollars is not a rounding error, it is a wrong number. */}
                    ≈ {formatMoneyShort(Math.abs(health.scheduleVarianceRp), data.currency)}{' '}
                    {behind ? 'undelivered' : 'delivered early'}
                  </p>
                )}
              </div>

              {/* The rail carries the three figures that qualify the headline,
                  each said exactly once on this page. */}
              <dl className="mt-6 grid grid-cols-3 divide-x rounded-xl border bg-muted/40">
                <Stat label="Plan this week" value={fmtPct(health.planPct)} />
                <Stat label="Schedule index" value={fmtNum(health.spi, 3)} />
                <Stat label="Weeks left" value={fmtNum(weeksLeft)} />
              </dl>
            </div>

            {/* The legend and the week ticks are HTML over the plot, never SVG
                <text>: the viewBox is stretched to fit, and it stretches its
                own type with it — at 390px an SVG label came out five pixels
                tall. On a phone the curve is 160px and its leading end reaches
                exactly where an absolute legend would sit, so the legend only
                floats on desktop. */}
            <div className="relative flex min-h-44 flex-col justify-end text-foreground sm:min-h-56">
              {/* TOP-LEFT on desktop, where the plot is empty because the curve
                  starts low. It floated top-RIGHT until the endpoint chips
                  moved in there — "Plan 71.93%" sat straight on top of it and
                  clipped the word "Actual" in half. On a phone the legend is
                  still in flow above the chart and never overlapped anything,
                  so only the floating case moves. */}
              <MeasureLegend className="justify-end px-5 pb-2 lg:absolute lg:left-8 lg:top-6 lg:justify-start lg:px-0 lg:pb-0" />
              <ProgressCurve rows={curve} className="block h-40 w-full sm:h-56 lg:h-full" />
              <div
                className={cn(
                  'pointer-events-none absolute inset-x-0 bottom-0 flex justify-between px-5 pb-2 lg:px-8 lg:pb-3',
                  TYPE.meta
                )}
              >
                {/* On its own tinted ground: the curve is flat at the left of a
                    60-week project and runs straight through a bare label. */}
                <span className="rounded bg-card/85 px-1">Week {firstWeek}</span>
                <span className="rounded bg-card/85 px-1">Week {health.week}</span>
              </div>
            </div>
          </div>
        </Card>
      </Reveal>

      {/* ------------------------------------------------------- tier 2 · why */}
      <Reveal delay={0.06}>
        <Card>
          <CardHeader>
            <CardTitle className={TYPE.cardTitle}>Why the project sits here</CardTitle>
            <CardDescription className={TYPE.cardDesc}>
              The items holding the number back, by how much project percent each one costs
            </CardDescription>
            <CardAction>
              <Link
                href={`/weekly/${week}/detail`}
                className="inline-flex items-center gap-1 text-sm font-medium text-chart-1 hover:underline"
              >
                All items <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-4">
            {laggards.length > 0 && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                The {fmtNum(laggards.length)} biggest laggards hold back{' '}
                <span className="font-semibold text-bad">{fmtPct(totalDrag)}</span> of project
                progress between them. The three that cost the most:
              </p>
            )}
            <DragList rows={laggards} limit={3} />
          </CardContent>
        </Card>
      </Reveal>

      {/* -------------------------------------------------- tier 3 · evidence */}
      <ScrollReveal>
        <div className="grid gap-4 lg:grid-cols-3">
          {units.length > 1 && (
            <Card className="h-full lg:col-span-2">
              <CardHeader>
                <CardTitle className={TYPE.cardTitle}>By contract</CardTitle>
                <CardDescription className={TYPE.cardDesc}>
                  Where the overall percentage comes from
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UnitBreakdown rows={units} />
              </CardContent>
            </Card>
          )}

          <Card className={cn('h-full', units.length > 1 ? '' : 'lg:col-span-2')}>
            <CardHeader>
              <CardTitle className={TYPE.cardTitle}>Work spread</CardTitle>
              <CardDescription className={TYPE.cardDesc}>
                How much of the project has been started
              </CardDescription>
            </CardHeader>
            {/* The bar and its key sit at the top; the rest of the height is
                given to the legend rows so the card fills its row instead of
                stopping halfway down beside a taller neighbour. */}
            <CardContent className="flex flex-1 flex-col">
              <ProgressSpread spread={spread} />
            </CardContent>
          </Card>
        </div>
      </ScrollReveal>

      <ScrollReveal>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="h-full lg:col-span-2">
            <CardHeader>
              <CardTitle className={TYPE.cardTitle}>Added each week</CardTitle>
              <CardDescription className={TYPE.cardDesc}>
                Whether the pace is steady or lurching
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              <VelocityBars rows={curve} />
              <p className="mt-auto border-t pt-3 text-sm text-muted-foreground">
                Running at{' '}
                <span className="font-semibold text-foreground">
                  {fmtPct(health.velocityPerWeek)}
                </span>{' '}
                per week; the plan demands{' '}
                <span className="font-semibold text-foreground">
                  {fmtPct(health.requiredVelocity)}
                </span>
                .
              </p>
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader>
              <CardTitle className={TYPE.cardTitle}>Forecast</CardTitle>
              <CardDescription className={TYPE.cardDesc}>
                When this finishes at the current pace
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              {health.forecastFinishWeek === null ? (
                <p className="text-sm text-muted-foreground">Not enough to forecast yet.</p>
              ) : (
                <>
                  <p
                    className={cn(
                      'text-3xl font-semibold tabular-nums',
                      health.weeksAgainstContract === null
                        ? ''
                        : verdictText[verdictOf(health.weeksAgainstContract, 0)]
                    )}
                  >
                    Week {Math.round(health.forecastFinishWeek)}
                  </p>
                  {health.weeksAgainstContract !== null && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        'mt-2 w-fit',
                        verdictChip[verdictOf(health.weeksAgainstContract, 0)]
                      )}
                    >
                      {Math.abs(Math.round(health.weeksAgainstContract))} weeks{' '}
                      {health.weeksAgainstContract >= 0 ? 'earlier' : 'later'}
                    </Badge>
                  )}
                  {/* Pinned to the bottom: the card is stretched to its
                      neighbour's height, and this is the line that closes it. */}
                  <p className="mt-auto pt-4 text-xs text-muted-foreground">
                    Contract ends in week {health.lastWeek}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollReveal>

      <ScrollReveal>
        <div className="grid gap-4 lg:grid-cols-3">
          {/* The wide half of every row is the one carrying more to read. A
              two-week look-ahead in a two-column card left a hole the height of
              the findings beside it; the findings are what fill a wide card. */}
          {/* CardAction, not a flex-row override: shadcn's CardHeader is a grid
              that only splits into two columns when a card-action slot is present. */}
          <Card className={cn('h-full lg:col-span-2', errors.length > 0 && 'ring-destructive/30')}>
            <CardHeader>
              <CardTitle className={TYPE.cardTitle}>What is urgent</CardTitle>
              <CardDescription className={TYPE.cardDesc}>
                What stands between this week and issuing it
              </CardDescription>
              {urgent.length > 0 && (
                <CardAction className={TYPE.meta}>{urgent.length} findings</CardAction>
              )}
            </CardHeader>
            <CardContent className="flex flex-1 flex-col">
              {urgent.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing found. This week is safe to issue.
                </p>
              ) : (
                <ul className="grid gap-2.5 sm:grid-cols-2 sm:gap-x-6">
                  {urgent.slice(0, 4).map((f, i) => (
                    <li key={i} className="flex gap-2.5">
                      {f.level === 'error' ? (
                        <CircleAlert className="mt-[3px] h-4 w-4 shrink-0 text-bad" />
                      ) : (
                        <AlertTriangle className="mt-[3px] h-4 w-4 shrink-0 text-warn" />
                      )}
                      <p className="text-sm font-medium leading-snug">{f.title}</p>
                    </li>
                  ))}
                </ul>
              )}
              {urgent.length > 4 && (
                <p className="mt-2.5 text-sm text-muted-foreground">
                  {urgent.length - 4} more {urgent.length - 4 === 1 ? 'finding' : 'findings'}
                </p>
              )}

              {!validation.canIssue && (
                <div className="mt-auto pt-4">
                  <Link
                    href={`/weekly/${week}/control`}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-bad-soft px-3 text-sm font-semibold text-bad transition-all duration-300 ease-ios hover:brightness-95 active:scale-[0.99]"
                  >
                    Not ready to issue
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader>
              <CardTitle className={TYPE.cardTitle}>What has to happen next</CardTitle>
              <CardDescription className={TYPE.cardDesc}>
                What the coming weeks demand, against today&apos;s pace
              </CardDescription>
              <CardAction>
                <Link
                  href={`/weekly/${week}/overall`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-chart-1 hover:underline"
                >
                  Update <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-center">
              {lookAhead.length === 0 ? (
                <p className="text-sm text-muted-foreground">No week after this one.</p>
              ) : (
                <ul className="divide-y">
                  {lookAhead.map((w) => (
                    <li key={w.week} className="py-3 text-sm first:pt-0 last:pb-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-muted-foreground">Week {w.week}</span>
                        <span className="font-semibold tabular-nums">+{fmtPct(w.gapFromNow)}</span>
                      </div>
                      {w.paceMultiple !== null && (
                        <p
                          className={cn(
                            'mt-0.5 text-xs',
                            w.paceMultiple > 1.5 ? 'font-medium text-warn' : 'text-muted-foreground'
                          )}
                        >
                          {fmtNum(w.paceMultiple, 1)}× the current pace
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollReveal>
    </div>
  );
}

/** One cell of the hero's rail. Label above, figure below, divider between. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    // The rail is three fixed 1fr columns, so a figure that outgrows its
    // track spills over the divider into the next one. At 390 (the width this
    // card is designed at) it fits; at 360 '71.93%' ran 8px past. Both tweaks
    // are scoped BELOW 380px so the hero keeps its frozen proportions on every
    // phone that can afford them.
    <div className="flex flex-col justify-between px-3 py-3 first:pl-4 last:pr-4 max-[380px]:px-2">
      <dt className={TYPE.statLabel}>{label}</dt>
      <dd className={cn('mt-1 max-[380px]:text-lg', TYPE.figure)}>{value}</dd>
    </div>
  );
}

/**
 * Nothing to draw, and a way forward — never a chart of zeroes.
 *
 * The card, its size and its position are `EmptyState`, the same one Weekly,
 * Daily, Reports and Klaim use. This used to be a 2xl headline pinned near the
 * top of the page instead, which meant a project with no plan was told so in
 * one shape on the dashboard and another the moment it moved one tab across.
 */
function Empty({
  icon,
  title,
  body,
  href,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  cta: string;
}) {
  return (
    <EmptyState icon={icon} title={title} body={body} primary={{ href, label: cta }} />
  );
}


/**
 * What the shell paints while the request-time render arrives. It mirrors the
 * hero and the first two cards rather than showing a spinner, so the page does
 * not jump height when the real thing lands.
 */
function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-3 py-5 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-md space-y-2">
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-11 w-28 rounded-lg" />
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-52 w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-56 w-full rounded-xl lg:col-span-2" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}
