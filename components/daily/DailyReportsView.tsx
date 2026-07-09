'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const filtered = selected === 'all' ? reports : reports.filter((r) => monthKey(r.date) === selected);
  const selectedLabel = selected === 'all' ? 'All months' : monthLabel(selected);

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

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
        {reports.length === 0 && (
          <p className="p-6 text-sm text-gray-500">No daily reports yet — create one above.</p>
        )}
        {reports.length > 0 && filtered.length === 0 && (
          <p className="p-6 text-sm text-gray-500">No daily reports for {selectedLabel}.</p>
        )}
        {filtered.map((d, idx) => (
          <Link
            key={d.date}
            href={`/daily/${d.date}`}
            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4 transition-all duration-300 ease-ios hover:bg-gray-50 active:bg-gray-100 animate-fade-in-up"
            style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}
          >
            <div>
              <p className="font-medium text-gray-900">
                {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </p>
              <p className="text-sm text-gray-500">Day {d.hariKe ?? '-'}</p>
            </div>
            <p className="text-sm text-gray-500">
              Plan {d.planPct.toFixed(0)}% · Actual {d.actualPct.toFixed(0)}%
            </p>
          </Link>
        ))}
      </div>
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
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
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative flex-1 sm:flex-none">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-300 ease-ios hover:bg-gray-50 hover:shadow active:scale-[0.97] sm:w-auto sm:justify-start"
      >
        <svg className="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 8h14M7 3v3M13 3v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="whitespace-nowrap">{label}</span>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-56 origin-top-left overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl animate-scale-in">
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
