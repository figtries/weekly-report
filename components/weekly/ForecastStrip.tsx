'use client';

import { m } from 'framer-motion';
import { useState, useTransition } from 'react';
import { CalendarClock } from 'lucide-react';

import { linkEpcOrderAction } from '@/lib/actions';
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
 *
 * It is also where activities are LINKED, once, for the whole plan: EPC order
 * offers what each waits for, and one press takes every offer nobody has
 * answered (lib/forecast-epc.ts `unansweredLinks`). Until 27 Sep 2026 that was
 * a Confirm on every activity's panel, which nobody was going to press eleven
 * times, so the forecast ran without its links. The row leaves once it is done.
 */

const ROWS = 6;

export default function ForecastStrip({
  view,
  projectId,
  onOpen,
}: {
  view: ForecastView;
  projectId: string | null;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [linking, startLinking] = useTransition();
  const [linkError, setLinkError] = useState<string | null>(null);
  const link = () => {
    setLinkError(null);
    startLinking(async () => {
      const res = await linkEpcOrderAction(projectId);
      if (!res.ok) setLinkError(res.error ?? 'Could not link them');
    });
  };
  const gap = view.lastWeek - view.finishWeek;
  const verdict =
    gap === 0 ? 'on the contract end' : `${Math.abs(gap)} ${Math.abs(gap) === 1 ? 'week' : 'weeks'} ${gap > 0 ? 'early' : 'late'}`;
  const setter = view.path[view.path.length - 1];
  const shown = all ? view.toCheck : view.toCheck.slice(0, ROWS);
  const n = view.toCheck.length;

  return (
    <div className="mt-3">
      <div className="rounded-xl border border-chart-1/25 bg-chart-1/8 px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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

        {view.unlinked > 0 && (
          <div className="mt-3.5 flex items-center gap-3 border-t border-chart-1/20 pt-3.5">
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-chart-1">
              Link activities in EPC order, so a late delivery moves what waits for it.
            </p>
            <m.button
              {...pressMotion}
              type="button"
              disabled={linking}
              onClick={link}
              className="flex min-h-11 shrink-0 items-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-colors duration-200 ease-ios hover:bg-primary/90 disabled:opacity-60"
            >
              {linking ? 'Linking…' : 'Link'}
            </m.button>
          </div>
        )}
        {linkError && <p className="mt-2 text-[12.5px] text-bad">{linkError}</p>}
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
