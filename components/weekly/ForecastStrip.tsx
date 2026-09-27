'use client';

import { m } from 'framer-motion';
import { useState } from 'react';
import { CalendarClock } from 'lucide-react';

import type { ForecastView } from '@/lib/forecast-view';
import { Expand } from '@/components/motion/Expand';
import CodeChip, { splitCode } from '@/components/ui/CodeChip';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';

/**
 * The forecast, over the map: where the last activity lands, which one sets
 * it, and what the app found in the data that the forecast needs somebody to
 * look at. The list is the reminders' list (`ReminderList` in OverallMap):
 * each line says why, in words, and "Open ›" goes straight into that
 * activity's panel, where the fix or the missing date is.
 *
 * Native buttons for the lines, like the map's own rows: this can run long.
 */

const ROWS = 6;

export default function ForecastStrip({ view, onOpen }: { view: ForecastView; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const gap = view.lastWeek - view.finishWeek;
  const verdict =
    gap === 0 ? 'on the contract end' : `${Math.abs(gap)} ${Math.abs(gap) === 1 ? 'week' : 'weeks'} ${gap > 0 ? 'early' : 'late'}`;
  const setter = view.path[view.path.length - 1];
  const shown = all ? view.toCheck : view.toCheck.slice(0, ROWS);
  const n = view.toCheck.length;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-chart-1/25 bg-chart-1/8 px-3.5 py-3">
        <CalendarClock className="h-[18px] w-[18px] shrink-0 text-chart-1" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={cn('text-[13px] font-semibold tabular-nums', gap < 0 ? 'text-bad' : 'text-chart-1')}>
            Forecast finish Week {view.finishWeek}, {verdict}
          </p>
          {setter && (
            <p className="mt-0.5 truncate text-[12.5px] text-chart-1">
              Set by {setter.code} {setter.name}
            </p>
          )}
        </div>
        {n > 0 && (
          <m.button
            {...pressMotion}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-pressed={open}
            className={cn(
              'flex min-h-11 shrink-0 items-center justify-center rounded-xl border px-3.5 text-[13px] font-semibold tabular-nums transition-colors duration-200 ease-ios',
              open ? 'border-warn bg-warn text-card' : 'border-warn/30 bg-warn-soft text-warn hover:bg-warn/15'
            )}
          >
            {n} to check
          </m.button>
        )}
      </div>

      <Expand open={open}>
        {open && (
          <div className="mt-3 overflow-hidden rounded-xl border border-warn/30 bg-warn-soft">
            <p className="px-3.5 pb-2 pt-3 text-[13px] font-semibold text-warn">
              {n} {n === 1 ? 'activity needs' : 'activities need'} a look before the forecast can be trusted
            </p>
            <ul>
              {shown.map(({ leaf, reasons }) => {
                const { name } = splitCode(leaf.name);
                const tag = leaf.code;
                return (
                  <li key={leaf.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(leaf.id)}
                      className="flex min-h-12 w-full items-center gap-3 border-t border-warn/20 px-3.5 py-2.5 text-left transition-colors duration-200 ease-ios hover:bg-warn/10"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {tag && <CodeChip>{tag}</CodeChip>}
                          <span className="min-w-0 truncate text-[14px] font-medium text-foreground">{name}</span>
                        </span>
                        {reasons.map((r) => (
                          <span key={r} className="mt-0.5 block text-[12px] text-warn">
                            {r}
                          </span>
                        ))}
                      </span>
                      <span className="shrink-0 text-[13px] font-semibold text-warn">Open ›</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!all && n > ROWS && (
              <button
                type="button"
                onClick={() => setAll(true)}
                className="flex min-h-11 w-full items-center justify-center border-t border-warn/20 text-[13px] font-semibold text-warn transition-colors duration-200 ease-ios hover:bg-warn/10"
              >
                Show all {n}
              </button>
            )}
          </div>
        )}
      </Expand>
    </div>
  );
}
