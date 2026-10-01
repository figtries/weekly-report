'use client';

import { pressMotion } from '@/components/motion/Press';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { deleteDailyAction } from '@/lib/actions';
import { MOTION } from '@/lib/design';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import NewDailyButton from './NewDailyButton';

export type DailyListItem = {
  date: string;
  hariKe: number | null;
  /** The project's week and day this date falls in, computed from the plan; null with none. */
  week: number | null;
  day: number | null;
};

function fullDateLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export default function DailyReportsView({
  reports,
  defaultDate,
  weekLabels,
  thisWeek,
}: {
  reports: DailyListItem[];
  defaultDate: string;
  /**
   * "28 Sep to 4 Oct" per week number: every week of the plan up to this week, so
   * it is both the headings the days are grouped under and the filter's list.
   */
  weekLabels: Record<number, string>;
  /** Today's week of the plan, tagged "This week" in the filter. */
  thisWeek: number;
}) {
  const [selected, setSelected] = useState<number | 'all'>('all');

  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Deleted rows are hidden with real state, not useOptimistic: the refreshed
  // list can still arrive stale on Vercel (tag propagation races the action's
  // re-render), and optimistic state reverts once the transition settles —
  // popping the deleted row back until a manual reload. Real state keeps the
  // row hidden through a stale response; confirmDelete restores it on failure.
  const [deletedDates, setDeletedDates] = useState<string[]>([]);

  // Adjust-during-render (guarded): once the incoming list no longer contains
  // a hidden date the server has confirmed the delete, so the mask is dropped
  // — a report re-created for the same date can never be hidden by mistake.
  const stillListed = deletedDates.filter((date) => reports.some((r) => r.date === date));
  if (stillListed.length !== deletedDates.length) setDeletedDates(stillListed);

  const visible = reports.filter((r) => !deletedDates.includes(r.date));

  // The plan's weeks, newest first.
  const weeks = useMemo(
    () =>
      Object.keys(weekLabels)
        .map(Number)
        .sort((a, b) => b - a)
        .map((week) => ({ week, range: weekLabels[week] })),
    [weekLabels],
  );

  const filtered = selected === 'all' ? visible : visible.filter((r) => r.week === selected);

  /**
   * Whether the rows may carry framer-motion's `layout`.
   *
   * The threshold is the same ~20 the app uses for Radix, for the same reason:
   * the cost is per element, and it is paid on every change rather than once.
   * A week's seven days sit comfortably under it; "All" on a finished
   * project does not.
   */
  const animatedRows = filtered.length <= 20;
  const selectedLabel = selected === 'all' ? 'All weeks' : `Week ${selected}`;

  function confirmDelete() {
    const date = confirmDate;
    if (!date) return;
    setDeleteError(null);
    setConfirmDate(null); // close the dialog immediately — the row vanishes with it
    setDeletedDates((dates) => [...dates, date]);
    startDeleteTransition(async () => {
      let error: string | null = null;
      try {
        // On success the action refreshes the list in the same request.
        const res = await deleteDailyAction(date);
        if (!res.ok) error = res.error;
      } catch {
        error = 'Network error. Please try again';
      }
      if (error) {
        // The report is still there: bring its row back and say why.
        setDeletedDates((dates) => dates.filter((d) => d !== date));
        setDeleteError(error);
      }
    });
  }

  return (
    <>
      <div className="mb-5 sm:mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground mb-1 sm:mb-2">Daily Reports</h1>
          <p className="text-sm sm:text-base text-muted-foreground">Field man-hours, permits, HSE and daily activities</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <WeekDropdown
            weeks={weeks}
            thisWeek={thisWeek}
            selected={selected}
            label={selectedLabel}
            onSelect={setSelected}
          />
          <NewDailyButton defaultDate={defaultDate} />
        </div>
      </div>

      {deleteError && (
        <div className="mb-4 rounded-lg border border-bad/30 bg-bad-soft px-4 py-2.5 text-sm text-bad animate-fade-in-up">
          Could not delete the report: {deleteError}
        </div>
      )}

      <div className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
        {visible.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No daily reports yet. Create one above.</p>
        )}
        {visible.length > 0 && filtered.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No daily reports for {selectedLabel}.</p>
        )}
        <AnimatePresence initial={false} mode="popLayout">
        {filtered.map((d, idx) => (
          <m.div
            key={d.date}
            // `layout` is what makes the rows SLIDE to their new places when a
            // week is picked rather than jumping. It is also the expensive
            // prop — it measures every element carrying it on every change —
            // so it is gated on the list being short. This view holds a
            // project's whole daily history, and Gundih is 415 days: measuring
            // 415 rows on each filter change is exactly the jank this layer
            // was asked to remove, not add.
            layout={animatedRows}
            exit={{ opacity: 0 }}
            transition={MOTION.spring}
            className="transition-colors duration-150 ease-ios hover:bg-muted/60"
          >
            {/* The days are grouped by the week they fall in. The heading rides inside the
                first row of its week (not as a sibling), so every child of AnimatePresence
                stays a keyed motion element. */}
            {d.week !== null && d.week !== filtered[idx - 1]?.week && (
              <p className="bg-muted/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:px-6">
                Week {d.week}
                <span className="font-medium normal-case tracking-normal"> · {weekLabels[d.week]}</span>
              </p>
            )}
            {/* TWO ELEMENTS, ON PURPOSE. The arrival is a CSS keyframe on this
                inner div; the outer one owns `layout` and `exit`. Putting both
                on one element means CSS and framer-motion writing `transform`
                at the same time, and the row judders.

                The keyframe is also why the rows are visible at all before
                hydration. An `initial` prop here would be skipped on first
                mount by `AnimatePresence initial={false}` — which is what
                briefly cost this list its entrance entirely. */}
            <div
              className="flex items-center gap-2 px-4 animate-fade-in-up sm:px-6"
              style={{ animationDelay: `${Math.min(idx, 7) * 60}ms` }}
            >
            <Link
              href={`/daily/${d.date}`}
              className="flex min-w-0 flex-1 flex-col gap-1 py-3 sm:py-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{fullDateLabel(d.date)}</p>
                <p className="text-sm text-muted-foreground">Day {d.day ?? d.hariKe ?? '-'}</p>
              </div>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={`/daily/${d.date}`}
                aria-label={`Edit report for ${d.date}`}
                title="Edit report"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 ease-ios hover:bg-chart-1/10 hover:text-chart-1 active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.862 4.487zm0 0L19.5 7.125"
                  />
                </svg>
              </Link>
              <button
                onClick={() => {
                  setDeleteError(null);
                  setConfirmDate(d.date);
                }}
                aria-label={`Delete report for ${d.date}`}
                title="Delete report"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 ease-ios hover:bg-bad-soft hover:text-bad active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            </div>
            </div>
          </m.div>
        ))}
        </AnimatePresence>
      </div>

      <ConfirmDialog
        open={confirmDate !== null}
        title="Delete daily report"
        message={
          <p>
            Delete the report for{' '}
            <span className="font-medium text-foreground">{confirmDate ? fullDateLabel(confirmDate) : ''}</span>?
            This will also remove its photos and cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDate(null)}
      />
    </>
  );
}

function WeekDropdown({
  weeks,
  thisWeek,
  selected,
  label,
  onSelect,
}: {
  weeks: { week: number; range: string }[];
  thisWeek: number;
  selected: number | 'all';
  label: string;
  onSelect: (value: number | 'all') => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function close() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 110);
  }

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function choose(value: number | 'all') {
    onSelect(value);
    close();
  }

  return (
    <div ref={ref} className="relative w-38 min-w-0">
      <m.button {...pressMotion}
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3.5 py-2 text-sm font-medium text-foreground shadow-sm transition-colors duration-200 ease-ios hover:bg-muted/60 hover:shadow"
      >
        <svg className="h-4 w-4 text-muted-foreground" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="whitespace-nowrap">{label}</span>
        <svg
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open && !closing ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </m.button>

      {open && (
        <div
          className={`absolute inset-x-0 z-30 mt-2 max-h-[60vh] origin-top overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-1 shadow-xl ${
            closing ? 'animate-dropdown-out' : 'animate-dropdown-in'
          }`}
        >
          <WeekOption label="All weeks" active={selected === 'all'} onClick={() => choose('all')} />
          {weeks.length > 0 && <div className="mx-2 my-1 h-px bg-border" />}
          {weeks.map(({ week, range }) => (
            <WeekOption
              key={week}
              label={`Week ${week}`}
              range={range}
              current={week === thisWeek}
              active={selected === week}
              onClick={() => choose(week)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Two lines per week, the dates under the number, so every date starts at the same
 * edge whatever the width of "Week 9" or "Week 40". No count: the list is as wide as
 * its button, and the button already names the week being shown. This week is green
 * with a check, exactly as the weekly week picker (WeekSelect) marks the current week.
 */
function WeekOption({
  label,
  range,
  current = false,
  active,
  onClick,
}: {
  label: string;
  range?: string;
  current?: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={current ? 'Current week' : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm tabular-nums transition-colors active:scale-[0.98] ${
        current ? 'bg-ok-soft text-ok' : 'text-foreground hover:bg-muted/60 active:bg-muted/60'
      }`}
    >
      <span className="min-w-0 whitespace-nowrap">
        <span className={`block ${current ? 'font-semibold' : 'font-medium'}`}>{label}</span>
        {range && (
          <span className={`mt-0.5 block text-xs ${current ? 'text-ok/80' : 'text-muted-foreground'}`}>{range}</span>
        )}
      </span>
      {current && (
        <svg className="h-4 w-4 shrink-0 text-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}
