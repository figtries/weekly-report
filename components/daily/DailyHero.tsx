'use client';

import { m } from 'framer-motion';
import type { ReactNode } from 'react';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import { SECTION_ORDER, type SectionState } from '@/lib/daily-status';
import { MOTION } from '@/lib/design';
import type { DailySectionKey } from '@/lib/types';

// The raw colours STATUS_LEGEND draws its meter with (emerald-500, blue-500, amber-400, gray-200).
const SEGMENT: Record<SectionState, string> = {
  ready: '#10b981',
  same: '#3b82f6',
  look: '#fbbf24',
  empty: '#e5e7eb',
  held: '#e5e7eb',
};

const LEGEND: { keys: SectionState[]; label: string; chip: string; dot: string }[] = [
  { keys: ['ready'], label: 'Ready', chip: 'text-emerald-700', dot: 'bg-emerald-500' },
  { keys: ['same'], label: 'To confirm', chip: 'text-blue-700', dot: 'bg-blue-500' },
  { keys: ['look'], label: 'Needs a look', chip: 'text-amber-700', dot: 'bg-amber-400' },
  { keys: ['empty', 'held'], label: 'Empty', chip: 'text-gray-500', dot: 'bg-gray-300' },
];

export default function DailyHero({
  weekday,
  subtitle,
  states,
  ready,
  weekDay,
  pending,
  failed,
  onRetry,
  pdf,
}: {
  weekday: string;
  subtitle: string;
  states: Record<DailySectionKey, SectionState>;
  ready: number;
  /** The week and day of the project this date falls in; nobody types either. Null with no plan. */
  weekDay: { week: number; day: number } | null;
  pending: number;
  failed: boolean;
  onRetry: () => void;
  pdf: ReactNode;
}) {
  return (
    <section className="animate-rise-in overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-5 shadow-sm sm:p-6">
      <div>
        {/* The button shares the label's row, so on a phone it does not take a row of its own. */}
        <div className="flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-400">Daily report</p>
          <div className="flex items-center gap-2">{pdf}</div>
        </div>
        <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">{weekday}</h1>
        {subtitle && <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-end md:gap-8">
        <div className="shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Parts ready</p>
          <p className="mt-1 flex items-baseline gap-1.5 text-4xl font-semibold text-foreground">
            <AnimatedNumber value={ready} decimals={0} duration={600} />
            <span className="text-lg font-medium text-gray-400">of {SECTION_ORDER.length}</span>
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-[10px] bg-gray-100 sm:h-9" aria-hidden>
            {SECTION_ORDER.map((k) => (
              <m.div
                key={k}
                className="h-full flex-1"
                initial={false}
                animate={{ backgroundColor: SEGMENT[states[k]] }}
                transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {LEGEND.map((l) => {
              const n = SECTION_ORDER.filter((k) => l.keys.includes(states[k])).length;
              if (n === 0) return null;
              return (
                <span key={l.label} className={`flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium ${l.chip}`}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${l.dot}`} />
                  {l.label}
                  <span className="font-semibold tabular-nums text-gray-900">{n}</span>
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 md:flex-col md:items-end md:gap-2">
          {weekDay && (
            <p className="text-sm text-muted-foreground">
              Week <span className="font-semibold tabular-nums text-foreground">{weekDay.week}</span>
              {' · '}Day <span className="font-semibold tabular-nums text-foreground">{weekDay.day}</span>
            </p>
          )}
          <p aria-live="polite" className="min-h-5 text-[12px] font-medium text-gray-400">
            {failed ? (
              <button type="button" onClick={onRetry} className="text-red-500 underline underline-offset-2">
                Not saved. Try again
              </button>
            ) : pending > 0 ? (
              'Saving…'
            ) : (
              'All changes saved'
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
