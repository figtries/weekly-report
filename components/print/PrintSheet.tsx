'use client';

import { useEffect, useRef, useState } from 'react';

// Visible print-preview overlay: the user sees the real A4 sheet(s), then taps
// "Print / Save PDF" themselves. Do NOT "restore" any auto-print/hidden-sheet
// variant — every one of them printed a BLANK page on Android:
//   - display:none / visibility:hidden / opacity:0 / offscreen (left:-9999px):
//     Android's print rasterizer only outputs content that was painted on
//     screen (desktop/iOS re-lay-out for print, so only Android broke).
//   - painted overlay + window.print() + unmount on afterprint: Android fires
//     `afterprint` as soon as print() RETURNS — not when the dialog closes
//     like desktop/iOS — and its print service keeps re-rendering the live
//     DOM while the dialog is open (e.g. on paper-size change). The sheet
//     unmounted mid-render and the system preview captured an empty page.
// There is no reliable "print dialog closed" signal on Android, so the sheet
// must stay mounted until the USER closes it. What you see is what prints.

// How long to wait for lazy chunks / photos / chart paths before enabling the
// Print button anyway — a single broken image must not block printing forever.
const MAX_WAIT_MS = 6000;
const POLL_MS = 50;

function contentReady(root: HTMLElement): boolean {
  for (const img of root.querySelectorAll('img')) {
    if (!img.complete) return false;
  }
  // Recharts paints its line paths a frame after the surrounding markup
  // mounts. Wait until every chart has drawn its curves (a non-empty `d`),
  // otherwise printing races the paint and the S-curve comes out empty.
  for (const chart of root.querySelectorAll('[data-print-chart]')) {
    const curves = chart.querySelectorAll('path.recharts-curve');
    if (curves.length === 0) return false;
    for (const curve of curves) {
      const d = curve.getAttribute('d');
      if (!d || d.length < 2) return false;
    }
  }
  return true;
}

export default function PrintSheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const deadline = Date.now() + MAX_WAIT_MS;
    const tick = () => {
      if (cancelled) return;
      const root = rootRef.current;
      if ((root && contentReady(root)) || Date.now() > deadline) {
        setReady(true);
        return;
      }
      window.setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      data-print-sheet
      className="fixed inset-0 z-[9999] overflow-auto bg-gray-200 print:static print:z-auto print:overflow-visible print:bg-white"
    >
      {/* sticky left-0 keeps the toolbar pinned while the wider-than-screen
          A4 sheet scrolls horizontally underneath it on phones */}
      <div className="sticky left-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-300 bg-white/95 px-4 py-2.5 shadow-sm backdrop-blur print:hidden">
        <p className="text-sm font-semibold text-gray-800">Print preview</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-all duration-300 ease-ios hover:bg-gray-50 active:scale-[0.96]"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            disabled={!ready}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 active:scale-[0.96] disabled:opacity-60"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M5 2.75C5 1.784 5.784 1 6.75 1h6.5c.966 0 1.75.784 1.75 1.75v3.552c.377.046.752.097 1.126.153A2.212 2.212 0 0118 8.653v4.097A2.25 2.25 0 0115.75 15h-.241l.305 1.984A1.75 1.75 0 0114.084 19H5.915a1.75 1.75 0 01-1.729-2.016L4.492 15H4.25A2.25 2.25 0 012 12.75V8.653c0-1.082.775-2.034 1.874-2.198.374-.056.75-.107 1.126-.153V2.75zm1.5 3.212c1.158-.083 2.325-.126 3.5-.126s2.342.043 3.5.126V2.75a.25.25 0 00-.25-.25h-6.5a.25.25 0 00-.25.25v3.212zM5.457 15l-.427 2.775a.25.25 0 00.247.225h9.446a.25.25 0 00.247-.225L14.543 15H5.457z"
                clipRule="evenodd"
              />
            </svg>
            {ready ? 'Print / Save PDF' : 'Preparing…'}
          </button>
        </div>
      </div>
      {/* w-max keeps the fixed-width A4 sheet scrollable (not left-clipped) on
          small screens — same pattern as the /weekly/[week]/print page */}
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:w-auto print:min-w-0 print:gap-0 print:p-0">
        {children}
      </div>
    </div>
  );
}
