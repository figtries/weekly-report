'use client';

import { m } from 'framer-motion';
import { Check, ListChecks, X } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { activityStrings, todayItemsOf, tomorrowItemsOf } from '@/lib/daily-items';
import type { ActivityItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { INPUT_CLS, TextField } from '../fields';
import { CardButton, SectionCard, type CardProps } from '../SectionCard';
import { newId, type LogDraft } from '../useDailyReport';

const has = (items: ActivityItem[], text: string) =>
  items.some((i) => i.text.trim().toLowerCase() === text.trim().toLowerCase());

export default function ActivitiesCard({
  report,
  commit,
  state,
  open,
  onToggle,
  onOpen,
  suggestions,
}: CardProps & { suggestions: string[] }) {
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

  const todaySuggest = suggestions.filter((s) => !has(today, s) && !has(tomorrow, s)).slice(0, 6);
  const unfinished = today.filter((i) => !i.done && !has(tomorrow, i.text));
  const tomorrowSuggest = suggestions.filter((s) => !has(tomorrow, s) && !has(today, s)).slice(0, 4);

  const chip = (text: string, onTap: () => void, key: string) => (
    <m.button
      key={key}
      type="button"
      {...pressMotion}
      onClick={onTap}
      className="min-h-11 max-w-full truncate rounded-lg border border-border bg-card px-3 text-left text-[13px] text-foreground transition-colors hover:bg-muted sm:min-h-9"
    >
      + {text}
    </m.button>
  );

  const list = (items: ActivityItem[], isToday: boolean) => (
    <div className="space-y-2">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
          {isToday && (
            <m.button
              type="button"
              {...pressMotion}
              role="checkbox"
              aria-checked={it.done}
              aria-label={`Done: ${it.text}`}
              onClick={() => tick(it)}
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-lg border transition-colors sm:size-9',
                it.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-border bg-card text-transparent'
              )}
            >
              <Check className="size-4" />
            </m.button>
          )}
          <TextField
            multiline
            label="Activity"
            value={it.text}
            onCommit={(v) => {
              const edit = (arr: ActivityItem[]) => arr.map((x) => (x.id === it.id ? { ...x, text: v } : x));
              if (isToday) save(edit(today), tomorrow);
              else save(today, edit(tomorrow));
            }}
          />
          <m.button
            type="button"
            {...pressMotion}
            aria-label={`Remove ${it.text}`}
            onClick={() =>
              isToday
                ? save(today.filter((x) => x.id !== it.id), tomorrow)
                : save(today, tomorrow.filter((x) => x.id !== it.id))
            }
            className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-bad sm:size-9"
          >
            <X className="size-4" />
          </m.button>
        </div>
      ))}
    </div>
  );

  return (
    <SectionCard
      id="activities"
      icon={<ListChecks className="size-[18px]" />}
      title="Daily Activities"
      summary={
        today.length || tomorrow.length
          ? `${done} of ${today.length} done · ${tomorrow.length} planned for tomorrow`
          : 'Nothing planned yet'
      }
      state={state}
      chipLabel={state === 'same' ? (unticked > 0 ? `${unticked} to tick` : 'To confirm') : undefined}
      open={open}
      onToggle={onToggle}
      actions={
        state === 'same' ? (
          <>
            <CardButton variant="default" onClick={() => commit({ confirmed: { activities: true } })}>
              Confirm
            </CardButton>
            <CardButton onClick={onOpen}>Tick and change</CardButton>
          </>
        ) : state === 'empty' ? (
          <CardButton variant="default" onClick={onOpen}>
            Add activity
          </CardButton>
        ) : undefined
      }
    >
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="h-2 w-2 rounded-full bg-chart-1" />
        Today
      </h3>
      {list(today, true)}
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Add a today activity"
          value={todayDraft}
          onChange={(e) => setTodayDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addToday(todayDraft)}
          placeholder="What was done today"
          className={INPUT_CLS}
        />
        <CardButton variant="default" className="flex-none px-4" onClick={() => addToday(todayDraft)}>
          Add
        </CardButton>
      </div>
      {todaySuggest.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">{todaySuggest.map((s) => chip(s, () => addToday(s), `t-${s}`))}</div>
      )}

      <h3 className="mb-2 mt-5 flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        Tomorrow
      </h3>
      {list(tomorrow, false)}
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Add a tomorrow activity"
          value={tomorrowDraft}
          onChange={(e) => setTomorrowDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTomorrow(tomorrowDraft)}
          placeholder="What is planned for tomorrow"
          className={INPUT_CLS}
        />
        <CardButton variant="default" className="flex-none px-4" onClick={() => addTomorrow(tomorrowDraft)}>
          Add
        </CardButton>
      </div>
      {(unfinished.length > 0 || tomorrowSuggest.length > 0) && (
        <div className="mt-2">
          {unfinished.length > 0 && (
            <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Not done yet today</p>
          )}
          <div className="flex flex-wrap gap-2">
            {unfinished.map((i) => chip(i.text, () => addTomorrow(i.text), `u-${i.id}`))}
            {tomorrowSuggest.map((s) => chip(s, () => addTomorrow(s), `m-${s}`))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
