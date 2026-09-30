'use client';

import { m } from 'framer-motion';
import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { activityStrings, todayItemsOf, tomorrowItemsOf } from '@/lib/daily-items';
import type { ActivityItem } from '@/lib/types';
import { CAPACITY } from '@/lib/xlsx/daily-cells';
import { cn } from '@/lib/utils';
import { INPUT_CLS, TextField } from '../fields';
import { CapacityNote, RowButton, SectionRow, sameHint, type SectionProps } from '../SectionRow';
import { newId, type LogDraft } from '../useDailyReport';

const has = (items: ActivityItem[], text: string) =>
  items.some((i) => i.text.trim().toLowerCase() === text.trim().toLowerCase());

export default function ActivitiesSection({
  report,
  commit,
  state,
  open,
  onToggle,
  onOpen,
  hasPredecessor,
  suggestions,
}: SectionProps & { suggestions: string[] }) {
  const today = todayItemsOf(report);
  const tomorrow = tomorrowItemsOf(report);
  const [todayDraft, setTodayDraft] = useState('');
  const [tomorrowDraft, setTomorrowDraft] = useState('');
  const unticked = today.filter((i) => !i.done).length;
  const done = today.length - unticked;

  const save = (t: ActivityItem[], next: ActivityItem[], log?: LogDraft) =>
    commit({ todayItems: t, tomorrowItems: next, ...activityStrings(t, next) }, log);

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

  const todaySuggest = suggestions.filter((s) => !has(today, s) && !has(tomorrow, s)).slice(0, 5);
  const unfinished = today.filter((i) => !i.done && !has(tomorrow, i.text));
  const tomorrowSuggest = suggestions.filter((s) => !has(tomorrow, s) && !has(today, s)).slice(0, 3);

  const chip = (text: string, onTap: () => void, key: string) => (
    <m.button
      key={key}
      type="button"
      {...pressMotion}
      onClick={onTap}
      className="inline-flex min-h-11 max-w-full items-center gap-1 truncate rounded-lg border border-border bg-card px-2.5 text-left text-[12.5px] text-gray-600 transition-colors duration-200 hover:bg-muted sm:min-h-8"
    >
      <Plus className="size-3 shrink-0 text-gray-400" />
      <span className="truncate">{text}</span>
    </m.button>
  );

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
                const edit = (arr: ActivityItem[]) => arr.map((x) => (x.id === it.id ? { ...x, text: v } : x));
                if (isToday) save(edit(today), tomorrow);
                else save(today, edit(tomorrow));
              }}
            />
          </div>
          <m.button
            type="button"
            {...pressMotion}
            aria-label={`Remove ${it.text}`}
            onClick={() =>
              isToday ? save(today.filter((x) => x.id !== it.id), tomorrow) : save(today, tomorrow.filter((x) => x.id !== it.id))
            }
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-300 transition-colors duration-200 hover:text-bad sm:size-9"
          >
            <X className="size-4" />
          </m.button>
        </div>
      ))}
    </div>
  );

  const adder = (value: string, set: (v: string) => void, add: (v: string) => void, placeholder: string, label: string, primary: boolean) => (
    <div className="mt-2 flex gap-2">
      <input
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add(value)}
        placeholder={placeholder}
        className={INPUT_CLS}
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
        today.length || tomorrow.length
          ? `${done} of ${today.length} done · ${tomorrow.length} planned for tomorrow`
          : 'Nothing planned yet'
      }
      hint={state === 'same' ? (unticked > 0 ? `${unticked} to tick` : sameHint(hasPredecessor)) : undefined}
      state={state}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <RowButton onClick={() => commit({ confirmed: { activities: true } })}>Confirm</RowButton>
        ) : state === 'empty' ? (
          <RowButton onClick={onOpen}>Add</RowButton>
        ) : undefined
      }
    >
      <p className="mb-1 text-[12px] font-medium text-muted-foreground">Today</p>
      {list(today, true)}
      {adder(todayDraft, setTodayDraft, addToday, 'Add what was done…', 'Add a today activity', true)}
      {todaySuggest.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1.5">{todaySuggest.map((s) => chip(s, () => addToday(s), `t-${s}`))}</div>}
      <CapacityNote count={done} capacity={CAPACITY.activities} what="lines of what was done" />

      <p className="mb-1 mt-5 text-[12px] font-medium text-muted-foreground">Tomorrow</p>
      {list(tomorrow, false)}
      {adder(tomorrowDraft, setTomorrowDraft, addTomorrow, "Add tomorrow's plan…", 'Add a tomorrow activity', false)}
      {(unfinished.length > 0 || tomorrowSuggest.length > 0) && (
        <div className="mt-2.5">
          {unfinished.length > 0 && <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Not done yet today</p>}
          <div className="flex flex-wrap gap-1.5">
            {unfinished.map((i) => chip(i.text, () => addTomorrow(i.text), `u-${i.id}`))}
            {tomorrowSuggest.map((s) => chip(s, () => addTomorrow(s), `m-${s}`))}
          </div>
        </div>
      )}
      <CapacityNote count={tomorrow.length} capacity={CAPACITY.activities} what="lines of tomorrow's plan" />
    </SectionRow>
  );
}
