'use client';

import { TrendingUp } from 'lucide-react';
import Link from 'next/link';
import PlanActualBar from '@/components/ui/PlanActualBar';
import type { DailyProgress } from '@/lib/daily-progress';
import { SectionCard, type CardProps } from '../SectionCard';

const pct = (n: number) => `${n.toFixed(2)}%`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`;

export default function ProgressCard({
  state,
  open,
  onToggle,
  progress,
}: CardProps & { progress: DailyProgress | null }) {
  const ready = progress?.state === 'ready' ? progress : null;
  const held = progress?.state === 'held' ? progress : null;
  const devCls =
    !ready || Math.abs(ready.variance) < 0.005
      ? 'text-gray-700'
      : ready.variance < 0
        ? 'text-red-500'
        : 'text-emerald-600';

  return (
    <SectionCard
      id="progress"
      icon={<TrendingUp className="size-[18px]" />}
      title="Progress"
      summary={
        ready
          ? `Week ${ready.week} · Actual ${pct(ready.actual)} · Plan ${pct(ready.plan)}`
          : held
            ? 'Held until the weights reach 100%'
            : 'No plan yet'
      }
      state={state}
      open={open}
      onToggle={onToggle}
    >
      {ready ? (
        <div className="space-y-3">
          <PlanActualBar actual={ready.actual} plan={ready.plan} />
          <dl className="divide-y divide-gray-200">
            <div className="flex items-baseline justify-between py-2">
              <dt className="text-sm text-muted-foreground">Actual</dt>
              <dd className="text-sm font-semibold tabular-nums text-chart-1">{pct(ready.actual)}</dd>
            </div>
            <div className="flex items-baseline justify-between py-2">
              <dt className="text-sm text-muted-foreground">Plan</dt>
              <dd className="text-sm font-semibold tabular-nums text-chart-2">{pct(ready.plan)}</dd>
            </div>
            <div className="flex items-baseline justify-between py-2">
              <dt className="text-sm text-muted-foreground">Deviation</dt>
              <dd className={`text-sm font-semibold tabular-nums ${devCls}`}>{signed(ready.variance)}</dd>
            </div>
          </dl>
          <p className="text-[13px] leading-snug text-muted-foreground">
            From the weekly report, not typed here.{' '}
            <Link href={`/weekly/${ready.week}/summary`} className="font-semibold text-chart-1">
              Open week {ready.week}
            </Link>
          </p>
        </div>
      ) : held ? (
        <p className="text-[13px] leading-snug text-muted-foreground">
          The weights total {held.weightsTotal.toFixed(2)}%, so no figure is shown anywhere yet.{' '}
          <Link href={`/weekly/${held.week}/weights`} className="font-semibold text-chart-1">
            Open Weights
          </Link>
        </p>
      ) : (
        <p className="text-[13px] leading-snug text-muted-foreground">
          This project has no plan yet, so there is no weekly figure to read.
        </p>
      )}
    </SectionCard>
  );
}
