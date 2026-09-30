'use client';

import { m } from 'framer-motion';
import { Minus, Plus } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';

export const INPUT_CLS =
  'min-h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground focus:border-chart-1 focus:outline-none focus:ring-1 focus:ring-chart-1 sm:min-h-9';

/** True once hydrated. Clock times are shown in the viewer's zone, which the server cannot know. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

/** A number that commits on blur or Enter. Focus selects it, so typing over a shown 0 just works. */
export function NumField({
  value,
  onCommit,
  label,
  min = 0,
  max,
  step,
  className,
}: {
  value: number;
  onCommit: (n: number) => void;
  label: string;
  min?: number;
  max?: number;
  step?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      aria-label={label}
      type="number"
      inputMode="decimal"
      min={min}
      max={max}
      step={step}
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft === null) return;
        const raw = draft === '' ? min : Number(draft);
        const n = Math.min(max ?? Infinity, Math.max(min, Number.isFinite(raw) ? raw : min));
        setDraft(null);
        if (n !== value) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={cn(INPUT_CLS, 'text-right tabular-nums', className)}
    />
  );
}

/** A field that reads as plain text until it is touched: no box, no padding, a wash on hover. */
const BARE_CLS =
  'min-h-0 border-transparent bg-transparent px-0 py-1.5 hover:bg-muted/40 focus:border-chart-1 focus:bg-card focus:px-3 sm:min-h-0';

/** Text that commits on blur (and Enter, when single-line). */
export function TextField({
  value,
  onCommit,
  label,
  placeholder,
  multiline,
  bare,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  /** Plain text until touched, for a list of sentences that should read as a list, not as a form. */
  bare?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => {
    if (draft === null) return;
    const v = draft.trim();
    setDraft(null);
    if (v !== value) onCommit(v);
  };
  if (multiline) {
    // Grows with what is typed: a sentence from the site is often longer than
    // one line at phone width, and a clipped sentence cannot be checked.
    const fit = (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    return (
      <textarea
        ref={fit}
        aria-label={label}
        rows={1}
        placeholder={placeholder}
        value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)}
        onInput={(e) => fit(e.currentTarget)}
        onBlur={finish}
        className={cn(INPUT_CLS, 'resize-none overflow-hidden', bare && BARE_CLS, className)}
      />
    );
  }
  return (
    <input
      aria-label={label}
      placeholder={placeholder}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={cn(INPUT_CLS, bare && BARE_CLS, className)}
    />
  );
}

/** A small label above a field: a filled field with no name reads as unexplained. */
export function Labeled({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const STEP_BTN =
  'flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-chart-1 transition-colors duration-150 hover:bg-chart-1/10 disabled:opacity-40 sm:size-9';

/** People, or hours in halves: a count you press, not a number you type. */
export function Stepper({
  value,
  onChange,
  label,
  step = 1,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  step?: number;
}) {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const set = (n: number) => onChange(Math.max(0, Math.round(n * 100) / 100));
  return (
    <div className="flex items-center" role="group" aria-label={label}>
      <m.button
        type="button"
        {...pressMotion}
        className={STEP_BTN}
        aria-label={`Decrease ${label}`}
        disabled={value <= 0}
        onClick={() => set(value - step)}
      >
        <Minus className="size-4" />
      </m.button>
      <span className="w-9 text-center text-base font-semibold tabular-nums text-foreground">{shown}</span>
      <m.button
        type="button"
        {...pressMotion}
        className={STEP_BTN}
        aria-label={`Increase ${label}`}
        onClick={() => set(value + step)}
      >
        <Plus className="size-4" />
      </m.button>
    </div>
  );
}
