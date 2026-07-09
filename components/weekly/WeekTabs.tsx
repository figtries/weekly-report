'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import WeekSelect from './WeekSelect';

const TABS = [
  { key: 'overall', label: 'Data Overall' },
  { key: 'summary', label: 'Overall Summary' },
  { key: 'detail', label: 'Detail Progress' },
  { key: 'scurve', label: 'S-Curve' },
  { key: 'documentation', label: 'Documentation' },
];

export default function WeekTabs({
  weeks,
  selectedWeek,
  projectCurrentWeek,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();

  const activeTab = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'overall';
  const isCurrent = selectedWeek === projectCurrentWeek;

  async function setAsCurrent() {
    try {
      const res = await fetch('/api/project', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentWeek: selectedWeek }),
      });
      if (!res.ok) {
        const body = await res.json();
        alert(body.error ?? 'Failed to set current week');
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      alert('Failed to set current week');
    }
  }

  const activeLabel = TABS.find((t) => t.key === activeTab)?.label ?? 'Page';
  // Data Overall is the editing page — it has no A4 report sheet to print.
  const isPrintable = activeTab !== 'overall';

  return (
    <div className="px-3 sm:px-6 lg:px-8 pt-2 sm:pt-4 print:hidden">
      <div className="flex items-start justify-between gap-2 md:items-center md:gap-x-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
          <WeekSelect
            weeks={weeks}
            selectedWeek={selectedWeek}
            projectCurrentWeek={projectCurrentWeek}
            activeTab={activeTab}
          />
            {isCurrent && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 animate-pop-in">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Current
              </span>
            )}
          </div>
        </div>
        {/* The "set as current" button goes invisible (not unmounted) once the
            week is current, so the print button beside it never moves or resizes. */}
        <div className="flex shrink-0 items-start justify-end gap-2 sm:items-center">
          <button
            onClick={setAsCurrent}
            disabled={isCurrent}
            aria-hidden={isCurrent}
            tabIndex={isCurrent ? -1 : 0}
            className={`inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white shadow-sm transition-all duration-300 ease-ios active:scale-[0.96] animate-scale-in sm:px-4 sm:text-sm ${
              isCurrent ? 'invisible' : 'bg-emerald-500 hover:bg-emerald-600 disabled:opacity-70'
            }`}
            title="Make this the latest reported week — the S-Curve actual line runs up to here"
          >
            <span className="hidden sm:inline">Set Week {selectedWeek} as current</span>
            <span className="sm:hidden">Set as Current</span>
          </button>
          {isPrintable && (
          <button
            onClick={() => window.dispatchEvent(new Event('weekly-print-request'))}
            aria-label={`Print ${activeLabel}`}
            title={`Print ${activeLabel}`}
            className="inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96] sm:w-auto sm:px-4 sm:py-2"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M5 2.75C5 1.784 5.784 1 6.75 1h6.5c.966 0 1.75.784 1.75 1.75v3.552c.377.046.752.097 1.126.153A2.212 2.212 0 0118 8.653v4.097A2.25 2.25 0 0115.75 15h-.241l.305 1.984A1.75 1.75 0 0114.084 19H5.915a1.75 1.75 0 01-1.729-2.016L4.492 15H4.25A2.25 2.25 0 012 12.75V8.653c0-1.082.775-2.034 1.874-2.198.374-.056.75-.107 1.126-.153V2.75zm1.5 3.212c1.158-.083 2.325-.126 3.5-.126s2.342.043 3.5.126V2.75a.25.25 0 00-.25-.25h-6.5a.25.25 0 00-.25.25v3.212zM5.457 15l-.427 2.775a.25.25 0 00.247.225h9.446a.25.25 0 00.247-.225L14.543 15H5.457z"
                clipRule="evenodd"
              />
            </svg>
            <span className="hidden sm:inline">Print {activeLabel}</span>
          </button>
          )}
        </div>
      </div>
    </div>
  );
}
