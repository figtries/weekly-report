'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useTransition } from 'react';
import { setCurrentWeekAction } from '@/lib/actions';
import SavePdfButton from '@/components/print/SavePdfButton';
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
  const [isPending, startTransition] = useTransition();
  // Optimistic: the green "Current" badge flips instantly on click; the server
  // action confirms in the background and the value reverts only on failure.
  const [optimisticCurrent, setOptimisticCurrent] = useOptimistic(projectCurrentWeek);

  const activeTab = TABS.find((t) => pathname.endsWith(`/${t.key}`))?.key ?? 'overall';
  const isCurrent = selectedWeek === optimisticCurrent;

  // Keep the likeliest next hops warm: this week's sibling tabs and the daily
  // list. `weeks` gets a fresh identity on every server re-render (i.e. after
  // each mutation/refresh clears the client cache), so this re-warms exactly
  // when previously prefetched payloads have been invalidated.
  useEffect(() => {
    const warm = () => {
      for (const t of TABS) {
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

  const activeLabel = TABS.find((t) => t.key === activeTab)?.label ?? 'Page';
  // Data Overall is the editing page — it has no A4 report sheet to print.
  const isPrintable = activeTab !== 'overall';

  return (
    <div className="px-3 sm:px-6 lg:px-8 pt-2 pb-1 sm:pt-4 sm:pb-2 print:hidden">
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
              <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 animate-pop-in">
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
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-emerald-700 active:scale-[0.96] disabled:opacity-70 animate-scale-in"
            title="Make this the latest reported week — the S-Curve actual line runs up to here"
          >
            <span className="hidden sm:inline">Set Week {selectedWeek} as Current</span>
            <span className="sm:hidden">Set as Current</span>
          </button>
          )}
          {isPrintable && (
          <SavePdfButton
            url={`/api/pdf/weekly/${selectedWeek}?only=${activeTab}`}
            filename={`Week ${selectedWeek} - ${activeLabel}.pdf`}
            ariaLabel={`Save ${activeLabel} as PDF`}
          />
          )}
        </div>
      </div>
    </div>
  );
}
