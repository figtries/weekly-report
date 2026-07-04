'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';

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
  const [phase, setPhase] = useState<'idle' | 'done'>('idle');
  const [, startTransition] = useTransition();

  const activeTab = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'overall';
  const isCurrent = selectedWeek === projectCurrentWeek;

  useEffect(() => {
    setPhase('idle');
  }, [selectedWeek, projectCurrentWeek]);

  async function setAsCurrent() {
    // Optimistic: play the success animation immediately, save in the background.
    setPhase('done');
    const beat = new Promise((r) => setTimeout(r, 900));
    try {
      const res = await fetch('/api/project', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentWeek: selectedWeek }),
      });
      if (!res.ok) {
        const body = await res.json();
        setPhase('idle');
        alert(body.error ?? 'Failed to set current week');
        return;
      }
      // Let the "Done!" beat finish before the badge takes over.
      await beat;
      startTransition(() => router.refresh());
    } catch {
      setPhase('idle');
      alert('Failed to set current week');
    }
  }

  const activeLabel = TABS.find((t) => t.key === activeTab)?.label ?? 'Page';
  // Data Overall is the editing page — it has no A4 report sheet to print.
  const isPrintable = activeTab !== 'overall';

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4 print:hidden">
      <div className="flex flex-col gap-y-2 md:flex-row md:items-center md:justify-between md:gap-x-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Week</span>
          <select
            value={selectedWeek}
            onChange={(e) => router.push(`/weekly/${e.target.value}/${activeTab}`)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium tabular-nums text-gray-900 shadow-sm transition-all duration-300 ease-ios hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {weeks.map((w) => (
              <option
                key={w}
                value={w}
                style={
                  w === projectCurrentWeek
                    ? { backgroundColor: '#d1fae5', color: '#047857', fontWeight: 600 }
                    : undefined
                }
              >
                Week {w}
              </option>
            ))}
          </select>
            {isCurrent && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 animate-pop-in">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Current
              </span>
            )}
          </div>
          {/* Subpage tabs only below lg — on desktop they live in the sidebar. */}
          <nav className="lg:hidden -mx-3 mt-2 sm:mt-3 flex gap-1 overflow-x-auto scrollbar-none">
            {TABS.map((tab) => {
              const isActive = tab.key === activeTab;
              return (
                <Link
                  key={tab.key}
                  href={`/weekly/${selectedWeek}/${tab.key}`}
                  className={`relative shrink-0 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition-all duration-300 ease-ios active:scale-[0.97] ${
                    isActive ? 'text-blue-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-blue-600 animate-underline" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        {/* The "set as current" button goes invisible (not unmounted) once the
            week is current, so the print button beside it never moves or resizes. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            onClick={setAsCurrent}
            disabled={isCurrent || phase !== 'idle'}
            aria-hidden={isCurrent}
            tabIndex={isCurrent ? -1 : 0}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios active:scale-[0.96] animate-scale-in ${
              isCurrent ? 'invisible' : ''
            } ${
              phase === 'done'
                ? 'bg-emerald-500 animate-success-bump'
                : 'bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70'
            }`}
            title="Make this the latest reported week — the S-Curve actual line runs up to here"
          >
              {phase === 'done' ? (
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    className="animate-check-draw"
                    d="M4.5 10.5l3.5 3.5 7.5-8"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={24}
                  />
                </svg>
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M16.704 5.29a1 1 0 010 1.415l-7.5 7.5a1 1 0 01-1.415 0l-3.5-3.5a1 1 0 111.415-1.415l2.792 2.793 6.793-6.793a1 1 0 011.415 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            {phase === 'done'
              ? `Week ${selectedWeek} is now current!`
              : `Set Week ${selectedWeek} as current`}
          </button>
          {isPrintable && (
          <button
            onClick={() => window.print()}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96]"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M5 2.75C5 1.784 5.784 1 6.75 1h6.5c.966 0 1.75.784 1.75 1.75v3.552c.377.046.752.097 1.126.153A2.212 2.212 0 0118 8.653v4.097A2.25 2.25 0 0115.75 15h-.241l.305 1.984A1.75 1.75 0 0114.084 19H5.915a1.75 1.75 0 01-1.729-2.016L4.492 15H4.25A2.25 2.25 0 012 12.75V8.653c0-1.082.775-2.034 1.874-2.198.374-.056.75-.107 1.126-.153V2.75zm1.5 3.212c1.158-.083 2.325-.126 3.5-.126s2.342.043 3.5.126V2.75a.25.25 0 00-.25-.25h-6.5a.25.25 0 00-.25.25v3.212zM5.457 15l-.427 2.775a.25.25 0 00.247.225h9.446a.25.25 0 00.247-.225L14.543 15H5.457z"
                clipRule="evenodd"
              />
            </svg>
            Print {activeLabel}
          </button>
          )}
        </div>
      </div>
    </div>
  );
}
