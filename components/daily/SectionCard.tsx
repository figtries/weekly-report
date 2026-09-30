'use client';

import { AnimatePresence, m } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Expand } from '@/components/motion/Expand';
import { pressMotion } from '@/components/motion/Press';
import { buttonVariants } from '@/components/ui/button';
import type { SectionState } from '@/lib/daily-status';
import { MOTION } from '@/lib/design';
import type { DailyReport } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { Commit } from './useDailyReport';

/** The raw pairs `STATUS_LEGEND` in WbsTreeVisual uses. No colour of its own. */
const CHIP: Record<SectionState, { label: string; cls: string }> = {
  ready: { label: 'Ready', cls: 'bg-emerald-50 text-emerald-700' },
  same: { label: 'Same as yesterday', cls: 'bg-blue-50 text-blue-700' },
  look: { label: 'Needs a look', cls: 'bg-amber-50 text-amber-700' },
  empty: { label: 'Empty', cls: 'bg-gray-100 text-gray-500' },
  held: { label: 'Held', cls: 'bg-gray-100 text-gray-500' },
};

/** The first report of a project has no yesterday to be the same as. */
export const sameLabel = (hasPredecessor: boolean) => (hasPredecessor ? 'Same as yesterday' : 'To confirm');

export interface CardProps {
  report: DailyReport;
  commit: Commit;
  state: SectionState;
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  hasPredecessor: boolean;
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
  const over = count > capacity;
  return (
    <p className={cn('mt-2 text-[12px] leading-snug', over ? 'font-medium text-amber-700' : 'text-muted-foreground')}>
      {over
        ? fold
          ? `The Excel sheet holds ${capacity} ${what}: the first ${capacity - 1} are listed and the other ${count - (capacity - 1)} are added up on the last line. Nothing is lost here.`
          : `The Excel sheet holds ${capacity} ${what}: it shows the first ${capacity - 1} and a "+${count - (capacity - 1)} lagi" line. Nothing is lost here.`
        : `The Excel sheet holds ${capacity} ${what}.`}
    </p>
  );
}

export function CardButton({
  variant = 'outline',
  className,
  ...props
}: { variant?: 'default' | 'outline' } & Omit<ComponentProps<typeof m.button>, 'ref'>) {
  return (
    <m.button
      type="button"
      {...pressMotion}
      className={cn(buttonVariants({ variant }), 'min-h-11 flex-1 sm:min-h-9', className as string)}
      {...props}
    />
  );
}

export function SectionCard({
  id,
  icon,
  title,
  summary,
  state,
  chipLabel,
  open,
  onToggle,
  actions,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  state: SectionState;
  chipLabel?: string;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const chip = CHIP[state];
  return (
    <section
      id={`daily-${id}`}
      className={cn(
        'scroll-mt-4 rounded-lg border bg-card shadow-sm transition-colors duration-200 ease-ios',
        state === 'look' ? 'border-amber-300 bg-amber-50/40' : 'border-border'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`daily-${id}-body`}
        className="flex min-h-14 w-full items-center gap-3 p-3 text-left sm:p-4"
      >
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', chip.cls)}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{title}</span>
          <span className="block text-[13px] leading-snug text-muted-foreground">{summary}</span>
        </span>
        <AnimatePresence initial={false} mode="wait">
          <m.span
            key={`${state}:${chipLabel ?? ''}`}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: MOTION.duration * 0.6, ease: [...MOTION.ease] }}
            className={cn(
              'inline-flex h-7 w-28 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold',
              chip.cls
            )}
          >
            {chipLabel ?? chip.label}
          </m.span>
        </AnimatePresence>
        <m.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
          className="shrink-0 text-muted-foreground"
        >
          <ChevronDown className="size-4" />
        </m.span>
      </button>
      <Expand open={!open && !!actions}>
        <div className="flex flex-wrap gap-2 px-3 pb-3 sm:px-4 sm:pb-4">{actions}</div>
      </Expand>
      <Expand open={open}>
        <div id={`daily-${id}-body`} className="border-t border-border p-3 sm:p-4">
          {children}
        </div>
      </Expand>
    </section>
  );
}
