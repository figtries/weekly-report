'use client';

import { m } from 'framer-motion';
import { Check, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { activityStrings, todayItemsOf, tomorrowItemsOf } from '@/lib/daily-items';
import type { ActivityItem } from '@/lib/types';
import { CAPACITY } from '@/lib/xlsx/daily-cells';
import { cn } from '@/lib/utils';
import { INPUT_CLS, TextField } from '../fields';
import { CapacityNote, RowButton, SectionRow, type SectionProps } from '../SectionRow';
import { newId, type LogDraft } from '../useDailyReport';

const has = (items: ActivityItem[], text: string) =>
  items.some((i) => i.text.trim().toLowerCase() === text.trim().toLowerCase());

/** An amber line under a list that is still missing something: said where it is fixed. */
function Warn({ children }: { children: string }) {
  return (
    <p role="alert" className="animate-fade-in-up mt-2 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] font-medium leading-snug text-amber-700">
      <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/**
 * Two lists. "Tomorrow" is the plan: the next report shows it as its "Today", unticked,
 * whichever of the two days was made first (`withPlan`). No Confirm: the part is ready
 * when something done today is ticked and tomorrow has a plan, and says what is missing.
 */
export default function ActivitiesSection({ report, commit, state, open, onToggle }: SectionProps) {
  const today = todayItemsOf(report);
  const tomorrow = tomorrowItemsOf(report);
  const [todayDraft, setTodayDraft] = useState('');
  const [tomorrowDraft, setTomorrowDraft] = useState('');
  const done = today.filter((i) => i.done).length;
  const declined = report.declinedPlan ?? [];

  const save = (t: ActivityItem[], next: ActivityItem[], log?: LogDraft, decline?: string) =>
    commit(
      {
        todayItems: t,
        tomorrowItems: next,
        ...activityStrings(t, next),
        // A planned item taken off today stays off: the plan would otherwise put it back.
        ...(decline ? { declinedPlan: [...declined, decline] } : {}),
      },
      log
    );

  // What is added during the day is something DONE; what came from yesterday's plan waits to be ticked.
  const addToday = (text: string) => {
    const v = text.trim();
    if (!v || has(today, v)) return;
    save([...today, { id: newId('at'), text: v, done: true }], tomorrow, { kind: 'activity', text: v });
    setTodayDraft('');
  };
  const addTomorrow = (text: string) => {
    const v = text.trim();
    if (!v || has(tomorrow, v)) return;
    save(today, [...tomorrow, { id: newId('am'), text: v, done: false }]);
    setTomorrowDraft('');
  };
  const tick = (it: ActivityItem) =>
    save(
      today.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)),
      tomorrow,
      it.done ? undefined : { kind: 'activity', text: it.text }
    );

  const todayWarn =
    today.length === 0
      ? 'Nothing added for today yet. Type what was done and press Add.'
      : done === 0
        ? 'Nothing ticked yet. Tick what was done today: only ticked work goes in the report.'
        : null;
  const tomorrowWarn = tomorrow.length === 0 ? "No plan for tomorrow yet. Type it and press Add." : null;

  const missing = [
    today.length === 0 ? 'Nothing added for today' : done === 0 ? 'Nothing ticked yet' : '',
    tomorrow.length === 0 ? 'No plan for tomorrow' : '',
  ].filter(Boolean);

  const list = (items: ActivityItem[], isToday: boolean) => (
    <div>
      {items.map((it) => (
        <div key={it.id} className="flex items-start gap-1 py-0.5">
          <m.button
            type="button"
            {...pressMotion}
            role="checkbox"
            aria-checked={isToday ? it.done : false}
            aria-label={isToday ? `Done: ${it.text}` : `Planned: ${it.text}`}
            disabled={!isToday}
            onClick={() => isToday && tick(it)}
            className="-ml-2 flex size-11 shrink-0 items-center justify-center sm:-ml-1.5 sm:size-9"
          >
            <span
              className={cn(
                'flex size-[22px] items-center justify-center rounded-full border-2 text-white transition-all duration-300 ease-ios',
                isToday
                  ? it.done
                    ? 'border-emerald-500 bg-emerald-500'
                    : 'border-gray-300 bg-card'
                  : 'border-dashed border-gray-300 bg-card'
              )}
            >
              <Check className={cn('size-3.5 transition-opacity duration-200', isToday && it.done ? 'opacity-100' : 'opacity-0')} strokeWidth={3} />
            </span>
          </m.button>
          <div className="min-w-0 flex-1">
            <TextField
              bare
              multiline
              label="Activity"
              value={it.text}
              className={cn('text-[14px] leading-snug', isToday && it.done && 'text-muted-foreground')}
              onCommit={(v) => {
                if (!isToday) return save(today, tomorrow.map((x) => (x.id === it.id ? { ...x, text: v } : x)));
                // Rewording a planned item makes it this day's own, and the old wording stays off.
                const edited = today.map((x) => (x.id === it.id ? { ...x, text: v, fromPlan: undefined } : x));
                save(edited, tomorrow, undefined, it.fromPlan ? it.text : undefined);
              }}
            />
          </div>
          <m.button
            type="button"
            {...pressMotion}
            aria-label={`Remove ${it.text}`}
            onClick={() =>
              isToday
                ? save(today.filter((x) => x.id !== it.id), tomorrow, undefined, it.fromPlan ? it.text : undefined)
                : save(today, tomorrow.filter((x) => x.id !== it.id))
            }
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors duration-200 hover:text-bad sm:size-9"
          >
            <X className="size-4" />
          </m.button>
        </div>
      ))}
    </div>
  );

  const adder = (
    value: string,
    set: (v: string) => void,
    add: (v: string) => void,
    placeholder: string,
    label: string,
    primary: boolean,
    warn: boolean
  ) => (
    <div className="mt-2 flex gap-2">
      <input
        aria-label={label}
        aria-invalid={warn || undefined}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add(value)}
        placeholder={placeholder}
        className={cn(INPUT_CLS, warn && !value && 'border-amber-400 bg-amber-50/40')}
      />
      <RowButton primary={primary} className="h-11 px-4 sm:h-9" onClick={() => add(value)}>
        Add
      </RowButton>
    </div>
  );

  return (
    <SectionRow
      id="activities"
      title="Daily activities"
      summary={
        state === 'look'
          ? missing.join(' · ')
          : `${done} of ${today.length} done · ${tomorrow.length} planned for tomorrow`
      }
      state={state}
      open={open}
      onToggle={onToggle}
    >
      <p className="mb-1 text-[12px] font-medium text-muted-foreground">Today</p>
      {list(today, true)}
      {adder(todayDraft, setTodayDraft, addToday, 'Add what was done…', 'Add a today activity', true, today.length === 0)}
      {todayWarn && <Warn>{todayWarn}</Warn>}
      <CapacityNote count={done} capacity={CAPACITY.activities} what="lines of what was done" />

      <p className="mb-1 mt-5 text-[12px] font-medium text-muted-foreground">Tomorrow</p>
      {list(tomorrow, false)}
      {adder(tomorrowDraft, setTomorrowDraft, addTomorrow, "Add tomorrow's plan…", 'Add a tomorrow activity', false, !!tomorrowWarn)}
      {tomorrowWarn ? (
        <Warn>{tomorrowWarn}</Warn>
      ) : (
        <p className="mt-2 text-[12px] leading-snug text-gray-400">
          Tomorrow&apos;s report shows this plan as its Today list, ready to tick.
        </p>
      )}
      <CapacityNote count={tomorrow.length} capacity={CAPACITY.activities} what="lines of tomorrow's plan" />
    </SectionRow>
  );
}
