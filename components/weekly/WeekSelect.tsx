'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

export default function WeekSelect({
  weeks,
  selectedWeek,
  projectCurrentWeek,
  activeTab,
}: {
  weeks: number[];
  selectedWeek: number;
  projectCurrentWeek: number;
  activeTab: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [activeIdx, setActiveIdx] = useState(() => weeks.indexOf(selectedWeek));
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function close() {
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 140);
  }

  function toggle() {
    if (open) {
      close();
    } else {
      setActiveIdx(weeks.indexOf(selectedWeek));
      setOpen(true);
    }
  }

  function pick(w: number) {
    close();
    if (w !== selectedWeek) router.push(`/weekly/${w}/${activeTab}`);
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Centre the selected/active row each time the panel opens or the cursor moves.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        toggle();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(weeks.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(weeks.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const w = weeks[activeIdx];
      if (w != null) pick(w);
    }
  }

  return (
    <div ref={rootRef} className="relative w-fit">
      <button
        type="button"
        onClick={toggle}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white py-1.5 pl-3 pr-2.5 text-sm font-medium tabular-nums text-gray-900 shadow-sm transition-all duration-200 ease-ios hover:border-gray-400 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 active:scale-[0.98]"
      >
        <span>Week {selectedWeek}</span>
        <svg
          className="h-4 w-4 text-gray-400 transition-transform duration-200 ease-ios"
          style={{ transform: open && !closing ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.2}
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute left-0 top-full z-50 mt-2 w-36 origin-top-left overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-xl ring-1 ring-black/5 sm:w-full ${
            closing ? 'animate-dropdown-out' : 'animate-dropdown-in'
          }`}
        >
          <div ref={listRef} className="scrollbar-none max-h-72 space-y-0.5 overflow-y-auto">
            {weeks.map((w, i) => {
              const isSelected = w === selectedWeek;
              const isCurrent = w === projectCurrentWeek;
              const isActive = i === activeIdx;
              return (
                <button
                  key={w}
                  data-idx={i}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => pick(w)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm tabular-nums transition-colors duration-150 ${
                    isCurrent
                      ? 'bg-emerald-50 font-semibold text-emerald-700'
                      : isSelected
                        ? 'bg-blue-50 font-semibold text-blue-700'
                        : isActive
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-700'
                  }`}
                  title={isCurrent ? 'Current week' : undefined}
                >
                  <span>Week {w}</span>
                  {isSelected && (
                    <svg
                      className={`h-4 w-4 shrink-0 ${isCurrent ? 'text-emerald-600' : 'text-blue-600'}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
