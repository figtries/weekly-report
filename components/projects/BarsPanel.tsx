'use client';

import { useState } from 'react';
import { m } from 'framer-motion';
import { X } from 'lucide-react';

import { pressMotion } from '@/components/motion/Press';
import type { SheetRow } from '@/lib/sheet';
import type { BarFact } from '@/lib/bar-facts';
import { BUILT_IN_KINDS } from '@/lib/work-kind';
import {
  DEFAULT_BAR_VIEW,
  KIND_KEYS,
  PALETTE,
  canColourByPackage,
  effectiveColourBy,
  packageKey,
  paintCss,
  paintOf,
  type BarView,
  type ColourBy,
  type MarkKey,
} from '@/lib/bar-view';
import type { BarPaint } from '@/lib/schema';

/**
 * What every bar in this plan shows, in one place (7 Oct 2026).
 *
 * It replaced a rule list (When / Colour / Shape, first match wins) that asked
 * a planner to design a legend. Here there are only two questions: what colour
 * should SAY, and which of four marks to show. Every press is drawn on the
 * timeline at once and saved behind it.
 */
export default function BarsPanel({
  view,
  rows,
  facts,
  contract,
  onChange,
  onClose,
}: {
  view: BarView;
  rows: SheetRow[];
  facts: Record<string, BarFact>;
  /** A contract is locked, so the Contract mark has something to show. */
  contract: boolean;
  onChange: (next: BarView) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const packages = canColourByPackage(rows);
  const by = effectiveColourBy(view, rows);
  const tasks = rows.filter((r) => !r.isSummary && !r.isMilestone);

  const modes: { key: ColourBy; label: string }[] = [
    { key: 'kind', label: 'Kind of work' },
    ...(packages ? [{ key: 'package' as const, label: 'Package' }] : []),
    { key: 'one', label: 'One colour' },
  ];

  // One line per thing a colour is given to, in the mode on screen.
  const swatches: { key: string; label: string; count: number | null; paint: BarPaint }[] =
    by === 'one'
      ? [{ key: 'one', label: 'Every bar', count: null, paint: view.colours.one }]
      : by === 'package'
        ? rows
            .filter((r) => r.groupLabel !== null)
            .map((g) => ({
              key: packageKey(g),
              label: g.groupLabel!,
              count: null,
              paint: paintOf(g, null, view, 'package'),
            }))
        : KIND_KEYS.map((k) => ({
            key: k,
            label: BUILT_IN_KINDS.find((b) => b.id === k)?.label ?? 'Kind not set',
            count: tasks.filter((r) => (facts[r.id]?.kindId ?? 'none') === k).length,
            paint: paintOf({ colorGroup: -1, unitId: null }, k === 'none' ? null : k, view, 'kind'),
          }));

  function setColour(key: string, paint: BarPaint) {
    const colours =
      by === 'one'
        ? { ...view.colours, one: paint }
        : by === 'package'
          ? { ...view.colours, package: { ...view.colours.package, [key]: paint } }
          : { ...view.colours, kind: { ...view.colours.kind, [key]: paint } };
    onChange({ ...view, colours });
    setPicking(null);
  }

  const marks: { key: MarkKey; label: string; help: string; mark: React.ReactNode }[] = [
    {
      key: 'done',
      label: 'Done',
      help: 'The solid part of a bar is what is done so far, stage by stage.',
      mark: (
        <span className="flex h-3 w-8 gap-px overflow-hidden rounded-[3px]">
          <span className="w-1/2 bg-[var(--plan-1)]" />
          <span className="w-1/2 bg-[var(--plan-1)] opacity-30" />
        </span>
      ),
    },
    {
      key: 'forecast',
      label: 'Forecast',
      help: 'A red hatch after a bar is the days it will run past its plan.',
      mark: (
        <span className="flex items-center">
          <span className="h-3 w-4 rounded-l-[3px] bg-[var(--plan-1)]" />
          <span
            className="h-3 w-4 rounded-r-[3px] border border-l-0 border-[var(--bad)]"
            style={{ background: 'repeating-linear-gradient(135deg, var(--bad) 0 2px, transparent 2px 5px)' }}
          />
        </span>
      ),
    },
    ...(contract
      ? [
          {
            key: 'contract' as const,
            label: 'Contract',
            help: 'A thin grey line under a bar is the dates locked in the contract.',
            mark: (
              <span className="flex w-8 flex-col gap-0.5">
                <span className="h-2.5 w-7 rounded-[3px] bg-[var(--plan-1)]" />
                <span className="ml-1 h-1 w-7 rounded-full bg-muted-foreground/40" />
              </span>
            ),
          },
        ]
      : []),
    {
      key: 'slip',
      label: 'Can slip',
      help: 'A dashed tail is how many days it can move before the project finish moves.',
      mark: (
        <span className="flex items-center">
          <span className="h-3 w-4 rounded-[3px] bg-[var(--plan-1)]" />
          <span className="ml-0.5 w-3 border-t-[1.5px] border-dashed border-muted-foreground" />
          <span className="h-2 w-[1.5px] bg-muted-foreground" />
        </span>
      ),
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Bars"
        className="animate-enter max-h-[88vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Bars</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">What every bar in this plan shows.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </div>

        <p className="mt-5 text-[13px] font-medium">Colour bars by</p>
        <div className="mt-2 flex rounded-[10px] border p-0.5">
          {modes.map((mo) => (
            <button
              key={mo.key}
              type="button"
              onClick={() => onChange({ ...view, colourBy: mo.key })}
              aria-pressed={by === mo.key}
              className={`min-h-11 flex-1 rounded-lg px-2 text-[13px] font-medium transition-colors duration-200 ease-ios ${
                by === mo.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {mo.label}
            </button>
          ))}
        </div>

        <div className="mt-3 divide-y rounded-[10px] border">
          {swatches.map((s) => (
            <div key={s.key} className="px-3 py-1.5">
              <div className="flex min-h-11 items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {s.label}
                  {s.count != null && (
                    <span className="ml-1.5 text-muted-foreground">
                      {s.count} {s.count === 1 ? 'row' : 'rows'}
                    </span>
                  )}
                </span>
                <m.button
                  {...pressMotion}
                  type="button"
                  onClick={() => setPicking((p) => (p === s.key ? null : s.key))}
                  aria-label={`Colour for ${s.label}`}
                  aria-expanded={picking === s.key}
                  className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-[12px] text-muted-foreground hover:bg-muted"
                >
                  <span className="size-6 rounded-md ring-1 ring-border" style={{ background: paintCss(s.paint) }} />
                  Change
                </m.button>
              </div>
              {picking === s.key && (
                <div className="animate-fade-in-up flex flex-wrap gap-2 pb-2 pt-1">
                  {PALETTE.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setColour(s.key, p.key)}
                      aria-label={p.label}
                      title={p.label}
                      className={`size-11 rounded-lg ring-offset-2 ring-offset-card transition-shadow duration-200 ease-ios ${
                        p.key === s.paint ? 'ring-2 ring-foreground' : 'ring-1 ring-border'
                      }`}
                      style={{ background: paintCss(p.key) }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <p className="mt-5 text-[13px] font-medium">Show on the timeline</p>
        <div className="mt-2 divide-y rounded-[10px] border">
          {marks.map((mk) => {
            const on = view.marks[mk.key];
            return (
              <button
                key={mk.key}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => onChange({ ...view, marks: { ...view.marks, [mk.key]: !on } })}
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
              >
                <span aria-hidden className="grid w-9 shrink-0 place-items-center">
                  {mk.mark}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{mk.label}</span>
                  <span className="block text-[12px] leading-snug text-muted-foreground">{mk.help}</span>
                </span>
                <span
                  aria-hidden
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 ease-ios ${
                    on ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-[left] duration-200 ease-ios ${
                      on ? 'left-[18px]' : 'left-0.5'
                    }`}
                  />
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_BAR_VIEW)}
            className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted"
          >
            Back to standard
          </button>
          <m.button
            {...pressMotion}
            type="button"
            onClick={onClose}
            className="btn-primary ml-auto min-h-11 rounded-lg px-5 text-[13px] font-semibold"
          >
            Done
          </m.button>
        </div>
      </div>
    </div>
  );
}
