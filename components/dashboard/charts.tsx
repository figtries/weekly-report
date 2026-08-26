import { cn } from '@/lib/utils';
import { fmtPct } from '@/lib/analysis';
import type { SummaryRow } from '@/lib/rollup';
import type { SCurveRow } from '@/lib/scurve';

/**
 * The dashboard's visuals, all server-rendered SVG and divs.
 *
 * Recharts is in the dependency list, but every chart here is static — no
 * tooltip, no zoom, no client state. Drawing them by hand keeps them in the
 * prerendered shell, so they are on screen in the first paint instead of after
 * hydration, which is what the field crew's connection actually feels.
 */

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
    <ul className="space-y-3.5">
      {rows.map((r) => {
        const actual = r.bobot > 0 ? (r.curWF / r.bobot) * 100 : 0;
        const plan = r.bobot > 0 ? (r.targetWF / r.bobot) * 100 : 0;
        const behind = r.variance < 0;
        // A finished contract has nothing to be ahead or behind of, and "+0,00%"
        // reads as a measurement rather than as done.
        const done = actual >= 99.995;
        // Strip the "(SPK-###)" tag out of the label and show it as its own chip.
        const tag = r.deskripsi.match(/\(SPK-\d+\)/)?.[0]?.replace(/[()]/g, '') ?? null;
        const name = r.deskripsi.replace(/\s*\(SPK-\d+\)\s*/, '').trim();

        return (
          <li key={r.id}>
            <div className="flex items-baseline justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                {tag && (
                  <span className="shrink-0 rounded bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-tight text-muted-foreground">
                    {tag}
                  </span>
                )}
                <p className="truncate text-sm font-medium">{name}</p>
                <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                  bobot {fmtPct(r.bobot)}
                </span>
              </div>
              {done ? (
                <span className="shrink-0 text-sm font-semibold text-emerald-600">selesai</span>
              ) : (
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    behind ? 'text-destructive' : 'text-emerald-600'
                  )}
                >
                  {behind ? '' : '+'}
                  {fmtPct(r.variance)}
                </span>
              )}
            </div>

            <div className="mt-1.5 flex items-center gap-2.5">
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                <div
                  className={cn('h-full rounded-full', behind ? 'bg-destructive/65' : 'bg-emerald-500/70')}
                  style={{ width: `${clamp(actual)}%` }}
                />
                {/* Hidden once complete: at 100% the tick sits under the very end
                    of a full bar and reads as a notch cut out of it. */}
                {!done && (
                  <div
                    className="absolute inset-y-0 w-0.5 bg-foreground/45"
                    style={{ left: `${Math.min(99.2, clamp(plan))}%` }}
                    aria-hidden
                  />
                )}
              </div>
              <span className="w-14 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                {fmtPct(actual)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- velocity */

/**
 * How much was added each week, against how much the plan wanted.
 *
 * A single velocity figure hides whether the crew is steady or lurching, and
 * lurching is the thing that makes a forecast worthless.
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
      <div className="flex h-20 items-end gap-[3px]">
        {bars.map((b) => (
          <div key={b.week} className="group relative flex h-full flex-1 items-end">
            {/* Plan sits behind as a ghost, so a short bar in front reads as a shortfall. */}
            {b.plan !== null && (
              <div
                className="absolute inset-x-0 bottom-0 rounded-sm bg-foreground/[0.09]"
                style={{ height: `${(b.plan / peak) * 100}%` }}
                aria-hidden
              />
            )}
            <div
              className={cn(
                'relative w-full rounded-sm',
                b.plan !== null && b.actual < b.plan ? 'bg-destructive/55' : 'bg-emerald-500/65'
              )}
              style={{ height: `${Math.max(2, (b.actual / peak) * 100)}%` }}
              title={`Minggu ${b.week}: ${fmtPct(b.actual)}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>minggu {bars[0].week}</span>
        <span>{bars[bars.length - 1].week}</span>
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
 * how much of the project is actually stalled.
 */
export function ProgressSpread({ spread }: { spread: LeafSpread }) {
  const total = spread.notStartedWeight + spread.runningWeight + spread.doneWeight || 1;
  const seg = [
    { key: 'done', label: 'Selesai', w: spread.doneWeight, n: spread.done, cls: 'bg-emerald-500/75' },
    { key: 'running', label: 'Berjalan', w: spread.runningWeight, n: spread.running, cls: 'bg-blue-500/70' },
    {
      key: 'notStarted',
      label: 'Belum mulai',
      w: spread.notStartedWeight,
      n: spread.notStarted,
      cls: 'bg-foreground/15',
    },
  ];

  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        {seg.map((s) => (
          <div
            key={s.key}
            className={s.cls}
            style={{ width: `${(s.w / total) * 100}%` }}
            title={`${s.label}: ${fmtPct((s.w / total) * 100)}`}
          />
        ))}
      </div>
      <ul className="mt-3 space-y-1.5">
        {seg.map((s) => (
          <li key={s.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', s.cls)} />
              {s.label}
            </span>
            <span className="tabular-nums">
              <span className="font-medium">{fmtPct((s.w / total) * 100)}</span>
              <span className="ml-2 text-xs text-muted-foreground">{s.n} item</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
