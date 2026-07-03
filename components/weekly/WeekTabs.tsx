'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import PrintTrigger from '@/components/ui/PrintTrigger';

const TABS = [
  { key: 'overall', label: 'Data Overall' },
  { key: 'summary', label: 'Overall Summary' },
  { key: 'detail', label: 'Detail Progress' },
  { key: 'scurve', label: 'S-Curve' },
  { key: 'documentation', label: 'Documentation' },
  { key: 'print', label: 'Print Report' },
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

  return (
    <div className="border-b border-gray-200 bg-white px-8 print:hidden">
      <div className="flex items-center justify-between pt-4">
        <div className="flex items-center gap-2">
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
        <div className="flex items-center gap-2">
          {!isCurrent && (
            <button
              onClick={setAsCurrent}
              disabled={phase !== 'idle'}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios active:scale-[0.96] animate-scale-in ${
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
          )}
          {activeTab === 'print' && <PrintTrigger label={`Print Weekly Report No. ${selectedWeek}`} />}
        </div>
      </div>
      <nav className="-mx-3 mt-3 flex gap-1">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`/weekly/${selectedWeek}/${tab.key}`}
              className={`relative rounded-md px-3 py-2 text-sm font-medium transition-all duration-300 ease-ios active:scale-[0.97] ${
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
  );
}
