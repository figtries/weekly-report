import { cn } from '@/lib/utils';
import CodeChip, { splitCode } from '@/components/ui/CodeChip';
import { fmtPct } from '@/lib/analysis';
import { TYPE, signed, verdictOf, verdictText } from '@/lib/design';
import type { Laggard } from '@/lib/analysis';
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
 * The shape every "actual against plan" row on this page shares: a filled bar
 * for what was reached, and a tick for where it was meant to be.
 */
function MeasureBar({
  actual,
  plan,
  showPlan = true,
  height = 'h-2',
}: {
  actual: number;
  plan: number;
  showPlan?: boolean;
  height?: string;
}) {
  return (
    <div className={cn('relative min-w-0 flex-1 overflow-hidden rounded-full bg-muted', height)}>
      <div className="h-full animate-bar-grow rounded-full bg-chart-1" style={{ width: `${clamp(actual)}%` }} />
      {/* Clamped short of the end: the track is overflow-hidden, so a tick at
          exactly 100% is clipped away entirely. Hidden once complete, where it
          would read as a notch cut out of a full bar rather than as a mark. */}
      {showPlan && (
        <div
          className="absolute inset-y-0 w-[3px] rounded-full bg-chart-2"
          style={{ left: `${Math.min(99.2, clamp(plan))}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- per unit */

/**
 * One row per contract, actual against plan.
 *
 * This is the chart that answers "which contract is dragging" — the question
 * the overall percentage cannot answer. On the Gundih data the total reads
 * comfortably ahead while the 47.65%-weight contract underneath it is behind,
 * and only a per-unit breakdown shows that.
 */
export function UnitBreakdown({ rows }: { rows: SummaryRow[] }) {
  if (rows.length < 2) return null;

  return (
    <ul className="divide-y">
      {rows.map((r) => {
        const actual = r.bobot > 0 ? (r.curWF / r.bobot) * 100 : 0;
        const plan = r.bobot > 0 ? (r.targetWF / r.bobot) * 100 : 0;
        // A finished contract has nothing to be ahead or behind of, and "+0.00%"
        // reads as a measurement rather than as done.
        const done = actual >= 99.995;
        const verdict = done ? 'done' : verdictOf(r.variance);
        // Strip the "(SPK-###)" tag out of the label and show it as its own chip.
        const { tag, name } = splitCode(r.deskripsi);

        return (
          <li key={r.id} className="py-3 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-3">
              {/* The weight sits on its own line rather than beside the name: at
                  390px it stole enough room to truncate every contract down to
                  "Pekerjaan Relok…", which is the same name three times over. */}
              <div className="flex min-w-0 items-baseline gap-2">
                {tag && <CodeChip>{tag}</CodeChip>}
                <p className={cn('truncate', TYPE.row)}>{name}</p>
              </div>
              <span className={cn(FIGURE_COL, 'text-sm font-semibold', verdictText[verdict])}>
                {done ? 'Done' : signed(r.variance, fmtPct(r.variance))}
              </span>
            </div>

            <div className="mt-2 flex items-center gap-3">
              <MeasureBar actual={actual} plan={plan} showPlan={!done} />
              <span className={cn(FIGURE_COL, TYPE.meta)}>{fmtPct(actual)}</span>
            </div>

            <p className={cn('mt-1.5', TYPE.meta)}>{fmtPct(r.bobot)} of the project</p>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------- drags */

/**
 * The handful of leaves holding the project back, largest first.
 *
 * Fill is what the item has reached, the tick is where it should be. A bar
 * sized by variance instead read as "nearly done" on precisely the worst
 * offender.
 */
export function DragList({ rows, limit = 3 }: { rows: Laggard[]; limit?: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing is lagging.</p>;
  }

  return (
    <ul className="divide-y">
      {rows.slice(0, limit).map((l) => (
        <li key={l.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex min-w-0 items-baseline gap-2">
              <CodeChip>{l.wbsCode}</CodeChip>
              <p className={cn('truncate', TYPE.row)}>{l.deskripsi}</p>
            </div>
            <span className={cn(FIGURE_COL, 'text-sm font-semibold', verdictText.behind)}>
              {fmtPct(l.varianceWF)}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <MeasureBar actual={l.actualPct} plan={l.planPct} />
            {/* Reached over planned, in one column rather than two lines: the
                slash is what makes the pair readable at 390px, where the old
                8.5rem "0.00% of 100.00%" left the bar barely wider than a thumb. */}
            <span className={cn('w-[7.5rem] shrink-0 text-right', TYPE.meta)}>
              {fmtPct(l.actualPct)} / {fmtPct(l.planPct)}
            </span>
          </div>
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
export function ProgressSpread({ spread }: { spread: LeafSpread }) {
  const total = spread.notStartedWeight + spread.runningWeight + spread.doneWeight || 1;
  const seg = [
    { key: 'done', label: 'Done', w: spread.doneWeight, n: spread.done, cls: 'bg-chart-3' },
    {
      key: 'running',
      label: 'Running',
      w: spread.runningWeight,
      n: spread.running,
      cls: 'bg-chart-1',
    },
    {
      key: 'notStarted',
      label: 'Not started',
      w: spread.notStartedWeight,
      n: spread.notStarted,
      cls: 'bg-chart-5/45',
    },
  ];

  return (
    // Full height so the key spreads down a card that has been stretched to
    // match its neighbour, rather than floating in the middle of it.
    <div className="flex h-full flex-col">
      {/* The sweep goes on the CONTAINER, not on each segment. These are flex
          siblings with a 2px gap: scaling them individually would pull the gaps
          open mid-animation and the row would read as several bars racing each
          other instead of one meter filling. */}
      <div className="flex h-3.5 w-full shrink-0 animate-bar-grow gap-[2px] overflow-hidden rounded-full">
        {seg.map((s) => (
          <div
            key={s.key}
            className={cn('first:rounded-l-full last:rounded-r-full', s.cls)}
            style={{ width: `${(s.w / total) * 100}%` }}
            title={`${s.label}: ${fmtPct((s.w / total) * 100)}`}
          />
        ))}
      </div>
      {/* Two fixed columns rather than one right-aligned run: with the weight
          and the count in the same span, "65.02% 107 items" and "7.21% 28
          items" put their percent signs in different places on adjacent rows. */}
      {/* Rows keep their own height rather than stretching to fill a card that
          has been matched to a taller neighbour: three legend rows pulled to
          160px apiece read as a gap, not as spacing. */}
      {/* THE ROW WRAPS, and the label carries a floor. This card is one of
          three `lg` columns, so at 1024 it comes out 234px wide — and a label
          with `flex-1` (basis 0) collapses rather than forcing a wrap, so "Not
          started" was squeezed into 27px and spilled straight across "24.43%".
          `min-w-24` gives the label a real base width, which is what makes the
          line overflow and pushes the item count down to a second line;
          `ml-auto` keeps it right-aligned there. Above ~272px of card all three
          still sit on one line exactly as before. */}
      <ul className="mt-4 flex flex-col divide-y">
        {seg.map((s) => (
          <li
            key={s.key}
            className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5 text-sm first:pt-0 last:pb-0"
          >
            <span className="flex min-w-24 flex-1 items-center gap-2 text-muted-foreground">
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', s.cls)} />
              {s.label}
            </span>
            <span className={cn(FIGURE_COL, 'font-semibold')}>
              {fmtPct((s.w / total) * 100)}
            </span>
            <span className={cn('ml-auto w-16 shrink-0 text-right', TYPE.meta)}>
              {s.n} items
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// CodeChip moved to components/ui/CodeChip.tsx — Detail Progress shows the
// same tag in the same place, and a contract has to look like itself on both.

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
