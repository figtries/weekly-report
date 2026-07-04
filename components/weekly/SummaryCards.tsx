import type { GrandTotal, SummaryRow } from '@/lib/rollup';
import AnimatedNumber from '@/components/ui/AnimatedNumber';

/* Status is derived from the WF variance (cumulative vs target). The table
   version showed the raw number; here we translate it into a badge anyone
   can read at a glance. */
function statusOf(curProgressPct: number, variance: number) {
  if (curProgressPct >= 99.995) {
    return { label: 'Completed', chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' };
  }
  if (variance >= -0.005) {
    return { label: 'On Track', chip: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' };
  }
  return {
    label: `Behind ${Math.abs(variance).toFixed(2)}%`,
    chip: 'bg-red-100 text-red-700',
    bar: 'bg-red-500',
  };
}

function ProgressBar({
  value,
  target,
  barClass,
  delay,
}: {
  value: number; // 0..100
  target: number; // 0..100 — where the plan says we should be
  barClass: string;
  delay: number;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  const targetClamped = Math.min(100, Math.max(0, target));
  return (
    <div className="relative h-3 rounded-full bg-gray-100">
      <div
        className={`animate-bar-grow h-full rounded-full ${barClass}`}
        style={{ width: `${clamped}%`, animationDelay: `${delay}ms` }}
      />
      {/* Target tick — the little flag the eye compares the bar against */}
      <div
        className="absolute -top-1 h-5 w-0.5 rounded-full bg-gray-900/60"
        style={{ left: `calc(${targetClamped}% - 1px)` }}
        title={`Target ${targetClamped.toFixed(2)}%`}
      />
    </div>
  );
}

function MiniStat({ label, value, tone = 'text-gray-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] lg:text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`text-sm lg:text-base font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

export default function SummaryCards({ roots, grandTotal }: { roots: SummaryRow[]; grandTotal: GrandTotal }) {
  const gtStatus = statusOf(grandTotal.curProgressPct, grandTotal.variance);

  return (
    <div className="space-y-6">
      {/* ---- Hero: overall project progress ---- */}
      <div className="animate-fade-in-up rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Overall Project Progress</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-4xl sm:text-5xl font-semibold text-gray-900">
                <AnimatedNumber value={grandTotal.curProgressPct} suffix="%" />
              </span>
              <span className="text-sm text-gray-500">
                of target <span className="font-semibold text-gray-700 tabular-nums">{grandTotal.targetWF.toFixed(2)}%</span>
              </span>
            </div>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${gtStatus.chip}`}>{gtStatus.label}</span>
        </div>

        <ProgressBar value={grandTotal.curProgressPct} target={grandTotal.targetWF} barClass={gtStatus.bar} delay={100} />

        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 border-t border-gray-100 pt-4 sm:grid-cols-4">
          <MiniStat label="Actual" value={`${grandTotal.curProgressPct.toFixed(2)}%`} />
          <MiniStat label="Plan" value={`${grandTotal.targetWF.toFixed(2)}%`} />
          <MiniStat
            label="This Week"
            value={`+${grandTotal.thisWeekProgressPct.toFixed(2)}%`}
            tone={grandTotal.thisWeekProgressPct > 0 ? 'text-blue-600' : 'text-gray-400'}
          />
          <MiniStat
            label="Deviation"
            value={`${grandTotal.variance >= 0 ? '+' : ''}${grandTotal.variance.toFixed(2)}%`}
            tone={grandTotal.variance < 0 ? 'text-red-600' : 'text-emerald-600'}
          />
        </div>
      </div>

      {/* ---- One card per SPK contract ---- */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
        {roots.map((item, idx) => {
          // Per-contract target in the contract's own progress terms (WF ÷ weight)
          const targetPct = item.bobot > 0 ? (item.targetWF / item.bobot) * 100 : 0;
          const status = statusOf(item.curProgressPct, item.variance);
          const delay = 80 + idx * 70;
          return (
            <div
              key={item.id}
              className="animate-fade-in-up flex flex-col rounded-2xl border border-gray-200 bg-white p-4 sm:p-5 shadow-sm transition-all duration-500 ease-ios hover:-translate-y-0.5 hover:shadow-md"
              style={{ animationDelay: `${delay}ms` }}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div>
                    <p className="font-medium leading-snug text-gray-900">{item.deskripsi}</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Weight <span className="font-semibold tabular-nums">{item.bobot.toFixed(2)}%</span> of project
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.chip}`}>
                  {status.label}
                </span>
              </div>

              <div className="mt-auto mb-2">
                <span className="text-2xl sm:text-3xl font-semibold text-gray-900">
                  <AnimatedNumber value={item.curProgressPct} suffix="%" />
                </span>
              </div>

              <ProgressBar value={item.curProgressPct} target={targetPct} barClass={status.bar} delay={delay + 150} />

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-gray-100 pt-3 sm:grid-cols-4">
                <MiniStat label="Actual" value={`${item.curProgressPct.toFixed(2)}%`} />
                <MiniStat label="Plan" value={`${targetPct.toFixed(2)}%`} />
                <MiniStat
                  label="This Week"
                  value={`+${item.thisWeekProgressPct.toFixed(2)}%`}
                  tone={item.thisWeekProgressPct > 0 ? 'text-blue-600' : undefined}
                />
                <MiniStat
                  label="Deviation"
                  value={`${item.variance >= 0 ? '+' : ''}${item.variance.toFixed(2)}%`}
                  tone={item.variance < -0.005 ? 'text-red-600' : 'text-emerald-600'}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
