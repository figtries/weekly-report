'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Print overlay: mounts the real A4 sheet(s) on screen, auto-opens the system
// print dialog once the content is ready, and stays mounted until the USER
// taps Close. Both halves are load-bearing — do not "simplify" either away:
//   - hidden sheets (display:none / visibility:hidden / opacity:0 /
//     left:-9999px) print blank: Android's print rasterizer only outputs
//     content that was painted on screen.
//   - AUTO-CLOSING prints blank on every platform. Print dialogs keep
//     re-reading the LIVE page until they are truly gone (initial preview,
//     paper-size changes, the final save/print render), and every "dialog
//     closed" signal fires too early somewhere: Android fires `afterprint`
//     the moment print() returns; modern desktop Chrome fires it right after
//     generating the preview while the dialog is still open (print() no
//     longer blocks) — so closing on afterprint blanked the SAVED output
//     even when the preview looked fine. visibilitychange heuristics are
//     just as unreliable. There is no trustworthy cross-platform signal, so
//     the only safe unmount is the user's own Close tap.

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

// A4 sheet width at CSS 96dpi (210mm) — used to estimate the fit-to-screen
// zoom before the first real measurement lands.
const SHEET_PX = 794;
const GUTTER_PX = 24;

export default function PrintSheet({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // Scale the fixed-width A4 sheets down so the whole page width fits the
  // screen (phones/tablets); desktop caps at 1:1. Print always happens at
  // natural size — the .pv-* rules in globals.css undo the transform.
  const [scale, setScale] = useState(() =>
    typeof window === 'undefined' ? 1 : Math.min(1, (window.innerWidth - GUTTER_PX) / SHEET_PX)
  );
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useLayoutEffect(() => {
    const el = scalerRef.current;
    if (!el) return;
    const measure = () => {
      // transform doesn't affect layout size, so these are the natural dims
      const w = el.scrollWidth;
      const h = el.scrollHeight;
      if (w === 0) return;
      setSize({ w, h });
      setScale(Math.min(1, (window.innerWidth - GUTTER_PX) / w));
    };
    measure();
    // re-measure as lazy chunks, photos and charts stretch the content
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

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

  const printedRef = useRef(false);

  // Auto-print as soon as the sheet is ready — one tap on the app's Print
  // button opens the system dialog directly. NO auto-close: see the header
  // comment; unmounting before the user dismisses the dialog blanks the
  // printout, so the overlay waits for the Close button.
  useEffect(() => {
    if (!ready || printedRef.current) return;
    printedRef.current = true;
    window.print();
  }, [ready]);

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
      <div className="px-3 py-4 sm:px-6 sm:py-6 print:p-0">
        {/* outer box reserves the SCALED footprint (transform doesn't affect
            layout), inner scaler holds the sheets at natural size */}
        <div
          className="pv-scale-box mx-auto"
          style={size ? { width: size.w * scale, height: size.h * scale } : undefined}
        >
          {/* print:block — WebKit drops/clips page fragments inside flex
              containers, so paper must never paginate through a flexbox */}
          <div
            ref={scalerRef}
            className="pv-scaler flex flex-col items-center gap-6 print:block print:gap-0"
            style={{ transform: scale === 1 ? undefined : `scale(${scale})` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
