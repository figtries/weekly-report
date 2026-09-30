'use client';

import { m } from 'framer-motion';
import { Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { pressMotion } from '@/components/motion/Press';

type Phase = 'idle' | 'busy' | 'done' | 'error';

/**
 * The way to finish a report: waits for every change to be written, then goes back to
 * the list. Every change is already saved as it is made; this is the press that says
 * "I am done" and the place to see that it landed. Same size as Export Excel, solid
 * where that one is outline, so the two read as a pair that differ only in colour.
 */
export default function SaveChangesButton({
  flush,
  retry,
  href,
  className = '',
}: {
  /** Resolves true when nothing is unwritten and nothing failed. */
  flush: () => Promise<boolean>;
  /** Re-sends a batch that failed; a no-op when none did. */
  retry: () => void;
  href: string;
  className?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');

  async function save() {
    if (phase === 'busy' || phase === 'done') return;
    setPhase('busy');
    retry();
    if (!(await flush())) {
      setPhase('error');
      return;
    }
    setPhase('done');
    // Refresh first so the list shows the day as it now stands, the same walk Back takes.
    router.refresh();
    router.push(href);
  }

  const palette =
    phase === 'done'
      ? 'bg-emerald-600 text-white'
      : phase === 'error'
        ? 'bg-rose-600 text-white hover:bg-rose-700'
        : 'bg-primary text-primary-foreground hover:bg-primary-hover';

  return (
    <m.button
      type="button"
      {...pressMotion}
      onClick={save}
      disabled={phase === 'busy'}
      aria-label="Save changes and go back to daily reports"
      className={`inline-flex h-11 w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-semibold shadow-sm transition-colors duration-300 ease-ios disabled:cursor-progress sm:px-4 ${palette} ${className}`}
    >
      {phase === 'busy' ? (
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
      ) : phase === 'done' ? (
        <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path className="animate-check-draw" d="M5 10.5l3.5 3.5L15 6.5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <Save className="size-4 shrink-0" aria-hidden />
      )}
      <span>{phase === 'busy' ? 'Saving…' : phase === 'done' ? 'Saved' : phase === 'error' ? 'Not saved. Retry' : 'Save changes'}</span>
      <span className="sr-only" aria-live="polite">
        {phase === 'busy' ? 'Saving' : phase === 'done' ? 'Saved' : phase === 'error' ? 'Not saved, tap to retry' : ''}
      </span>
    </m.button>
  );
}
