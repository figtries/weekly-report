import type { GrandTotal, SummaryRow } from '@/lib/rollup';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import PlanBar from '@/components/weekly/PlanBar';
import { Reveal } from '@/components/motion/Reveal';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { MOTION, TYPE, verdictChip, type Verdict } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * The Overall Summary sheet: the project, then one card per SPK contract.
 *
 * Everything visible here is shadcn — `Card`, `CardContent`, `Badge` — dressed
 * with the vocabulary in `lib/design.ts`, and every entrance is `Reveal` on the
 * one curve. It used to be hand-rolled `<div>`s on raw `bg-white` /
 * `text-gray-900` / `border-gray-200`, which meant this page picked its own
 * greys, and the stagger was an `animationDelay` computed per card in the
 * markup rather than handed to `Reveal`.
 *
 * `py-0` on every Card is deliberate: shadcn's Card already carries
 * `py-(--card-spacing)`, so a CardContent with its own padding doubles it.
 */

/* ONE COLOUR PER FIGURE, THE SAME FOUR AS THE FILL-IN SCREEN.

   `--chart-1` IS "actual, blue" and `--chart-2` IS "plan, red" — the two the
   S-Curve has always drawn — so this row, that row and the curve teach one
   vocabulary instead of three. "This week" is green because it is the good
   news, and it USED to be blue, which put it in a straight fight with Actual
   the moment Actual took its own colour.

   Deviation is yellow always (`--deviation`): the colour here says which
   figure you are looking at, and the word underneath says how to feel about
   it. A number that changes colour cannot also be an identifier. */
const FIG = {
  actual: 'text-chart-1',
  plan: 'text-chart-2',
  thisWeek: 'text-ok',
  deviation: 'text-deviation',
} as const;

/* Status is derived from the WF variance (cumulative vs target) and it is the
   ONLY place on this sheet a colour means "good" or "bad" — the bars and the
   figures above are all measurement. Sentence case throughout, per rule 3. */
function statusOf(curProgressPct: number, variance: number): { label: string; verdict: Verdict } {
  if (curProgressPct >= 99.995) return { label: 'Completed', verdict: 'done' };
  if (variance >= -0.005) return { label: 'On track', verdict: 'ahead' };
  return { label: `Behind ${Math.abs(variance).toFixed(2)}%`, verdict: 'behind' };
}

function StatusBadge({ status }: { status: { label: string; verdict: Verdict } }) {
  return (
    <Badge className={cn('h-6 shrink-0 px-2.5 text-xs font-semibold', verdictChip[status.verdict])}>
      {status.label}
    </Badge>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className={TYPE.statLabel}>{label}</p>
      <p className={cn('text-sm font-semibold tabular-nums lg:text-base', tone)}>{value}</p>
    </div>
  );
}

/** The four figures, in the one order every weekly screen states them. */
function FigureRow({
  actual,
  plan,
  thisWeek,
  deviation,
}: {
  actual: number;
  plan: number;
  thisWeek: number;
  deviation: number;
}) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4 sm:gap-4">
      <MiniStat label="Actual" value={`${actual.toFixed(2)}%`} tone={FIG.actual} />
      <MiniStat label="Plan" value={`${plan.toFixed(2)}%`} tone={FIG.plan} />
      <MiniStat
        label="This week"
        // A hard-coded '+' printed '+-0.59%' the moment a contract moved
        // backwards, which SPK-003 did in week 36.
        value={`${thisWeek >= 0 ? '+' : ''}${thisWeek.toFixed(2)}%`}
        tone={thisWeek > 0 ? FIG.thisWeek : 'text-muted-foreground'}
      />
      <MiniStat
        label="Deviation"
        value={`${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)}%`}
        tone={FIG.deviation}
      />
    </div>
  );
}

export default function SummaryCards({
  roots,
  grandTotal,
}: {
  roots: SummaryRow[];
  grandTotal: GrandTotal;
}) {
  const gtStatus = statusOf(grandTotal.curProgressPct, grandTotal.variance);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* ---- Hero: overall project progress ---- */}
      <Reveal>
        <Card className="py-0">
          <CardContent className="p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={TYPE.statLabel}>Overall project progress</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className={cn('text-4xl font-semibold tracking-tight sm:text-5xl', FIG.actual)}>
                    <AnimatedNumber value={grandTotal.curProgressPct} suffix="%" />
                  </span>
                  <span className="text-sm text-muted-foreground">
                    of plan{' '}
                    <span className={cn('font-semibold tabular-nums', FIG.plan)}>
                      {grandTotal.targetWF.toFixed(2)}%
                    </span>
                  </span>
                </div>
              </div>
              <StatusBadge status={gtStatus} />
            </div>

            <PlanBar actual={grandTotal.curProgressPct} plan={grandTotal.targetWF} />

            <FigureRow
              actual={grandTotal.curProgressPct}
              plan={grandTotal.targetWF}
              thisWeek={grandTotal.thisWeekProgressPct}
              deviation={grandTotal.variance}
            />
          </CardContent>
        </Card>
      </Reveal>

      {/* ---- One card per SPK contract ---- */}
      <div className="grid grid-cols-1 gap-3 sm:gap-4 xl:grid-cols-2">
        {roots.map((item, idx) => {
          // Per-contract target in the contract's own progress terms (WF ÷ weight)
          const targetPct = item.bobot > 0 ? (item.targetWF / item.bobot) * 100 : 0;
          const status = statusOf(item.curProgressPct, item.variance);
          return (
            <Reveal key={item.id} delay={MOTION.stagger * (idx + 1)} className="h-full">
              <Card className="h-full py-0 transition-shadow duration-300 ease-ios hover:shadow-md">
                <CardContent className="flex h-full flex-col p-4 sm:p-5">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm leading-snug font-medium text-foreground">
                        {item.deskripsi}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Weight{' '}
                        <span className="font-semibold tabular-nums">{item.bobot.toFixed(2)}%</span>{' '}
                        of project
                      </p>
                    </div>
                    <StatusBadge status={status} />
                  </div>

                  <div className="mt-auto mb-2">
                    <span
                      className={cn('text-2xl font-semibold tracking-tight sm:text-3xl', FIG.actual)}
                    >
                      <AnimatedNumber value={item.curProgressPct} suffix="%" />
                    </span>
                  </div>

                  <PlanBar actual={item.curProgressPct} plan={targetPct} />

                  <FigureRow
                    actual={item.curProgressPct}
                    plan={targetPct}
                    thisWeek={item.thisWeekProgressPct}
                    deviation={item.variance}
                  />
                </CardContent>
              </Card>
            </Reveal>
          );
        })}
      </div>
    </div>
  );
}
