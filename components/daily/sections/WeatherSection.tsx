'use client';

import { m } from 'framer-motion';
import { ArrowRight, Cloud, CloudDrizzle, CloudRain, Sun } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import type { WeatherInfo } from '@/lib/types';
import { cn } from '@/lib/utils';
import { INPUT_CLS } from '../fields';
import { RowButton, SectionRow, type SectionProps } from '../SectionRow';

const OPTIONS = [
  ['hujanDeras', CloudRain],
  ['hujanSedang', CloudDrizzle],
  ['berawanMendung', Cloud],
  ['cerahTerang', Sun],
] as const;

export default function WeatherSection({
  report,
  commit,
  state,
  open,
  onToggle,
  onOpen,
  labels,
}: SectionProps & { labels: Record<string, string> }) {
  const w = report.weather;
  const picked = OPTIONS.filter(([k]) => w[k]).map(([k]) => labels[k] ?? k);
  const patch = (p: Partial<WeatherInfo>) => commit({ weather: { ...w, ...p } });

  return (
    <SectionRow
      id="weather"
      title="Weather"
      summary={picked.length ? `${picked.join(' · ')} · ${w.waktuMulai} to ${w.waktuSelesai}` : 'Not entered yet'}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={picked.length === 0 ? <RowButton onClick={onOpen}>Pick</RowButton> : undefined}
    >
      <p className="mb-2 text-[12px] font-medium text-muted-foreground">Conditions today</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {OPTIONS.map(([k, Icon]) => {
          const on = w[k];
          return (
            <m.button
              key={k}
              type="button"
              {...pressMotion}
              aria-pressed={on}
              onClick={() => patch({ [k]: !on } as Partial<WeatherInfo>)}
              className={cn(
                'flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-[13px] font-medium transition-colors duration-200 ease-ios',
                on ? 'border-chart-1 bg-chart-1/10 text-primary' : 'border-border bg-card text-foreground hover:border-gray-300'
              )}
            >
              <Icon className={cn('size-[22px] transition-colors duration-200', on ? 'text-chart-1' : 'text-gray-400')} />
              {labels[k] ?? k}
            </m.button>
          );
        })}
      </div>

      <p className="mb-2 mt-4 text-[12px] font-medium text-muted-foreground">Working hours</p>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
        <input
          type="time"
          aria-label="Start time"
          value={w.waktuMulai}
          onChange={(e) => patch({ waktuMulai: e.target.value })}
          className={cn(INPUT_CLS, 'w-full min-w-0 tabular-nums sm:w-32')}
        />
        <ArrowRight className="hidden size-4 shrink-0 text-gray-400 sm:block" aria-hidden />
        <input
          type="time"
          aria-label="End time"
          value={w.waktuSelesai}
          onChange={(e) => patch({ waktuSelesai: e.target.value })}
          className={cn(INPUT_CLS, 'w-full min-w-0 tabular-nums sm:w-32')}
        />
      </div>
    </SectionRow>
  );
}
