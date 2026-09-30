'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Camera, FileCheck2, ListChecks, ShieldCheck, StickyNote } from 'lucide-react';
import { useState } from 'react';
import { MOTION } from '@/lib/design';
import type { LogKind } from '@/lib/types';
import { useHydrated } from './fields';

export interface LogRow {
  id: string;
  at: string;
  kind: LogKind | 'photo';
  text: string;
  thumb?: string;
}

const KIND: Record<LogRow['kind'], { label: string; Icon: typeof Camera; dot: string }> = {
  photo: { label: 'Photo', Icon: Camera, dot: 'bg-blue-500' },
  activity: { label: 'Activity', Icon: ListChecks, dot: 'bg-blue-500' },
  hse: { label: 'HSE', Icon: ShieldCheck, dot: 'bg-amber-400' },
  ptw: { label: 'Permit', Icon: FileCheck2, dot: 'bg-blue-500' },
  note: { label: 'Note', Icon: StickyNote, dot: 'bg-gray-400' },
};

const timeOf = (at: string) =>
  new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

export default function TodayLog({ rows }: { rows: LogRow[] }) {
  const hydrated = useHydrated();
  const [all, setAll] = useState(false);
  const sorted = [...rows].sort((a, b) => b.at.localeCompare(a.at));
  const shown = all ? sorted : sorted.slice(0, 3);

  return (
    <section className="rounded-lg border border-border bg-card p-3 shadow-sm sm:p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Today so far</h2>
        <span className="text-[12px] font-medium tabular-nums text-gray-400">{rows.length} logged</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
          Nothing logged yet. Photos, activities, HSE taps and permits added today appear here with their time.
        </p>
      ) : (
        <ol className="ml-1.5 mt-3 border-l-2 border-blue-100 pl-4">
          <AnimatePresence initial={false}>
            {shown.map((r) => {
              const { label, Icon, dot } = KIND[r.kind];
              return (
                <m.li
                  key={r.id}
                  layout="position"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={MOTION.spring}
                  className="relative mb-2 flex items-center gap-3 rounded-lg border border-border p-2.5"
                >
                  <span className={`absolute -left-[25px] top-4 h-2.5 w-2.5 rounded-full border-2 border-card ${dot}`} />
                  {r.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumb} alt="" className="size-11 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500">
                      <Icon className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-gray-400">
                      {hydrated ? timeOf(r.at) : '--:--'} · {label}
                    </span>
                    <span className="block text-[13px] font-medium leading-snug text-foreground">{r.text}</span>
                  </span>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}

      {sorted.length > 3 && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-1 min-h-11 w-full rounded-lg text-[13px] font-semibold text-chart-1 transition-colors hover:bg-muted sm:min-h-9"
        >
          {all ? 'Show fewer' : `All ${sorted.length}`}
        </button>
      )}
    </section>
  );
}
