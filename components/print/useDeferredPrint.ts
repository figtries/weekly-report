'use client';

import { useEffect, useState } from 'react';

// How long we're willing to wait for the lazy print chunk + its images before
// printing anyway. Without a cap, a single broken image would block printing.
const MAX_WAIT_MS = 6000;
const POLL_MS = 50;

function sheetReady(): boolean {
  const sheets = document.querySelectorAll('[data-print-sheet]');
  if (sheets.length === 0) return false;
  for (const sheet of sheets) {
    // dynamic() renders nothing until its chunk arrives — an empty wrapper
    // means the sheet itself hasn't mounted yet.
    if (sheet.childElementCount === 0) return false;
    for (const img of sheet.querySelectorAll('img')) {
      if (!img.complete) return false;
    }
  }
  return true;
}

export function useDeferredPrint() {
  const [mounted, setMounted] = useState(false);
  const [pendingPrint, setPendingPrint] = useState(false);

  useEffect(() => {
    const requestPrint = () => {
      setMounted(true);
      setPendingPrint(true);
    };

    window.addEventListener('weekly-print-request', requestPrint);
    return () => window.removeEventListener('weekly-print-request', requestPrint);
  }, []);

  // The old fixed 250ms delay raced the lazy chunk + photo downloads and lost
  // on slow connections — the preview came up blank. Poll until the sheet has
  // actually rendered and every image finished loading, then print.
  useEffect(() => {
    if (!mounted || !pendingPrint) return;

    let cancelled = false;
    const deadline = Date.now() + MAX_WAIT_MS;

    const tick = () => {
      if (cancelled) return;
      if (sheetReady() || Date.now() > deadline) {
        window.print();
        setPendingPrint(false);
        return;
      }
      window.setTimeout(tick, POLL_MS);
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, [mounted, pendingPrint]);

  useEffect(() => {
    const cleanup = () => setMounted(false);

    window.addEventListener('afterprint', cleanup);
    return () => window.removeEventListener('afterprint', cleanup);
  }, []);

  return mounted;
}
