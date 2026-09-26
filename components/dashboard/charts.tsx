import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import CodeChip, { splitCode } from '@/components/ui/CodeChip';
import PlanActualBar from '@/components/ui/PlanActualBar';
import { fmtNum, fmtPct } from '@/lib/analysis';
import { apportion } from '@/lib/figures';
import { TYPE, signed, verdictChip, verdictOf, type Verdict } from '@/lib/design';
import type { Contribution, Mover } from '@/lib/analysis';
import type { SummaryRow } from '@/lib/rollup';
import type { SCurveRow } from '@/lib/scurve';

/**
 * The dashboard's visuals, all server-rendered SVG and divs.
 *
 * Recharts is in the dependency list, but every chart here is static — no
 * tooltip, no zoom, no client state. Drawing them by hand keeps them in the
 * prerendered shell, so they are on screen in the first paint instead of after
 * hydration, which is what the field crew's connection actually feels.
 *
 * Colour comes from `lib/design.ts` and its two jobs never mix: measurement is
 * `--chart-1` for actual and `--chart-2` for plan, always; verdict is `--ok` /
 * `--bad` and only ever lands on a number, a chip or a word.
 *
 * EVERY ROW IN THIS FILE IS BUILT ON ONE GRID so the columns line up down the
 * whole page: name on the left, verdict figure right-aligned in a fixed 5.5rem
 * column, and the bar's own readout in a fixed column of its own. Before this,
 * each list right-aligned its own text and no two cards agreed on a margin.
 */

/** The width every verdict figure is right-aligned inside. */
const FIGURE_COL = 'w-[5.5rem] shrink-0 text-right tabular-nums';

/** The meaning of blue and red, stated once wherever a chart needs it. */
export function MeasureLegend({ className }: { className?: string }) {
  return (
    <p className={cn('flex items-center gap-3 text-xs text-muted-foreground', className)}>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-[3px] w-4 rounded-full bg-chart-1" />
        Actual
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-4 border-t-2 border-dashed border-chart-2" />
        Plan
      </span>
    </p>
  );
}

/**
 * The caption under every actual-over-plan bar: the two numbers the two bars
 * draw, each in its bar's colour, so which bar is which never has to be guessed.
 */
function MeasureCaption({ actual, plan, right }: { actual: number; plan: number; right?: string }) {
  return (
    <p className={cn('mt-1.5 flex items-baseline justify-between gap-3 whitespace-nowrap', TYPE.meta)}>
      <span>
        <span className="font-medium text-blue-600">{fmtPct(actual)} done</span>
        {' · '}
        <span className="font-medium text-red-600">plan {fmtPct(plan)}</span>
      </span>
      {right && <span>{right}</span>}
    </p>
  );
}

/* ---------------------------------------------------------------- per unit */

/**
 * One row per contract or section, actual against plan.
 *
 * This is the chart that answers "which contract is dragging" — the question
 * the overall percentage cannot answer.
 *
 * EVERY FIGURE HERE ADDS UP TO ONE PRINTED ELSEWHERE (26 Sep 2026). The shares
 * add to 100 and the verdict figures add to the deviation in the hero, because
 * both are apportioned (lib/figures.ts) rather than rounded one by one — and
 * both are shares of the TOTAL weight, the same scale as the hero. They used to
 * be raw weight points, which on a 70.79-weight plan summed to 70.79 and 11.40
 * under a hero saying 100 and 16.11. Where the rows do not cover every weighted
 * item (a plan that marked only some units) the parts are left to add up to
 * themselves instead of being forced onto a total they do not explain.
 */
export function UnitBreakdown({
  rows,
  limit,
  totalBobot,
  deviationPct,
}: {
  rows: SummaryRow[];
  limit?: number;
  /** Every weighted leaf's weight, added up. */
  totalBobot: number;
  /** The hero's deviation, as printed. */
  deviationPct: number;
}) {
  if (rows.length < 2 || totalBobot <= 0) return null;
  const covered = Math.abs(rows.reduce((s, r) => s + r.bobot, 0) - totalBobot) < 1e-6;
  const rawShare = rows.map((r) => (r.bobot / totalBobot) * 100);
  const rawDev = rows.map((r) => (r.variance / totalBobot) * 100);
  const shares = apportion(rawShare, covered ? 100 : rawShare.reduce((s, v) => s + v, 0));
  const devs = apportion(rawDev, covered ? deviationPct : rawDev.reduce((s, v) => s + v, 0));
  const shown = (limit ? rows.slice(0, limit) : rows).map((r, i) => ({ r, share: shares[i], dev: devs[i] }));

  return (
    // NO RULES BETWEEN ROWS (26 Sep 2026, variant A of three shown to him):
    // the dividers and the tracks together read as a sheet of lines. Air
    // separates the rows now, the number is a soft round badge, and the
    // verdict sits in a tinted pill.
    <ul className="flex h-full flex-col gap-5">
      {shown.map(({ r, share, dev }) => {
        const actual = r.bobot > 0 ? (r.curWF / r.bobot) * 100 : 0;
        const plan = r.bobot > 0 ? (r.targetWF / r.bobot) * 100 : 0;
        // A finished contract has nothing to be ahead or behind of, and "+0.00%"
        // reads as a measurement rather than as done.
        const done = actual >= 99.995;
        const verdict = done ? 'done' : verdictOf(dev);
        // Strip the "(SPK-###)" tag out of the label and show it as its own
        // chip. A unit or a section carries no tag in its name, so it hands
        // over its WBS code instead.
        const { tag, name } = splitCode(r.deskripsi);
        const chip = tag ?? r.code;

        return (
          <li key={r.id} className="flex flex-1 flex-col justify-center">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                {chip && <RowBadge code={chip} />}
                <p className={cn('truncate', TYPE.row)}>{name}</p>
              </div>
              <VerdictPill verdict={verdict}>
                {done ? 'Done' : dev === 0 ? 'On plan' : signed(dev, fmtNum(dev, 2))}
              </VerdictPill>
            </div>
            <PlanActualBar actual={actual} plan={plan} className="mt-2 w-full flex-none" />
            <MeasureCaption actual={actual} plan={plan} right={`${fmtPct(share)} of the project`} />
          </li>
        );
      })}
    </ul>
  );
}

/** A row's code: a soft round badge when it is short enough to fit one. */
function RowBadge({ code }: { code: string }) {
  if (code.length > 3) return <CodeChip>{code}</CodeChip>;
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
      {code}
    </span>
  );
}

/** A row's verdict figure, on a ground tinted in its own colour. */
function VerdictPill({ verdict, children }: { verdict: Verdict; children: ReactNode }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums whitespace-nowrap',
        verdictChip[verdict],
        verdict === 'neutral' && 'text-foreground'
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------ why it sits */

/**
 * The items that explain the deviation, largest first — both ways.
 *
 * Behind: what holds the number back. Ahead: what carries the lead. It used to
 * list laggards only, so a project with nothing behind printed its one finished
 * item at "−0.00%" (a floating-point crumb) and called it the reason. Figures
 * are shares of the deviation apportioned to add up to it as printed.
 */
export function ContributionList({ rows, limit = 3 }: { rows: Contribution[]; limit?: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Every item is exactly on plan.</p>;
  }

  // Same face as By section: no rules between rows, air instead (26 Sep 2026).
  return (
    <ul className="flex flex-col gap-5">
      {rows.slice(0, limit).map((c) => (
        <li key={c.id}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <RowBadge code={c.wbsCode} />
              <p className={cn('truncate', TYPE.row)}>{c.deskripsi}</p>
            </div>
            <VerdictPill verdict={c.share < 0 ? 'behind' : 'ahead'}>
              {signed(c.share, fmtNum(c.share, 2))}
            </VerdictPill>
          </div>
          <PlanActualBar actual={c.actualPct} plan={c.planPct} className="mt-2 w-full flex-none" />
          <MeasureCaption actual={c.actualPct} plan={c.planPct} />
        </li>
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- velocity */

/**
 * How much was added each week, against how much the plan wanted.
 *
 * A single velocity figure hides whether the crew is steady or lurching, and
 * lurching is the thing that makes a forecast worthless. The plan stands behind
 * in red and the actual in front in blue, so a week that fell short shows as red
 * left uncovered — rather than the bar itself changing colour to announce a
 * verdict, which is what it used to do.
 */
export function VelocityBars({ rows, weeks = 14 }: { rows: SCurveRow[]; weeks?: number }) {
  const usable = rows.filter((r) => r.actualPct !== null);
  if (usable.length < 3) return null;

  const series = usable.slice(-(weeks + 1));
  const bars = series.slice(1).map((r, i) => {
    const prev = series[i];
    return {
      week: r.week,
      actual: Math.max(0, (r.actualPct as number) - (prev.actualPct as number)),
      plan:
        r.planPct !== null && prev.planPct !== null ? Math.max(0, r.planPct - prev.planPct) : null,
    };
  });

  const peak = Math.max(0.1, ...bars.map((b) => Math.max(b.actual, b.plan ?? 0)));

  return (
    <div>
      <div className="flex h-28 items-end gap-[3px]">
        {bars.map((b) => (
          <div key={b.week} className="relative flex h-full flex-1 items-end">
            {b.plan !== null && (
              <div
                className="absolute inset-x-0 bottom-0 rounded-sm bg-chart-2/25"
                style={{ height: `${(b.plan / peak) * 100}%` }}
                aria-hidden
              />
            )}
            <div
              className="relative w-full rounded-sm bg-chart-1"
              style={{ height: `${Math.max(2, (b.actual / peak) * 100)}%` }}
              title={`Week ${b.week}: ${fmtPct(b.actual)}`}
            />
          </div>
        ))}
      </div>
      <div className={cn('mt-2 flex justify-between border-t pt-2', TYPE.meta)}>
        <span>Week {bars[0].week}</span>
        <span>Week {bars[bars.length - 1].week}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ distribution */

export interface LeafSpread {
  notStarted: number;
  running: number;
  done: number;
  notStartedWeight: number;
  runningWeight: number;
  doneWeight: number;
}

/**
 * Where the work sits, by weight rather than by headcount of items.
 *
 * Counting items treats a 3.3% leaf and a 0.03% leaf as equals; weighting says
 * how much of the project is actually stalled. No red anywhere: this is a
 * picture of state, and there is no baseline here to be behind of.
 */
export function ProgressSpread({
  spread,
  arrived,
}: {
  spread: LeafSpread;
  /** How many items entered each state this week. Only arrivals are said. */
  arrived?: { done: number; running: number; notStarted: number };
}) {
  const total = spread.notStartedWeight + spread.runningWeight + spread.doneWeight || 1;
  // Apportioned so the three shares print as exactly 100.00 between them.
  const [doneShare, runningShare, notStartedShare] = apportion(
    [spread.doneWeight, spread.runningWeight, spread.notStartedWeight].map((w) => (w / total) * 100),
    100
  );
  const seg = [
    { key: 'done', label: 'Done', share: doneShare, n: spread.done, cls: 'bg-chart-3', in: arrived?.done ?? 0 },
    {
      key: 'running',
      label: 'Running',
      share: runningShare,
      n: spread.running,
      cls: 'bg-chart-1',
      in: arrived?.running ?? 0,
    },
    {
      key: 'notStarted',
      label: 'Not started',
      share: notStartedShare,
      n: spread.notStarted,
      cls: 'bg-chart-5/45',
      in: arrived?.notStarted ?? 0,
    },
  ];

  return (
    <div className="flex flex-col">
      {/* The sweep goes on the CONTAINER, not on each segment. These are flex
          siblings with a 2px gap: scaling them individually would pull the gaps
          open mid-animation and the row would read as several bars racing each
          other instead of one meter filling. */}
      <div className="flex h-3.5 w-full shrink-0 animate-bar-grow gap-[2px] overflow-hidden rounded-full">
        {seg.map((s) => (
          <div
            key={s.key}
            className={cn('first:rounded-l-full last:rounded-r-full', s.cls)}
            style={{ width: `${s.share}%` }}
            title={`${s.label}: ${fmtPct(s.share)}`}
          />
        ))}
      </div>
      {/* THE ROW WRAPS, and the label carries a floor: at 1024 this card is
          234px wide, and a label with flex-1 (basis 0) collapsed rather than
          forcing a wrap. min-w-24 is what pushes the count onto a second line. */}
      <ul className="mt-4 flex flex-col divide-y">
        {seg.map((s) => (
          <li
            key={s.key}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5 text-sm first:pt-0 last:pb-0"
          >
            <span className="flex min-w-24 flex-1 flex-wrap items-center gap-2 text-muted-foreground">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', s.cls)} />
              {s.label}
              {s.in > 0 && (
                <span className="rounded-full bg-ok-soft px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ok">
                  +{s.in} this week
                </span>
              )}
            </span>
            <span className={cn(FIGURE_COL, 'font-semibold')}>{fmtPct(s.share)}</span>
            <span className={cn('ml-auto w-16 shrink-0 text-right', TYPE.meta)}>
              {s.n} {s.n === 1 ? 'item' : 'items'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- the week */

/**
 * WHAT THE WEEK DID, in the room Work spread left over (26 Sep 2026).
 *
 * The hero is cumulative, so nothing on this page used to say what happened in
 * the week being looked at: week 36 added 10.38% — one item, Engineering by
 * Solar, 0% to 100% — and the page never said so. Three figures, then the
 * items. Every figure is a difference between figures printed elsewhere on the
 * page, so they check: added − plan added = lead change, and What moved adds up
 * to added (lib/figures.ts).
 */
export function WeekStory({
  week,
  addedPct,
  planAddedPct,
  prevDeviationPct,
  deviationPct,
  deviationChange,
  movers,
  moreHref,
}: {
  week: number;
  addedPct: number;
  planAddedPct: number;
  prevDeviationPct: number;
  deviationPct: number;
  deviationChange: number;
  movers: Mover[];
  moreHref: string;
}) {
  const scale = Math.max(Math.abs(addedPct), Math.abs(planAddedPct), 0.01);
  const leadScale = Math.max(Math.abs(prevDeviationPct), Math.abs(deviationPct), 0.01);
  // "+9.84" means opposite things on the two sides of zero, so the label says
  // which side this week ended on.
  const leadLabel = deviationPct >= 0 ? 'Lead over plan' : 'Gap to plan';
  // Last week is the same measure, so the same colour, paler. It was grey,
  // and grey read as "empty track", not as a week (26 Sep 2026).
  const curBar = deviationPct >= 0 ? 'bg-ok' : 'bg-bad';
  const prevBar = prevDeviationPct >= 0 ? 'bg-ok/35' : 'bg-bad/35';
  const shown = movers.slice(0, 3);
  const more = movers.length - shown.length;
  const wentBack = (m: Mover) => m.share < 0 || m.curPct < m.prevPct;
  const anyBack = movers.some(wentBack);

  return (
    // FLAT, in the card's own flow (26 Sep 2026): this was a tinted box inside
    // the card with a bordered box per item inside that, three frames deep, and
    // read as clutter. Sections are divided by rules, like the key above them.
    <div className="flex h-full flex-col">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Week {week}
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-4">
        <div className="min-w-0">
          <p className={TYPE.statLabel}>Added this week</p>
          <p className={cn('mt-0.5 text-chart-1', TYPE.figure)}>{signed(addedPct, fmtPct(addedPct))}</p>
          <div className="mt-2 flex flex-col gap-[3px]" aria-hidden>
            <div className="h-[5px] rounded-full bg-muted">
              <div className="h-full rounded-full bg-chart-1" style={{ width: `${pctOf(addedPct, scale)}%` }} />
            </div>
            <div className="h-[5px] rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-2"
                style={{ width: `${pctOf(planAddedPct, scale)}%` }}
              />
            </div>
          </div>
          <p className={cn('mt-1.5 whitespace-nowrap', TYPE.meta)}>
            <span className="font-medium text-red-600">
              plan {signed(planAddedPct, fmtPct(planAddedPct))}
            </span>
          </p>
        </div>
        <div className="min-w-0">
          <p className={TYPE.statLabel}>{leadLabel}</p>
          <p
            className={cn(
              'mt-0.5',
              TYPE.figure,
              deviationChange > 0 ? 'text-ok' : deviationChange < 0 ? 'text-bad' : ''
            )}
          >
            {signed(deviationChange, fmtNum(deviationChange, 2))}
          </p>
          <div className="mt-2 flex flex-col gap-[3px]" aria-hidden>
            <div className="h-[5px] rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', curBar)}
                style={{ width: `${pctOf(deviationPct, leadScale)}%` }}
              />
            </div>
            <div className="h-[5px] rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full', prevBar)}
                style={{ width: `${pctOf(prevDeviationPct, leadScale)}%` }}
              />
            </div>
          </div>
          {/* A KEY, not "6.48% → 16.65%": a grey bar with nothing naming it
              was read as nothing at all (26 Sep 2026). Each line carries its
              bar's colour and says which week it is, in the bars' order. */}
          <dl className={cn('mt-1.5 flex flex-col gap-0.5', TYPE.meta)}>
            {[
              { wk: week, pct: deviationPct, bar: curBar, text: 'font-medium text-foreground' },
              { wk: week - 1, pct: prevDeviationPct, bar: prevBar, text: '' },
            ].map((r) => (
              <div key={r.wk} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className={cn('h-[5px] w-2.5 shrink-0 rounded-full', r.bar)} aria-hidden />
                <dt>Week {r.wk}</dt>
                <dd className={cn('ml-auto', r.text)}>{fmtPct(r.pct)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="mt-4 border-t pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        What moved
      </p>
      {shown.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">Nothing moved in week {week}.</p>
      ) : (
        <ul className="mt-1 flex flex-col divide-y">
          {shown.map((m) => (
            // WORDS LEFT, NUMBERS RIGHT (26 Sep 2026). The state and the
            // percentages ran together in one grey sentence beside a pill, so
            // no figure lined up with any other. Now the share and the item's
            // own before → after stack in one right-aligned column, and the
            // share carries a % like "Added this week" it adds up to.
            <li key={m.id} className="py-2.5 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <p className={cn('min-w-0 truncate', TYPE.row)}>{m.deskripsi}</p>
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    wentBack(m) ? 'text-bad' : 'text-chart-1'
                  )}
                >
                  {signed(m.share, fmtPct(m.share))}
                </span>
              </div>
              <div className={cn('mt-1 flex items-baseline justify-between gap-3', TYPE.meta)}>
                <span className="min-w-0 truncate">
                  {stateOf(m.prevPct)} → {stateOf(m.curPct)}
                </span>
                <span className="shrink-0">
                  {fmtPct(m.prevPct, 0)} → {fmtPct(m.curPct, 0)}
                </span>
              </div>
              {m.milestones.length > 0 && (
                <span className="mt-1.5 inline-flex rounded-full bg-meta-soft px-2 py-0.5 text-[11px] font-semibold tracking-wide text-meta">
                  {m.milestones.join(' · ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {(more > 0 || !anyBack) && (
        <p className={cn('mt-auto flex items-center gap-1.5 pt-3', TYPE.meta)}>
          {more > 0 ? (
            <a href={moreHref} className="font-medium text-chart-1 hover:underline">
              {more} more moved this week
            </a>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />
              Nothing went backwards
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** A label centred under a mark, held inside the track at both ends. */
function TrackLabel({ at, className, children }: { at: number; className?: string; children: ReactNode }) {
  if (at >= 94) return <span className={cn('absolute right-0', className)}>{children}</span>;
  return (
    <span className={cn('absolute -translate-x-1/2', className)} style={{ left: `${Math.max(at, 6)}%` }}>
      {children}
    </span>
  );
}

function stateOf(pct: number) {
  return pct >= 99.995 ? 'Done' : pct > 0 ? 'Running' : 'Not started';
}

function pctOf(v: number, scale: number) {
  return Math.max(0, Math.min(100, (Math.abs(v) / scale) * 100));
}

/* ---------------------------------------------------------------- forecast */

/**
 * Week 1, now, the forecast and the contract end on one track, so "Week 55 ·
 * 17 weeks earlier" is a distance you can see and not only a sum.
 */
export function ForecastTrack({
  week,
  forecastWeek,
  lastWeek,
}: {
  week: number;
  forecastWeek: number;
  lastWeek: number;
}) {
  const end = Math.max(lastWeek, forecastWeek, week, 2);
  const at = (w: number) => Math.max(0, Math.min(100, ((w - 1) / (end - 1)) * 100));
  const now = at(week);
  const fc = at(forecastWeek);
  const endAt = at(lastWeek);
  const late = forecastWeek > lastWeek + 0.5;
  return (
    <div aria-hidden>
      <div className="relative h-2 rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full bg-chart-1" style={{ width: `${now}%` }} />
        <div
          className="absolute inset-y-0 bg-[repeating-linear-gradient(90deg,color-mix(in_oklab,var(--chart-1)_35%,transparent)_0_6px,transparent_6px_10px)]"
          style={{ left: `${now}%`, width: `${Math.max(0, fc - now)}%` }}
        />
        <span
          className={cn('absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full', late ? 'bg-bad' : 'bg-ok')}
          style={{ left: `${fc}%` }}
        />
        <span
          className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-muted-foreground"
          style={{ left: `${endAt}%` }}
        />
      </div>
      {/* Each label sits under its own mark. The contract's end is only the
          track's end when the forecast lands inside the contract; a late one
          stretches the track past it, and "72" pinned to the right edge sat
          on top of "165" (26 Sep 2026). */}
      <div className={cn('relative mt-2 h-4 whitespace-nowrap', TYPE.meta)}>
        <span className="absolute left-0">Week 1</span>
        {now > 16 && Math.abs(now - fc) > 14 && Math.abs(now - endAt) > 14 && (
          <span className="absolute -translate-x-1/2" style={{ left: `${now}%` }}>
            Now · {week}
          </span>
        )}
        <TrackLabel at={fc} className={cn('font-semibold', late ? 'text-bad' : 'text-ok')}>
          {Math.round(forecastWeek)}
        </TrackLabel>
        {Math.abs(fc - endAt) > 8 && <TrackLabel at={endAt}>{lastWeek}</TrackLabel>}
      </div>
    </div>
  );
}

// CodeChip moved to components/ui/CodeChip.tsx — Detail Progress shows the
// same tag in the same place, and a contract has to look like itself on both.
