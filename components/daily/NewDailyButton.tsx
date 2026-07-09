'use client';

import { useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { createDailyAction } from '@/lib/actions';

export default function NewDailyButton({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [error, setError] = useState<string | null>(null);
  // Covers the action AND the navigation that follows, so the button reads
  // "Creating…" until the new report page is actually on screen.
  const [creating, startTransition] = useTransition();

  const weekdayPreview = date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '';

  function openModal() {
    setDate(defaultDate);
    setError(null);
    setOpen(true);
  }

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await createDailyAction(date);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
      router.push(`/daily/${date}`);
    });
  }

  return (
    <>
      <button
        onClick={openModal}
        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96] sm:flex-none"
      >
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 4.5v11M4.5 10h11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        New Daily Report
      </button>

      {open &&
        createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
            onClick={() => !creating && setOpen(false)}
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 shadow-xl animate-scale-in">
            <h2 className="text-lg font-semibold text-gray-900">New Daily Report</h2>
            <p className="mt-1 text-sm text-gray-500">Choose the day for this report.</p>

            <label className="mt-5 block text-xs font-medium text-gray-600">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setError(null);
              }}
              className="mt-1 block w-full min-w-0 rounded-md border border-gray-300 px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {weekdayPreview && <p className="mt-1.5 text-sm font-medium text-gray-700">{weekdayPreview}</p>}
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                disabled={creating}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-300 ease-ios hover:bg-gray-50 active:scale-[0.97] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={create}
                disabled={creating || !date}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96] disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
