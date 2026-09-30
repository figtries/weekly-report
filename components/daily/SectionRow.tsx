'use client';

import { AnimatePresence, m } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { pressMotion } from '@/components/motion/Press';
import type { SectionState } from '@/lib/daily-status';
import { MOTION } from '@/lib/design';
import type { DailyReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Marker } from './Marker';
import { Panel } from './Panel';
import type { Commit } from './useDailyReport';

/** What every part of the report is given by the screen. */
export interface SectionProps {
  report: DailyReport;
  commit: Commit;
  state: SectionState;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  hasPredecessor: boolean;
}

/** The small blue words after a summary: why a row is waiting on you. The first report of a project has no yesterday. */
export const sameHint = (hasPredecessor: boolean) => (hasPredecessor ? 'same as yesterday' : 'to confirm');

/**
 * One card holding a few rows separated by hairlines, like the lists on Dashboard and
 * Data Overall. Rows, not a grid of boxes: a grid made every part of the report the same
 * size whatever it held, and left ragged gaps wherever one was open.
 */
export function GroupCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-xl border border-border bg-card shadow-sm', className)}>
      <h2 className="px-4 pb-1 pt-3.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 sm:px-5">{title}</h2>
      {children}
    </section>
  );
}

/** The quiet action on a row (Confirm, Close it): outline, blue ink, the way the weekly "Report" door is. */
export function RowButton({
  primary,
  className,
  ...props
}: { primary?: boolean } & Omit<ComponentProps<typeof m.button>, 'ref'>) {
  return (
    <m.button
      type="button"
      {...pressMotion}
      className={cn(
        'inline-flex h-10 shrink-0 items-center justify-center rounded-lg border px-3 text-[13px] font-semibold transition-colors duration-200 sm:h-8',
        primary
          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover'
          : 'border-border bg-card text-chart-1 hover:bg-chart-1/10',
        className as string
      )}
      {...props}
    />
  );
}

/**
 * The Excel sheet holds a fixed number of lines per block (the client's form; nobody has
 * ever inserted a row in 348 reports). Past it the sheet shows the first ones and a
 * "+N lagi" line, and this says so while it is still fixable. Nothing is lost in the app.
 */
export function CapacityNote({
  count,
  capacity,
  what,
  fold,
}: {
  count: number;
  capacity: number;
  what: string;
  /** Numeric tables fold the overflow into a last "Lainnya" row instead of cutting it. */
  fold?: boolean;
}) {
  // Silent until it matters: a limit printed under every list made the screen read as the
  // form it exports to. It speaks only when the sheet will not hold what is here.
  if (count <= capacity) return null;
  return (
    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[12px] font-medium leading-snug text-amber-700">
      {fold
        ? `The Excel sheet holds ${capacity} ${what}: the first ${capacity - 1} are listed and the other ${count - (capacity - 1)} are added up on the last line. Nothing is lost here.`
        : `The Excel sheet holds ${capacity} ${what}: it shows the first ${capacity - 1} and a "+${count - (capacity - 1)} lagi" line. Nothing is lost here.`}
    </p>
  );
}

export function SectionRow({
  id,
  title,
  summary,
  hint,
  state,
  actions,
  stackActions,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: ReactNode;
  hint?: string;
  state: SectionState;
  /** A quiet action or two shown on the row itself; gone (with a short fade) once it is done. */
  actions?: ReactNode;
  /** Two buttons do not fit beside a title on a phone: below the summary there, beside it from `sm`. */
  stackActions?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div id={`daily-${id}`} data-state={state} className="border-t border-border first:border-t-0">
      <div
        className={cn(
          'flex min-h-[64px] items-center gap-2 pl-4 pr-2 transition-colors duration-200 ease-ios hover:bg-muted/40 sm:pl-5 sm:pr-3',
          stackActions && 'flex-wrap sm:flex-nowrap'
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`daily-${id}-panel`}
          className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 py-3 text-left"
        >
          <Marker state={state} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight tracking-tight text-foreground">{title}</span>
            <span
              className={cn(
                'mt-0.5 block text-[13px] leading-snug',
                state === 'look' ? 'text-amber-700' : 'text-muted-foreground'
              )}
            >
              {summary}
              {hint && <span className="text-blue-600"> · {hint}</span>}
            </span>
          </span>
        </button>
        <AnimatePresence initial={false}>
          {actions ? (
            <m.div
              key="actions"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: MOTION.duration * 0.7, ease: [...MOTION.ease] }}
              className={cn(
                'flex shrink-0 gap-2',
                // pl-9 = the marker (24px) and its gap (12px), so the buttons start under the title.
                stackActions && 'order-last basis-full pb-3 pl-9 sm:order-none sm:basis-auto sm:pb-0 sm:pl-0'
              )}
            >
              {actions}
            </m.div>
          ) : null}
        </AnimatePresence>
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          aria-label={open ? `Close ${title}` : `Open ${title}`}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors duration-200 hover:bg-muted"
        >
          <m.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.34, ease: [...MOTION.ease] }}>
            <ChevronDown className="size-[18px]" />
          </m.span>
        </button>
      </div>
      <Panel id={`daily-${id}-panel`} open={open}>
        {children}
      </Panel>
    </div>
  );
}
