'use client';

import { m } from 'framer-motion';
import { useState, useTransition } from 'react';
import { CalendarClock, Link2 } from 'lucide-react';

import { setLeafForecastAction, setWaitsForAction } from '@/lib/actions';
import type { ForecastLeafView, LinkRef, WaitRef } from '@/lib/forecast-view';
import DateField from '@/components/ui/DateField';
import CodeChip from '@/components/ui/CodeChip';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';

/**
 * The forecast, for ONE activity, inside its panel. One card: when it
 * finishes, drawn as the app draws every figure (blue forecast over a thin red
 * plan, on one scale) so late or early reads before a word does; one sentence
 * saying why; then the two things only a person can tell it: the next
 * stage's date, and what has to finish before this one.
 *
 * Nothing else, on purpose (28 Sep 2026). Up to four warning boxes above the
 * card made the panel hard going for somebody who came to fill in a figure;
 * the findings are listed once, over the map ("to check"). Links are made
 * HERE, one activity at a time, by the planner: a one-press "Link" for the
 * whole plan was built and removed the same day, because nobody could see
 * what it had done.
 *
 * Every figure here was worked out on the server (lib/forecast-view.ts). This
 * component decides nothing; it shows, and it asks. Nothing changes without a
 * press: the date is read-only until "Add date" or "Change", then Save or
 * Cancel, the same way a budget is changed, and the panel's own Save at the
 * foot is left to the progress figure it has always meant.
 *
 * Native inputs in the picker: it can run to every activity in the plan.
 */

type Source = 'vendor' | 'site' | 'client';
const SOURCES: Array<{ id: Source; label: string }> = [
  { id: 'vendor', label: 'Vendor' },
  { id: 'site', label: 'Site' },
  { id: 'client', label: 'Client' },
];
const SAYS: Record<Source, string> = { vendor: 'Vendor says', site: 'Site says', client: 'Client says' };
const SAID: Record<Source, string> = { vendor: 'The vendor says', site: 'Site says', client: 'The client says' };

const MS_PER_DAY = 86_400_000;
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const dayOf = (iso: string) => Math.round(utc(iso) / MS_PER_DAY);
const wk = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;

/** "8 Feb 27", the panel's own short date. */
function shortDate(iso: string) {
  return new Date(utc(iso)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });
}

/** How far a given date sits from the plan's, in whole weeks, in words. */
function againstPlan(date: string, plan: string) {
  const weeks = Math.round((utc(date) - utc(plan)) / MS_PER_DAY / 7);
  if (weeks === 0) return 'on plan';
  return `${wk(Math.abs(weeks))} ${weeks > 0 ? 'after' : 'before'} plan`;
}

/** "W59 to W62", or one week when it starts and ends in it. */
const span = (from: number, to: number) => (to > from ? `W${from} to W${to}` : `W${to}`);

/** The one sentence under the bars: why the finish is what it is. */
function why(view: ForecastLeafView): string {
  const r = view.reason;
  switch (r.kind) {
    case 'done':
      return `Reached 100% in week ${view.finishWeek}.`;
    case 'typed': {
      const t = view.typed;
      if (!t) return 'From a date someone gave.';
      return t.label === 'Finish'
        ? `${SAID[t.source]} it finishes by ${shortDate(t.date)}.`
        : `${SAID[t.source]} ${t.label} is done by ${shortDate(t.date)}.`;
    }
    case 'measured':
      return 'At the pace of the quantity done so far.';
    case 'pushed':
      return `Pushed ${wk(r.weeks)}, because ${r.by.code} ${r.by.name} is late.`;
    case 'behind':
      return 'Behind its plan, so what is left is counted from this week.';
    case 'plan':
      return 'Nobody has given a date yet, so it follows the plan.';
  }
}

const pill =
  'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-colors duration-200 ease-ios';
const pillPrimary = cn(pill, 'bg-primary/6 text-primary hover:bg-primary hover:text-primary-foreground active:bg-primary/85 active:text-primary-foreground');
const pillQuiet = cn(pill, 'text-muted-foreground hover:bg-muted');
const chip = 'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums';

export default function ForecastBlock({
  leafId,
  view,
  options,
  week,
  projectId,
}: {
  leafId: string;
  view: ForecastLeafView;
  /** Every scheduled activity, in plan order, for the picker. */
  options: LinkRef[];
  week: number;
  projectId: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // One editor open at a time; `null` is reading.
  const [editing, setEditing] = useState<'date' | 'links' | null>(null);
  const next = view.next;
  const typedHere = view.typed && next && view.typed.rungId === next.rungId ? view.typed : null;
  const [date, setDate] = useState(typedHere?.date ?? next?.planDate ?? '');
  const [source, setSource] = useState<Source>(typedHere?.source ?? 'vendor');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const offering = !view.answered && view.suggested.length > 0;
  const suggestedIds = new Set(view.suggested.map((l) => l.id));

  function run(write: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await write();
      if (!res.ok) return setError(res.error ?? 'Could not save');
      setEditing(null);
    });
  }

  const saveDate = () =>
    next && date && run(() => setLeafForecastAction(leafId, { date, source, rungId: next.rungId }, week, projectId));
  const backToPlan = () => run(() => setLeafForecastAction(leafId, null, week, projectId));
  const saveLinks = (ids: string[]) => run(() => setWaitsForAction(leafId, ids, projectId));

  // Blue forecast over a thin red plan, on one scale: from whichever comes
  // first to whichever ends last.
  const ps = dayOf(view.planStart);
  const pf = dayOf(view.planFinish);
  const ff = dayOf(view.finish);
  const lo = Math.min(ps, ff);
  const range = Math.max(pf, ff) - lo + 1;
  const widthOf = (from: number, to: number) => `${(Math.max(0, to - from + 1) / range) * 100}%`;

  const done = view.basis === 'done';
  const gap = view.finishWeek - view.planFinishWeek;
  const verdict = done
    ? { label: 'Done', tone: 'bg-emerald-100 text-emerald-700' }
    : gap === 0
      ? { label: 'On plan', tone: 'bg-emerald-100 text-emerald-700' }
      : gap < 0
        ? { label: `${-gap} wk early`, tone: 'bg-emerald-100 text-emerald-700' }
        : { label: `${gap} wk late`, tone: 'bg-red-100 text-red-700' };

  return (
    <section aria-label="Forecast" className="mt-5 space-y-3">
      <div className="rounded-2xl border border-input bg-card px-4 py-4">
        {/* The finish. */}
        <div className="flex items-center gap-2">
          <p className="flex-1 text-[12px] text-muted-foreground">Forecast finish</p>
          {view.onPath && <span className={cn(chip, 'bg-chart-1/10 text-chart-1')}>Sets the project finish</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[22px] font-semibold tabular-nums tracking-tight text-foreground">
            Week {view.finishWeek}
            <span className="ml-2 text-[13px] font-normal tracking-normal text-muted-foreground">{shortDate(view.finish)}</span>
          </p>
          <span className={cn(chip, verdict.tone)}>{verdict.label}</span>
        </div>

        <div className="relative mt-4 h-[13px]" aria-hidden="true">
          <div
            className="absolute left-0 top-0 h-2 min-w-1.5 rounded-full bg-chart-1"
            style={{ marginLeft: `${((Math.min(ps, ff) - lo) / range) * 100}%`, width: widthOf(Math.min(ps, ff), ff) }}
          />
          <div
            className="absolute left-0 top-[10px] h-[3px] rounded-full bg-chart-2"
            style={{ marginLeft: `${((ps - lo) / range) * 100}%`, width: widthOf(ps, pf) }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 text-[11.5px] tabular-nums">
          <span className="text-chart-1">
            {done ? `Done W${view.finishWeek}` : `Forecast ${span(Math.min(view.planStartWeek, view.finishWeek), view.finishWeek)}`}
          </span>
          <span className="text-chart-2">Plan {span(view.planStartWeek, view.planFinishWeek)}</span>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-foreground">{why(view)}</p>

        {/* The next stage's date: the one thing that moves this without a guess. */}
        {next && (
          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="flex items-center gap-3">
              <CalendarClock className="h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-muted-foreground">{next.rungId ? `Next: ${next.label}` : 'Finish'}</p>
                <p className="mt-0.5 text-[14px] font-medium text-foreground">
                  {typedHere ? `${SAYS[typedHere.source]} ${shortDate(typedHere.date)}` : `Plan ${shortDate(next.planDate)}`}
                </p>
                {typedHere && (
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Plan {shortDate(next.planDate)} · {againstPlan(typedHere.date, next.planDate)}
                  </p>
                )}
              </div>
              {editing !== 'date' && (
                <m.button
                  {...pressMotion}
                  type="button"
                  onClick={() => {
                    // From what stands now, not from whatever was typed last time.
                    setDate(typedHere?.date ?? next.planDate);
                    setSource(typedHere?.source ?? 'vendor');
                    setEditing('date');
                  }}
                  className={pillPrimary}
                >
                  {typedHere ? 'Change' : 'Add date'}
                </m.button>
              )}
            </div>

            {editing === 'date' && (
              <div className="mt-4 space-y-3">
                <DateField
                  value={date}
                  onChange={setDate}
                  className="h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3.5 text-[14px] transition-colors hover:border-foreground/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                />
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Who gave the date">
                  {SOURCES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="radio"
                      aria-checked={source === s.id}
                      onClick={() => setSource(s.id)}
                      className={cn(
                        'min-h-11 rounded-xl border text-[13px] font-medium transition-colors duration-200 ease-ios',
                        source === s.id ? 'border-chart-1 bg-chart-1/10 text-chart-1' : 'border-input bg-card text-foreground hover:bg-muted/60'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {typedHere && (
                    <button type="button" disabled={pending} onClick={backToPlan} className={cn(pillQuiet, 'mr-auto')}>
                      Back to plan
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing(null)} className={cn(pillQuiet, !typedHere && 'ml-auto')}>
                    Cancel
                  </button>
                  <m.button {...pressMotion} type="button" disabled={!date || pending} onClick={saveDate} className={cn(pillPrimary, 'disabled:opacity-40')}>
                    {pending ? 'Saving…' : 'Save'}
                  </m.button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* What has to finish before this one. The planner's answer, never the
            app's: EPC order only suggests, and "Use these" is still a press.
            The question is the label and one plain sentence says what the
            answer does, because "Waits for" alone was a term people had to
            have explained to them (28 Sep 2026). */}
        <div className="mt-4 border-t border-border/60 pt-4">
          <div className="flex items-start gap-3">
            <Link2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-foreground">What has to finish before this one?</p>
              {/* While picking, the picker's own line explains; one sentence at a time. */}
              <p className={cn('mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground', editing === 'links' && 'hidden')}>
                {view.waitsFor.length
                  ? 'If one of these runs late, this activity moves with it.'
                  : view.answered
                    ? 'Nothing. It does not wait for another activity.'
                    : offering
                      ? 'Not answered yet. By EPC order it looks like:'
                      : 'Not answered yet.'}
              </p>

              {(view.waitsFor.length > 0 || offering) && editing !== 'links' && (
                <ul className="mt-3 space-y-2.5">
                  {(view.waitsFor.length ? view.waitsFor : view.suggested).map((l: LinkRef & Partial<WaitRef>) => (
                    <li key={l.id} className="flex items-center gap-2 text-[13px] leading-snug text-foreground">
                      {l.code && <CodeChip>{l.code}</CodeChip>}
                      <span className="line-clamp-2 min-w-0 flex-1 break-words">{l.name}</span>
                      {l.state && (
                        <span className={cn(chip, l.state === 'late' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700')}>
                          {l.state === 'late' ? `${l.lateWeeks} wk late` : l.state === 'done' ? 'Done' : 'On plan'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {editing !== 'links' && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {offering && (
                    <m.button
                      {...pressMotion}
                      type="button"
                      disabled={pending}
                      onClick={() => saveLinks(view.suggested.map((l) => l.id))}
                      className={cn(pill, 'bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60')}
                    >
                      {pending ? 'Saving…' : 'Use these'}
                    </m.button>
                  )}
                  <m.button
                    {...pressMotion}
                    type="button"
                    onClick={() => {
                      setPicked(new Set((view.answered ? view.waitsFor : view.suggested).map((l) => l.id)));
                      setEditing('links');
                    }}
                    className={pillPrimary}
                  >
                    {view.answered ? 'Change' : 'Choose'}
                  </m.button>
                </div>
              )}
            </div>
          </div>

          {editing === 'links' && (
            <div className="mt-4">
              <p className="mb-2 text-[12.5px] leading-relaxed text-foreground">
                Tick what has to finish first. Leave them all unticked if it waits for nothing.
              </p>
              <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl border border-border/60 p-1">
                {options
                  .filter((o) => o.id !== leafId)
                  .map((o) => (
                    <li key={o.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 hover:bg-muted/60">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-[var(--chart-1)]"
                          checked={picked.has(o.id)}
                          onChange={(e) =>
                            setPicked((prev) => {
                              const nextSet = new Set(prev);
                              if (e.target.checked) nextSet.add(o.id);
                              else nextSet.delete(o.id);
                              return nextSet;
                            })
                          }
                        />
                        {o.code && <CodeChip>{o.code}</CodeChip>}
                        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{o.name}</span>
                        {suggestedIds.has(o.id) && <span className={cn(chip, 'bg-chart-1/10 text-chart-1')}>Suggested</span>}
                      </label>
                    </li>
                  ))}
              </ul>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(null)} className={pillQuiet}>
                  Cancel
                </button>
                <m.button
                  {...pressMotion}
                  type="button"
                  disabled={pending}
                  onClick={() => saveLinks(options.filter((o) => picked.has(o.id)).map((o) => o.id))}
                  className={cn(pillPrimary, 'disabled:opacity-40')}
                >
                  {pending ? 'Saving…' : 'Save'}
                </m.button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <p className="animate-fade-in-up rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
    </section>
  );
}
