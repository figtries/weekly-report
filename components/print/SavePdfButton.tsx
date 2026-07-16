'use client';

import { useEffect, useRef, useState } from 'react';

// The one way a report leaves this app: downloads the server-rendered PDF (see
// lib/pdf.ts for why reports are PDFs and not window.print()).
//
// The bytes are fetched here instead of letting the browser navigate to the
// route, because a navigation gives no feedback: the tab just sits there while
// Chromium renders (seconds — longer on a cold serverless start), and users
// pressed the button again. Fetching keeps the user on the page and lets the
// button narrate the whole trip: Preparing → Downloading N% → Saved!, or a
// tap-to-retry failure.
type Phase = 'idle' | 'busy' | 'done' | 'error';

const RESET_DONE_MS = 2600;
const RESET_ERROR_MS = 4000;

// Booting Chromium is the dominant cost of a cold save — seconds on Vercel
// while the lambda unpacks the binary, all spent AFTER the tap. Ping the
// warmup route as soon as a save button is on screen (and again when the user
// returns to the tab — phones background this app for long stretches, long
// enough for the lambda to go cold) so the boot happens while they're still
// reading and the tap itself only pays render + transfer. The ping carries
// this button's PDF url so the server can pre-load the matching print page
// into the warmed browser too (see warmPdfRenderer in lib/pdf.ts). Timestamps
// are module-level and per target: several buttons, one ping each.
const REWARM_MS = 4 * 60_000;
const lastWarmAt = new Map<string, number>();

function warmPdfRenderer(url: string) {
  const last = lastWarmAt.get(url) ?? -Infinity;
  if (Date.now() - last < REWARM_MS) return;
  lastWarmAt.set(url, Date.now());
  fetch(`/api/pdf/warmup?for=${encodeURIComponent(url)}`).catch(() => undefined);
}

// Read the body chunk by chunk so the button can count the transfer up: on a
// phone the download is most of the wait, and a spinner that sits still for
// the whole of it reads as a hang. Falls back to a plain blob when the length
// isn't known (a proxy stripped it) — the spinner then just keeps spinning.
async function readWithProgress(res: Response, onProgress: (pct: number) => void): Promise<Blob> {
  const total = Number(res.headers.get('Content-Length'));
  if (!res.body || !Number.isFinite(total) || total <= 0) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  let received = 0;
  let lastPct = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    // cap at 99 — 100% is the Saved! state's job, a lingering "100%" reads
    // as stuck
    const pct = Math.min(99, Math.floor((received / total) * 100));
    if (pct > lastPct) {
      lastPct = pct;
      onProgress(pct);
    }
  }
  return new Blob(chunks, { type: res.headers.get('Content-Type') ?? '' });
}

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
  // null while the server is still rendering (nothing to count yet); a number
  // once bytes are flowing.
  const [progress, setProgress] = useState<number | null>(null);
  const resetTimer = useRef<number | undefined>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(resetTimer.current);
    };
  }, []);

  useEffect(() => {
    warmPdfRenderer(url);
    const onVisible = () => {
      if (document.visibilityState === 'visible') warmPdfRenderer(url);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [url]);

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
    setProgress(null);
    try {
      if (beforeDownload && !(await beforeDownload())) {
        if (mountedRef.current) setPhase('idle');
        return;
      }
      const res = await fetch(url);
      if (!res.ok) throw new Error(`PDF route answered ${res.status}`);
      const blob = await readWithProgress(res, (pct) => {
        if (mountedRef.current) setProgress(pct);
      });
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
      className={`inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-lg text-sm font-medium shadow-sm transition-all duration-300 ease-ios active:scale-[0.96] disabled:cursor-progress sm:w-auto sm:px-4 sm:py-2 ${palette}`}
    >
      {phase === 'busy' ? (
        <>
          {/* on the icon-only (mobile) button the counting percent replaces
              the spinner once bytes flow — that count is the whole feedback */}
          <span
            className={`h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white ${progress !== null ? 'hidden sm:inline-block' : ''}`}
            aria-hidden="true"
          />
          {progress !== null && (
            <span className="text-[11px] font-bold leading-none tabular-nums sm:hidden" aria-hidden="true">
              {progress}%
            </span>
          )}
        </>
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
        {phase === 'busy'
          ? progress !== null
            ? `Downloading… ${progress}%`
            : 'Preparing PDF…'
          : phase === 'done'
            ? 'Saved!'
            : phase === 'error'
              ? 'Failed — retry'
              : 'Save as PDF'}
      </span>
      {/* phase-only announcements: a per-percent aria-live region would spam
          screen readers through the whole download */}
      <span className="sr-only" aria-live="polite">
        {phase === 'busy' ? 'Preparing PDF' : phase === 'done' ? 'Saved' : phase === 'error' ? 'Failed, tap to retry' : ''}
      </span>
    </button>
  );
}
