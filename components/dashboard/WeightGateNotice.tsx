import Link from 'next/link';
import { ArrowRight, Scale } from 'lucide-react';

import CodeChip from '@/components/ui/CodeChip';
import { fmtPct } from '@/lib/analysis';
import { formatMoney } from '@/lib/currency';
import { cn } from '@/lib/utils';
import type { WeightGate } from '@/lib/weight-gate';

/**
 * What stands where the figures would be while the weights do not close.
 *
 * The user's ruling (26 Sep 2026): progress figures built on half-finished
 * weights are a guess, so every screen that reports progress shows THIS instead
 * — the total so far, the activities with no budget by name, and one press to
 * Weights. Filling in progress is still open and says so, because site facts
 * recorded now are what every figure is built from the moment the weights close.
 * See lib/weight-gate.ts.
 */
export default function WeightGateNotice({
  gate,
  week,
  budget,
  currency,
  className,
}: {
  gate: WeightGate;
  week: number;
  /** The project budget, to say what the missing share is in money. */
  budget?: number | null;
  currency?: string;
  className?: string;
}) {
  const short = 100 - gate.total;
  const totalLine =
    Math.abs(short) <= 0.01
      ? 'The weights add up to 100%.'
      : short > 0
        ? `${fmtPct(short)} of the project budget${budget && currency ? ` (${formatMoney(budget, currency)})` : ''} has not reached an activity yet.`
        : `The activities hand out ${fmtPct(-short)} more than the project budget holds.`;

  return (
    <div className={cn('animate-enter rounded-xl border bg-card p-5 sm:p-7', className)}>
      <div className="flex items-start gap-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-warn-soft text-warn">
          <Scale className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">
            {Math.abs(short) <= 0.01
              ? 'Some activities have no budget'
              : `Weights add up to ${fmtPct(gate.total)}, not 100%`}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Progress figures wait until every activity has a budget and the budgets reach 100%.
            Filling in progress still works, and every figure appears the moment the weights
            close.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Weight so far
          </p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{fmtPct(gate.total)}</p>
          <div className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className={cn('h-full rounded-full', Math.abs(short) <= 0.01 ? 'bg-ok' : 'bg-warn')}
              style={{ width: `${Math.max(0, Math.min(100, gate.total))}%` }}
            />
          </div>
          <p className="mt-2 text-xs leading-snug text-muted-foreground">{totalLine}</p>
        </div>

        <div className="rounded-xl border bg-muted/40 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {gate.unbudgeted.length === 0
              ? 'Every activity has a budget'
              : `No budget yet · ${gate.unbudgeted.length} ${gate.unbudgeted.length === 1 ? 'activity' : 'activities'}`}
          </p>
          {gate.unbudgeted.length > 0 && (
            <ul className="mt-1.5 divide-y">
              {gate.unbudgeted.slice(0, 6).map((u) => (
                <li key={u.id} className="flex min-w-0 items-baseline gap-2 py-1.5 text-sm">
                  {u.code && <CodeChip>{u.code}</CodeChip>}
                  <span className="truncate">{u.name}</span>
                </li>
              ))}
            </ul>
          )}
          {gate.unbudgeted.length > 6 && (
            <p className="mt-1 text-xs text-muted-foreground">
              and {gate.unbudgeted.length - 6} more on Weights
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <Link
          href={`/weekly/${week}/weights`}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-all duration-300 ease-ios hover:brightness-110 active:scale-[0.98]"
        >
          Complete in Weights <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link
          href={`/weekly/${week}/overall`}
          className="inline-flex min-h-11 items-center rounded-lg border bg-card px-4 text-sm font-medium transition-all duration-300 ease-ios hover:bg-muted active:scale-[0.98]"
        >
          Fill in progress
        </Link>
      </div>
    </div>
  );
}
