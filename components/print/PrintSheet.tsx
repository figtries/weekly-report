'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Print backdrop: mounts the real A4 sheet(s) on screen, auto-opens the system
// print dialog once the content is READY AND PAINTED, and stays mounted until
// the user taps anywhere after the dialog is gone. Every rule here was paid
// for with a real-device blank-page regression — do not "simplify":
//   - hidden sheets (display:none / visibility:hidden / opacity:0 /
//     left:-9999px) print blank: Android's print rasterizer only outputs
//     content that was painted on screen.
//   - AUTO-CLOSING on any signal prints blank everywhere. Print dialogs keep
//     re-reading the LIVE page until they are truly gone, and every "dialog
//     closed" signal fires too early somewhere: Android fires `afterprint`
//     the moment print() returns; modern desktop Chrome fires it right after
//     generating the preview while the dialog is still open. The only safe
//     unmount is an explicit user tap — which cannot happen while a modal
//     print dialog is covering the page.
//   - printing before the lazy report chunk has mounted prints blank: the
//     readiness check MUST refuse an empty sheet. On production the dynamic()
//     chunks arrive noticeably later than the overlay, and a deadline that
//     "prints anyway" captured an empty backdrop (localhost tests never saw
//     it because local chunks load instantly).
//   - printing in the same tick the content appears can still snapshot a
//     not-yet-painted subtree; wait two animation frames + a settle delay.

// How long to wait for photos / chart paths before printing anyway — a single
// broken image must not block printing forever. An EMPTY sheet never prints,
// deadline or not.
const MAX_WAIT_MS = 6000;
const POLL_MS = 50;
// A4 sheet width at CSS 96dpi (210mm) — used to estimate the fit-to-screen
// zoom before the first real measurement lands.
const SHEET_PX = 794;
const GUTTER_PX = 24;
// Paint-settle delay between the double rAF and opening the dialog.
const PRINT_SETTLE_MS = 200;

function contentReady(scaler: HTMLElement): boolean {
  // dynamic() children render nothing until their chunk arrives — an empty
  // scaler means the report itself hasn't mounted yet.
  if (scaler.childElementCount === 0) return false;
  for (const img of scaler.querySelectorAll('img')) {
    if (!img.complete) return false;
  }
  // Recharts paints its line paths a frame after the surrounding markup
  // mounts. Wait until every chart has drawn its curves (a non-empty `d`),
  // otherwise printing races the paint and the S-curve comes out empty.
  for (const chart of scaler.querySelectorAll('[data-print-chart]')) {
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
  const scalerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // armed = the dialog has been opened (or we gave up); from then on any tap
  // dismisses the backdrop. Never armed before print — a premature unmount
  // is exactly what blanks the output.
  const [armed, setArmed] = useState(false);
  const printedRef = useRef(false);

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
      const scaler = scalerRef.current;
      const hasContent = !!scaler && scaler.childElementCount > 0;
      // the deadline may override slow images/charts, never an empty sheet
      if (hasContent && (contentReady(scaler) || Date.now() > deadline)) {
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

  // One tap on the app's Print button lands here: content is ready, so let
  // the browser paint it (double rAF + settle), then open the dialog.
  useEffect(() => {
    if (!ready || printedRef.current) return;
    printedRef.current = true;
    let timer: number | undefined;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          setArmed(true);
          window.print();
        }, PRINT_SETTLE_MS);
      });
    });
    return () => window.clearTimeout(timer);
  }, [ready]);

  // Safety valve: if the report never becomes printable (chunk failed to
  // load), let the user dismiss the backdrop anyway.
  useEffect(() => {
    const t = window.setTimeout(() => setArmed(true), MAX_WAIT_MS + 2000);
    return () => window.clearTimeout(t);
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
      data-print-sheet
      onPointerDown={armed ? onClose : undefined}
      className="fixed inset-0 z-[9999] overflow-auto bg-gray-200 print:static print:z-auto print:overflow-visible print:bg-white"
    >
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
      {armed && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gray-900/80 px-4 py-2 text-xs font-medium text-white shadow-lg print:hidden">
          Tap anywhere to close
        </div>
      )}
    </div>
  );
}
