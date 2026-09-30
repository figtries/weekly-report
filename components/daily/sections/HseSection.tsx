'use client';

import { m } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { pressMotion } from '@/components/motion/Press';
import type { HseRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { RowButton, SectionRow, sameHint, type SectionProps } from '../SectionRow';

export default function HseSection({ report, commit, state, open, onToggle, hasPredecessor }: SectionProps) {
  const rows = report.hseInput;
  const hits = rows.filter((r) => r.today > 0);

  const setToday = (r: HseRow, today: number) =>
    commit({ hseInput: rows.map((x) => (x.id === r.id ? { ...x, today } : x)), confirmed: { hse: true } });
  // A tap is a fact with a time; taking one back is a correction and is not logged.
  const plusOne = (r: HseRow) =>
    commit(
      { hseInput: rows.map((x) => (x.id === r.id ? { ...x, today: x.today + 1 } : x)), confirmed: { hse: true } },
      { kind: 'hse', text: `${r.activity} +1` }
    );

  return (
    <SectionRow
      id="hse"
      title="HSE"
      summary={hits.length ? hits.map((r) => `${r.activity} ${r.today}`).join(' · ') : 'All zero today'}
      hint={state === 'same' ? sameHint(hasPredecessor) : undefined}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? <RowButton onClick={() => commit({ confirmed: { hse: true } })}>Confirm</RowButton> : undefined
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {rows.map((r) => {
          const on = r.today > 0;
          return (
            <div
              key={r.id}
              className={cn(
                'flex flex-col justify-between gap-2 rounded-xl border px-3 py-2.5 transition-colors duration-300 ease-ios',
                on ? 'border-amber-300 bg-amber-50' : 'border-border bg-card'
              )}
            >
              <p className="min-h-[32px] text-[12.5px] leading-tight text-muted-foreground">{r.activity}</p>
              <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className={cn('text-[22px] font-semibold leading-none tabular-nums', on ? 'text-amber-700' : 'text-foreground')}>
                  {r.today}
                </p>
                {r.previous > 0 && <p className="mt-1 text-[11px] text-gray-400">Total {r.previous + r.today}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {on && (
                  <m.button
                    type="button"
                    {...pressMotion}
                    aria-label={`Take one off ${r.activity}`}
                    onClick={() => setToday(r, r.today - 1)}
                    className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-gray-400 transition-colors hover:bg-muted sm:size-9"
                  >
                    <Minus className="size-4" />
                  </m.button>
                )}
                <m.button
                  type="button"
                  {...pressMotion}
                  aria-label={`Add one ${r.activity}`}
                  onClick={() => plusOne(r)}
                  className="flex size-11 items-center justify-center rounded-full border border-border bg-card text-chart-1 transition-colors hover:bg-chart-1/10 sm:size-9"
                >
                  <Plus className="size-4" />
                </m.button>
              </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-gray-400">Tap + when something happens. Each tap is logged with its time.</p>
    </SectionRow>
  );
}
