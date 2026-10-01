'use client';

import { AnimatePresence, m } from 'framer-motion';
import { Camera, FileCheck2, ListChecks, ShieldCheck, StickyNote, Trash2 } from 'lucide-react';
import { useState } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
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

export default function TodayLog({ rows, onRemove }: { rows: LogRow[]; onRemove: (id: string) => void }) {
  const hydrated = useHydrated();
  const [all, setAll] = useState(false);
  const [asking, setAsking] = useState<LogRow | null>(null);
  const sorted = [...rows].sort((a, b) => b.at.localeCompare(a.at));
  const shown = all ? sorted : sorted.slice(0, 3);

  return (
    <section className="rounded-xl border border-border bg-card px-4 pb-3 pt-3.5 shadow-sm sm:px-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Today so far</h2>
        <span className="text-[12px] font-medium tabular-nums text-gray-400">{rows.length} logged</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2.5 pb-1 text-[13px] leading-snug text-muted-foreground">
          Nothing logged yet. Photos, activities, HSE taps and permits added today appear here with their time.
        </p>
      ) : (
        <ol className="ml-1 mt-3 border-l-2 border-blue-100 pl-4">
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
                  className="relative flex items-center gap-3 py-2"
                >
                  <span className={`absolute -left-[22px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-card ${dot}`} />
                  {r.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumb} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-gray-500">
                      <Icon className="size-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] font-semibold text-gray-400">
                      {hydrated ? timeOf(r.at) : '--:--'} · {label}
                    </span>
                    <span className="block text-[13px] font-medium leading-snug text-foreground">{r.text}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setAsking(r)}
                    aria-label={`Remove ${r.text} from Today so far`}
                    title="Remove from Today so far"
                    className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 ease-ios hover:bg-bad-soft hover:text-bad active:scale-95 sm:size-9"
                  >
                    <Trash2 className="size-4" />
                  </button>
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

      <ConfirmDialog
        open={asking !== null}
        title="Remove from Today so far"
        message={
          <p>
            Remove <span className="font-medium text-foreground">{asking?.text}</span> from Today so far? Only
            this line goes. What it records stays in the report.
          </p>
        }
        confirmLabel="Remove"
        onConfirm={() => {
          if (asking) onRemove(asking.id);
          setAsking(null);
        }}
        onCancel={() => setAsking(null)}
      />
    </section>
  );
}
