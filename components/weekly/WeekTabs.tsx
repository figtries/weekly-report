'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useTransition } from 'react';
import { setCurrentWeekAction } from '@/lib/actions';
import SavePdfButton from '@/components/print/SavePdfButton';
import SectionTabs from '@/components/layout/SectionTabs';
import WeekSelect from './WeekSelect';

/**
 * The weekly pages, split the way people use them.
 *
 * These used to be seven flat entries in the sidebar, which put report SHEETS
 * beside the tools that fill them in. The sidebar now carries one entry per
 * group and the tabs live here, next to the week they belong to.
 *
 * `printable` must match the ReportKey union in app/print/weekly/[week]/page.tsx.
 * A tab that claims printable without a sheet there makes lib/pdf.ts wait for a
 * '.print-sheet-a4' that never renders, so the PDF request hangs rather than
 * erroring — always set this deliberately when adding a tab.
 *
 * `label` is what the saved PDF is named, so it stays as the report calls it;
 * `short` is only what the tab shows.
 */
const GROUPS = {
  progress: [
    { key: 'input', label: 'Input Lapangan', short: 'Input', printable: false },
    { key: 'overall', label: 'Data Overall', short: 'Data Overall', printable: false },
    { key: 'control', label: 'Panel Kendali', short: 'Kendali', printable: false },
  ],
  laporan: [
    { key: 'summary', label: 'Overall Summary', short: 'Ringkasan', printable: true },
    { key: 'detail', label: 'Detail Progress', short: 'Detail', printable: true },
    { key: 'scurve', label: 'S-Curve', short: 'Kurva S', printable: true },
    { key: 'documentation', label: 'Documentation', short: 'Foto', printable: true },
  ],
} as const;

const ALL = [...GROUPS.progress, ...GROUPS.laporan];

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
  const [isPending, startTransition] = useTransition();
  // Optimistic: the green "Current" badge flips instantly on click; the server
  // action confirms in the background and the value reverts only on failure.
  const [optimisticCurrent, setOptimisticCurrent] = useOptimistic(projectCurrentWeek);

  const active = ALL.find((t) => pathname.endsWith(`/${t.key}`)) ?? GROUPS.progress[1];
  const activeTab = active.key;
  const tabs = GROUPS.laporan.some((t) => t.key === activeTab) ? GROUPS.laporan : GROUPS.progress;
  const isCurrent = selectedWeek === optimisticCurrent;

  // Keep the likeliest next hops warm: this week's sibling tabs and the daily
  // list. `weeks` gets a fresh identity on every server re-render (i.e. after
  // each mutation/refresh clears the client cache), so this re-warms exactly
  // when previously prefetched payloads have been invalidated.
  useEffect(() => {
    const warm = () => {
      for (const t of ALL) {
        if (t.key !== activeTab) router.prefetch(`/weekly/${selectedWeek}/${t.key}`);
      }
      router.prefetch('/daily');
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 400);
    return () => window.clearTimeout(id);
  }, [selectedWeek, activeTab, weeks, router]);

  function setAsCurrent() {
    startTransition(async () => {
      setOptimisticCurrent(selectedWeek);
      const res = await setCurrentWeekAction(selectedWeek);
      if (!res.ok) alert(res.error);
    });
  }

  return (
    <div className="px-3 pt-2 pb-1 sm:px-6 sm:pt-4 sm:pb-2 lg:px-8 print:hidden">
      <div className="flex items-start justify-between gap-2 md:items-center md:gap-x-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <WeekSelect
              weeks={weeks}
              selectedWeek={selectedWeek}
              projectCurrentWeek={optimisticCurrent}
              activeTab={activeTab}
            />
            {isCurrent && (
              <span className="inline-flex shrink-0 animate-pop-in items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Current
              </span>
            )}
          </div>
        </div>
        {/* The "set as current" button unmounts once the week is current; the
            group is justify-end, so the print button at the right edge never
            moves. Freeing the width keeps the Current badge on the same row as
            the week select on narrow screens. */}
        <div className="flex shrink-0 items-start justify-end gap-2 sm:items-center">
          {!isCurrent && (
            <button
              onClick={setAsCurrent}
              disabled={isPending}
              className="inline-flex min-h-10 animate-scale-in items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-emerald-700 active:scale-[0.96] disabled:opacity-70"
              title="Make this the latest reported week — the S-Curve actual line runs up to here"
            >
              <span className="hidden sm:inline">Set Week {selectedWeek} as Current</span>
              <span className="sm:hidden">Set as Current</span>
            </button>
          )}
          {active.printable && (
            <SavePdfButton
              url={`/api/pdf/weekly/${selectedWeek}?only=${activeTab}`}
              filename={`Week ${selectedWeek} - ${active.label}.pdf`}
              ariaLabel={`Save ${active.label} as PDF`}
            />
          )}
        </div>
      </div>

      <SectionTabs
        className="-mx-3 mt-2 px-3 sm:mx-0 sm:px-0"
        tabs={tabs.map((t) => ({ href: `/weekly/${selectedWeek}/${t.key}`, label: t.short }))}
      />
    </div>
  );
}
