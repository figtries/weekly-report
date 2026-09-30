'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { activityStrings, todayItemsOf, tomorrowItemsOf } from '@/lib/daily-items';
import { MOTION } from '@/lib/design';
import type { ActivityItem } from '@/lib/types';
import { CAPACITY } from '@/lib/xlsx/daily-cells';
import { cn } from '@/lib/utils';
import { INPUT_CLS, TextField } from '../fields';
import { CapacityNote, RowButton, SectionRow, sameHint, type SectionProps } from '../SectionRow';
import { newId, type LogDraft } from '../useDailyReport';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const has = (items: ActivityItem[], text: string) => items.some((i) => same(i.text, text));

interface Offer {
  text: string;
  /** Why it is offered when it is not simply from the previous report. */
  tag?: string;
}

/** "yesterday" when the earlier report is the day before, otherwise its date: a gap is not yesterday. */
function whenLabel(previousDate: string, date: string): string {
  const before = new Date(`${date}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 1);
  if (before.toISOString().slice(0, 10) === previousDate) return 'yesterday';
  return new Date(`${previousDate}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

const FADE = { duration: MOTION.duration * 0.7, ease: [...MOTION.ease] } as const;

/**
 * Sentences the previous report used, each one press from being taken or turned down:
 * an activity that repeats costs a tap instead of typing it again. A row leaves with a
 * short fade whichever way it goes, and the whole box folds away when the last one has.
 */
function Offers({
  which,
  label,
  offers,
  onAdd,
  onDismiss,
}: {
  which: 'today' | 'tomorrow';
  label: string;
  offers: Offer[];
  onAdd: (text: string) => void;
  onDismiss: (text: string) => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {offers.length > 0 && (
        <m.div
          key="offers"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={FADE}
          style={{ overflow: 'hidden' }}
        >
          <div data-offers={which} className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-3 pb-1 pt-2.5">
            <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
            <AnimatePresence initial={false}>
              {offers.map((o) => (
                <m.div
                  key={o.text.toLowerCase()}
                  exit={{ opacity: 0, height: 0 }}
                  transition={FADE}
                  style={{ overflow: 'hidden' }}
                >
                  <div className="flex items-center gap-2 border-t border-border/70 py-2 first:border-t-0">
                    <p className="min-w-0 flex-1 text-[13.5px] leading-snug text-foreground">
                      {o.text}
                      {o.tag && <span className="text-amber-700"> · {o.tag}</span>}
                    </p>
                    <RowButton aria-label={`Add ${o.text} to ${which}`} onClick={() => onAdd(o.text)}>
                      Add
                    </RowButton>
                    <m.button
                      type="button"
                      {...pressMotion}
                      aria-label={`Dismiss ${o.text} from ${which} suggestions`}
                      onClick={() => onDismiss(o.text)}
                      className="flex size-11 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-muted hover:text-foreground sm:size-8"
                    >
                      <X className="size-4" />
                    </m.button>
                  </div>
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

export default function ActivitiesSection({
  report,
  commit,
  state,
  open,
  onToggle,
  onOpen,
  hasPredecessor,
  previous,
}: SectionProps & { previous: { date: string; items: string[] } | null }) {
  const today = todayItemsOf(report);
  const tomorrow = tomorrowItemsOf(report);
  const [todayDraft, setTodayDraft] = useState('');
  const [tomorrowDraft, setTomorrowDraft] = useState('');
  const unticked = today.filter((i) => !i.done).length;
  const done = today.length - unticked;

  const save = (t: ActivityItem[], next: ActivityItem[], log?: LogDraft) =>
    commit({ todayItems: t, tomorrowItems: next, ...activityStrings(t, next) }, log);

  // What is added during the day is something DONE; what came from yesterday's plan waits to be ticked.
  // `fromDraft` clears the typing box: tapping a suggestion must not wipe half a sentence being typed.
  const addToday = (text: string, fromDraft = false) => {
    const v = text.trim();
    if (!v || has(today, v)) return;
    save([...today, { id: newId('at'), text: v, done: true }], tomorrow, { kind: 'activity', text: v });
    if (fromDraft) setTodayDraft('');
  };
  const addTomorrow = (text: string, fromDraft = false) => {
    const v = text.trim();
    if (!v || has(tomorrow, v)) return;
    save(today, [...tomorrow, { id: newId('am'), text: v, done: false }]);
    if (fromDraft) setTomorrowDraft('');
  };
  const tick = (it: ActivityItem) =>
    save(
      today.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)),
      tomorrow,
      it.done ? undefined : { kind: 'activity', text: it.text }
    );

  // A turned-down suggestion is remembered on the report, or it would be back after a reload.
  const dismissed = report.dismissedSuggestions ?? { today: [], tomorrow: [] };
  const turnedDown = (list: string[], text: string) => list.some((d) => same(d, text));
  const dismiss = (which: 'today' | 'tomorrow', text: string) =>
    commit({ dismissedSuggestions: { ...dismissed, [which]: [...dismissed[which], text] } });

  const fromPrevious = previous?.items ?? [];
  const todayOffers: Offer[] = fromPrevious
    .filter((s) => !has(today, s) && !turnedDown(dismissed.today, s))
    .map((text) => ({ text }));
  // Tomorrow: what is still open today comes first (it does not stop being work at midnight),
  // then what the previous report did.
  const openToday: Offer[] = today
    .filter((i) => !i.done && !has(tomorrow, i.text) && !turnedDown(dismissed.tomorrow, i.text))
    .map((i) => ({ text: i.text, tag: 'not done today' }));
  const tomorrowOffers: Offer[] = [
    ...openToday,
    ...fromPrevious
      .filter((s) => !has(tomorrow, s) && !turnedDown(dismissed.tomorrow, s) && !openToday.some((o) => same(o.text, s)))
      .map((text) => ({ text })),
  ];
  const when = previous ? whenLabel(previous.date, report.date) : '';
  const offerLabel = (offers: Offer[]) =>
    when && offers.some((o) => !o.tag) ? `Suggestions · same as ${when}` : 'Suggestions';

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

  const adder = (value: string, set: (v: string) => void, add: (v: string, fromDraft: boolean) => void, placeholder: string, label: string, primary: boolean) => (
    <div className="mt-2 flex gap-2">
      <input
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add(value, true)}
        placeholder={placeholder}
        className={INPUT_CLS}
      />
      <RowButton primary={primary} className="h-11 px-4 sm:h-9" onClick={() => add(value, true)}>
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
      <Offers which="today" label={offerLabel(todayOffers)} offers={todayOffers} onAdd={(t) => addToday(t)} onDismiss={(t) => dismiss('today', t)} />
      {adder(todayDraft, setTodayDraft, addToday, 'Add what was done…', 'Add a today activity', true)}
      <CapacityNote count={done} capacity={CAPACITY.activities} what="lines of what was done" />

      <p className="mb-1 mt-5 text-[12px] font-medium text-muted-foreground">Tomorrow</p>
      {list(tomorrow, false)}
      <Offers which="tomorrow" label={offerLabel(tomorrowOffers)} offers={tomorrowOffers} onAdd={(t) => addTomorrow(t)} onDismiss={(t) => dismiss('tomorrow', t)} />
      {adder(tomorrowDraft, setTomorrowDraft, addTomorrow, "Add tomorrow's plan…", 'Add a tomorrow activity', false)}
      <CapacityNote count={tomorrow.length} capacity={CAPACITY.activities} what="lines of tomorrow's plan" />
    </SectionRow>
  );
}
