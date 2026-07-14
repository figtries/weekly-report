'use client';

import { useEffect, useRef, useState } from 'react';

// The one way a report leaves this app: downloads the server-rendered PDF (see
// lib/pdf.ts for why reports are PDFs and not window.print()).
//
// The bytes are fetched here instead of letting the browser navigate to the
// route, because a navigation gives no feedback: the tab just sits there while
// Chromium renders (seconds — longer on a cold serverless start), and users
// pressed the button again. Fetching keeps the user on the page and lets the
// button narrate the whole trip: Preparing → Saved!, or a tap-to-retry failure.
type Phase = 'idle' | 'busy' | 'done' | 'error';

const RESET_DONE_MS = 2600;
const RESET_ERROR_MS = 4000;

export default function SavePdfButton({
  url,
  filename,
  ariaLabel,
  beforeDownload,
}: {
  url: string;
  filename: string;
  ariaLabel: string;
  /** Runs before the download; return false to abort (e.g. a failed save). */
  beforeDownload?: () => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const resetTimer = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(resetTimer.current);
    };
  }, []);

  function settle(next: Phase, after: number) {
    if (!mountedRef.current) return;
    setPhase(next);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => {
      if (mountedRef.current) setPhase('idle');
    }, after);
  }

  async function save() {
    if (phase === 'busy' || phase === 'done') return;
    setPhase('busy');
    try {
      if (beforeDownload && !(await beforeDownload())) {
        if (mountedRef.current) setPhase('idle');
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`PDF route answered ${res.status}`);
      const blob = await res.blob();
      // A server error page still arrives as a blob — never save one as .pdf.
      if (!blob.type.includes('pdf')) throw new Error(`Not a PDF: ${blob.type}`);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // revoke after the click has been consumed — immediate revoke loses the
      // download on iOS Safari
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
      settle('done', RESET_DONE_MS);
    } catch {
      settle('error', RESET_ERROR_MS);
    }
  }

  const palette =
    phase === 'done'
      ? 'bg-emerald-600 text-white shadow-md animate-success-bump'
      : phase === 'error'
        ? 'bg-rose-600 text-white hover:bg-rose-700'
        : 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md';

  return (
    <button
      onClick={save}
      disabled={phase === 'busy'}
      aria-label={ariaLabel}
      title={ariaLabel}
      aria-live="polite"
      className={`inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium shadow-sm transition-all duration-300 ease-ios active:scale-[0.96] disabled:cursor-progress sm:w-auto sm:px-4 sm:py-2 ${palette}`}
    >
      {phase === 'busy' ? (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
      ) : phase === 'done' ? (
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            className="animate-check-draw"
            d="M5 10.5l3.5 3.5L15 6.5"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        /* arrow-into-tray download icon; the arrow dips on hover so the button
           reads as "this saves a file" before anyone clicks it */
        <svg className="group h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            className="animate-pdf-arrow"
            d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z"
          />
          <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
        </svg>
      )}
      <span className="hidden sm:inline">
        {phase === 'busy' ? 'Preparing PDF…' : phase === 'done' ? 'Saved!' : phase === 'error' ? 'Failed — retry' : 'Save as PDF'}
      </span>
    </button>
  );
}
