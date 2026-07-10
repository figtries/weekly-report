'use client';

import Link from 'next/link';
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import { deleteDailyAction } from '@/lib/actions';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import NewDailyButton from './NewDailyButton';

export type DailyListItem = {
  date: string;
  hariKe: number | null;
  planPct: number;
  actualPct: number;
};

function monthKey(date: string): string {
  return date.slice(0, 7); // YYYY-MM
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

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
}: {
  reports: DailyListItem[];
  defaultDate: string;
}) {
  const months = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of reports) {
      const k = monthKey(r.date);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [reports]);

  const [selected, setSelected] = useState<string>('all');

  const [confirmDate, setConfirmDate] = useState<string | null>(null);
  const [, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Rows disappear the moment the user confirms; the server list arriving via
  // the action's redirect confirms it, and on failure the row pops back.
  const [hiddenDates, hideDate] = useOptimistic<string[], string>([], (dates, date) => [...dates, date]);

  const visible = reports.filter((r) => !hiddenDates.includes(r.date));
  const filtered = selected === 'all' ? visible : visible.filter((r) => monthKey(r.date) === selected);
  const selectedLabel = selected === 'all' ? 'All months' : monthLabel(selected);

  function confirmDelete() {
    const date = confirmDate;
    if (!date) return;
    setDeleteError(null);
    setConfirmDate(null); // close the dialog immediately — the row vanishes optimistically
    startDeleteTransition(async () => {
      hideDate(date);
      // On success the action redirects back to /daily (in-place refresh here).
      const res = await deleteDailyAction(date);
      if (res && !res.ok) setDeleteError(res.error);
    });
  }

  return (
    <>
      <div className="mb-5 sm:mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 mb-1 sm:mb-2">Daily Reports</h1>
          <p className="text-sm sm:text-base text-gray-600">Field man-hours, PTW, HSE and daily progress</p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <MonthDropdown
            months={months}
            total={reports.length}
            selected={selected}
            label={selectedLabel}
            onSelect={setSelected}
          />
          <NewDailyButton defaultDate={defaultDate} />
        </div>
      </div>

      {deleteError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 animate-fade-in-up">
          Could not delete the report: {deleteError}
        </div>
      )}

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
        {visible.length === 0 && (
          <p className="p-6 text-sm text-gray-500">No daily reports yet — create one above.</p>
        )}
        {visible.length > 0 && filtered.length === 0 && (
          <p className="p-6 text-sm text-gray-500">No daily reports for {selectedLabel}.</p>
        )}
        {filtered.map((d, idx) => (
          <div
            key={d.date}
            className="flex items-center gap-2 px-4 sm:px-6 transition-all duration-300 ease-ios hover:bg-gray-50 animate-fade-in-up"
            style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
          >
            <Link
              href={`/daily/${d.date}`}
              className="flex min-w-0 flex-1 flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:py-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{fullDateLabel(d.date)}</p>
                <p className="text-sm text-gray-500">Day {d.hariKe ?? '-'}</p>
              </div>
              <p className="text-sm text-gray-500 sm:pr-4">
                Plan {d.planPct.toFixed(0)}% · Actual {d.actualPct.toFixed(0)}%
              </p>
            </Link>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                href={`/daily/${d.date}`}
                aria-label={`Edit report for ${d.date}`}
                title="Edit report"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all duration-200 ease-ios hover:bg-blue-50 hover:text-blue-600 active:scale-95"
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
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-all duration-200 ease-ios hover:bg-red-50 hover:text-red-600 active:scale-95"
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
        ))}
      </div>

      <ConfirmDialog
        open={confirmDate !== null}
        title="Delete daily report"
        message={
          <p>
            Delete the report for{' '}
            <span className="font-medium text-gray-700">{confirmDate ? fullDateLabel(confirmDate) : ''}</span>?
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

function MonthDropdown({
  months,
  total,
  selected,
  label,
  onSelect,
}: {
  months: [string, number][];
  total: number;
  selected: string;
  label: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  function close() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 140);
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

  function choose(value: string) {
    onSelect(value);
    close();
  }

  return (
    <div ref={ref} className="relative flex-1 sm:flex-none">
      <button
        onClick={() => (open ? close() : setOpen(true))}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-300 ease-ios hover:bg-gray-50 hover:shadow active:scale-[0.97] sm:w-auto sm:justify-start"
      >
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="whitespace-nowrap">{label}</span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open && !closing ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute left-0 z-30 mt-2 w-56 origin-top-left overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl ${
            closing ? 'animate-dropdown-out' : 'animate-dropdown-in'
          }`}
        >
          <MonthOption label="All months" count={total} active={selected === 'all'} onClick={() => choose('all')} />
          {months.length > 0 && <div className="my-1 h-px bg-gray-100" />}
          {months.map(([key, count]) => (
            <MonthOption
              key={key}
              label={monthLabel(key)}
              count={count}
              active={selected === key}
              onClick={() => choose(key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthOption({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span className="flex items-center gap-2">
        <svg
          className={`h-4 w-4 ${active ? 'text-blue-600' : 'text-transparent'}`}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {label}
      </span>
      <span className={active ? 'text-blue-400' : 'text-gray-400'}>{count}</span>
    </button>
  );
}
