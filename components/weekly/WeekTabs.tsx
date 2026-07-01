'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

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
  const [saving, setSaving] = useState(false);

  const activeTab = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'overall';
  const isCurrent = selectedWeek === projectCurrentWeek;

  async function setAsCurrent() {
    setSaving(true);
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
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-gray-200 bg-white px-8 print:hidden">
      <div className="flex items-center justify-between pt-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-500">Week</label>
          <select
            value={selectedWeek}
            onChange={(e) => router.push(`/weekly/${e.target.value}/${activeTab}`)}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm font-medium text-gray-900 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            {weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
                {w === projectCurrentWeek ? ' • current' : ''}
              </option>
            ))}
          </select>
        </div>
        {isCurrent ? (
          <span className="rounded-full bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-700">
            Current reporting week
          </span>
        ) : (
          <button
            onClick={setAsCurrent}
            disabled={saving}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow active:scale-95 disabled:opacity-50"
            title="Make this the latest reported week — the S-Curve actual line runs up to here"
          >
            {saving ? 'Saving…' : `Set Week ${selectedWeek} as current`}
          </button>
        )}
      </div>
      <nav className="mt-3 flex gap-1">
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={`/weekly/${selectedWeek}/${tab.key}`}
              className={`relative px-3 py-2 text-sm font-medium transition-colors ${
                isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {tab.label}
              {isActive && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-blue-600 transition-all" />
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
