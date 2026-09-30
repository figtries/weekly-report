'use client';

import { m } from 'framer-motion';
import PageHeader from '@/components/layout/PageHeader';
import { SECTION_ORDER, type SectionState } from '@/lib/daily-status';
import { MOTION } from '@/lib/design';
import type { DailySectionKey } from '@/lib/types';

// The raw colours the Marker rings use (emerald-500, blue-500, amber-400, gray-200).
const SEGMENT: Record<SectionState, string> = {
  ready: '#10b981',
  same: '#3b82f6',
  look: '#fbbf24',
  empty: '#e5e7eb',
};

/**
 * The page header every screen has, plus one thin line that says how far the day is:
 * a segment per part of the report, and the save state beside it. No hero card, no
 * big number: the parts below carry their own marks, this only sums them up.
 */
export default function DailyHeader({
  title,
  subtitle,
  states,
  ready,
  pending,
  failed,
  onRetry,
}: {
  title: string;
  subtitle: string;
  states: Record<DailySectionKey, SectionState>;
  ready: number;
  pending: number;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="animate-enter mb-5 sm:mb-6">
      <PageHeader section="Daily Reports" title={title} className="mb-3 sm:mb-4">
        {subtitle}
      </PageHeader>

      <div className="flex items-center gap-3">
        <div className="flex h-1.5 min-w-0 flex-1 gap-1" aria-hidden>
          {SECTION_ORDER.map((k) => (
            <m.div
              key={k}
              className="h-full flex-1 rounded-full"
              initial={false}
              animate={{ backgroundColor: SEGMENT[states[k]] }}
              transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
            />
          ))}
        </div>
        <p className="shrink-0 text-[12.5px] font-medium tabular-nums text-muted-foreground">
          {ready} of {SECTION_ORDER.length} done
        </p>
      </div>
      <p aria-live="polite" className="mt-1.5 min-h-4 text-[12px] font-medium text-gray-400">
        {failed ? (
          <button type="button" onClick={onRetry} className="text-red-500 underline underline-offset-2">
            Not saved. Try again
          </button>
        ) : pending > 0 ? (
          'Saving…'
        ) : (
          'All changes saved'
        )}
      </p>
    </div>
  );
}
