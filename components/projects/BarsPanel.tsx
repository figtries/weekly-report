'use client';

import { useState } from 'react';
import { m } from 'framer-motion';
import { Flag, Plus, Trash2, X } from 'lucide-react';

import { pressMotion } from '@/components/motion/Press';
import type { SheetRow } from '@/lib/sheet';
import type { BarFact } from '@/lib/bar-facts';
import {
  DEFAULT_BAR_VIEW,
  KIND_LABEL,
  PALETTE,
  hasPackages,
  labelsByRow,
  packageKey,
  paintCss,
  paintOf,
  type BarView,
  type ColourBy,
  type MarkKey,
} from '@/lib/bar-view';
import type { BarPaint } from '@/lib/schema';

/**
 * What every bar in this plan shows (7 Oct 2026).
 *
 * The same menu in every project, nothing hidden: an option with nothing
 * behind it says so. What colour means is the user's call ("biarin mereka
 * pilih sendiri"), so the menu offers four ways and explains each in one short
 * line; it also explains every shape and mark the app draws. Every press is
 * drawn at once and saved behind it.
 */
export default function BarsPanel({
  view,
  rows,
  facts,
  fieldKinds,
  contract,
  onChange,
  onClose,
}: {
  view: BarView;
  rows: SheetRow[];
  facts: Record<string, BarFact>;
  /** The kinds of work this project's field has (lib/fields.ts). */
  fieldKinds: string[];
  /** A contract is locked, so the Contract line has something to draw. */
  contract: boolean;
  onChange: (next: BarView) => void;
  onClose: () => void;
}) {
  const [picking, setPicking] = useState<string | null>(null);
  const by = view.colourBy;
  const tasks = rows.filter((r) => !r.isSummary && !r.isMilestone);
  const labelOf = labelsByRow(rows);

  const modes: { key: ColourBy; label: string; help: string }[] = [
    { key: 'kind', label: 'Kind of work', help: 'Each kind of work gets its own colour.' },
    {
      key: 'package',
      label: 'Package',
      help: hasPackages(rows)
        ? 'Each work package gets its own colour.'
        : "No work packages yet. Mark one in a row's ⋯ menu.",
    },
    { key: 'label', label: 'My labels', help: "Make your own labels. Put one on a row in its ⋯ menu." },
    { key: 'one', label: 'One colour', help: 'Every bar the same colour.' },
  ];

  // One line per thing a colour is given to, in the mode on screen.
  const swatches: { key: string; label: string; count: number | null; paint: BarPaint }[] =
    by === 'one'
      ? [{ key: 'one', label: 'Every bar', count: null, paint: view.colours.one }]
      : by === 'package'
        ? rows
            .filter((r) => r.groupLabel !== null)
            .map((g) => ({ key: packageKey(g), label: g.groupLabel!, count: null, paint: paintOf(g, null, view, 'package') }))
        : by === 'kind'
          ? [...fieldKinds, 'none'].map((k) => ({
              key: k,
              label: KIND_LABEL[k] ?? k,
              count: tasks.filter((r) => (facts[r.id]?.kindId ?? 'none') === k).length,
              paint: paintOf({ colorGroup: -1, unitId: null }, k === 'none' ? null : k, view, 'kind'),
            }))
          : [];

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

  const setLabel = (id: string, patch: { name?: string; paint?: BarPaint }) =>
    onChange({ ...view, labels: view.labels.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const addLabel = () =>
    onChange({
      ...view,
      labels: [
        ...view.labels,
        {
          id: `l${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          name: `Label ${view.labels.length + 1}`,
          paint: PALETTE[view.labels.length % 6].key,
        },
      ],
    });
  const removeLabel = (id: string) => onChange({ ...view, labels: view.labels.filter((l) => l.id !== id) });

  const anySlip = rows.some((r) => !r.isSummary && (r.totalFloat ?? 0) > 0);
  const marks: { key: MarkKey; label: string; help: string; mark: React.ReactNode }[] = [
    {
      key: 'done',
      label: 'Done',
      help: 'Solid part is work done. Light part is still to do.',
      mark: (
        <span className="flex h-3 w-8 gap-px overflow-hidden rounded-[3px]">
          <span className="w-1/2 bg-[var(--plan-5)]" />
          <span className="w-1/2 bg-[var(--plan-5)] opacity-30" />
        </span>
      ),
    },
    {
      key: 'forecast',
      label: 'Late',
      help: 'Red stripes after a bar are the days it will run late.',
      mark: (
        <span className="flex items-center">
          <span className="h-3 w-4 rounded-l-[3px] bg-[var(--plan-5)]" />
          <span
            className="h-3 w-4 rounded-r-[3px] border border-l-0 border-[var(--bad)]"
            style={{ background: 'repeating-linear-gradient(135deg, var(--bad) 0 2px, transparent 2px 5px)' }}
          />
        </span>
      ),
    },
    {
      key: 'links',
      label: 'Links',
      help: 'Arrows show what waits for what.',
      mark: (
        <svg width="32" height="14" viewBox="0 0 32 14" aria-hidden>
          <path d="M2 3 H10 V11 H26" fill="none" stroke="var(--muted-foreground)" strokeWidth="1.5" />
          <path d="M24 8 L30 11 L24 14 z" fill="var(--muted-foreground)" />
        </svg>
      ),
    },
    {
      key: 'contract',
      label: 'Contract',
      help: contract ? 'Thin grey line under a bar is its contract dates.' : 'No contract dates on this plan.',
      mark: (
        <span className="flex w-8 flex-col gap-0.5">
          <span className="h-2.5 w-7 rounded-[3px] bg-[var(--plan-5)]" />
          <span className="ml-1 h-1 w-7 rounded-full bg-muted-foreground/40" />
        </span>
      ),
    },
    {
      key: 'slip',
      label: 'Can slip',
      help: anySlip
        ? 'Dashed line is how many days it can move without moving the finish.'
        : 'None in this plan yet. It shows once activities are linked to the finish.',
      mark: (
        <span className="flex items-center">
          <span className="h-3 w-4 rounded-[3px] bg-[var(--plan-5)]" />
          <span className="ml-0.5 w-3 border-t-[1.5px] border-dashed border-muted-foreground" />
          <span className="h-2 w-[1.5px] bg-muted-foreground" />
        </span>
      ),
    },
  ];

  // The shapes the app always draws, each in one short line.
  const arrow = (stroke: string, width: number, dash?: string) => (
    <svg width="32" height="10" viewBox="0 0 32 10" aria-hidden>
      <path d="M1 5 H25" stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
      <path d="M24 1 L31 5 L24 9 z" fill={stroke} />
    </svg>
  );
  const meanings: { mark: React.ReactNode; text: string }[] = [
    { mark: <span className="h-1.5 w-8 rounded-[1px] bg-foreground" />, text: 'Heading. Spans the rows under it.' },
    {
      mark: (
        <span className="flex h-3 w-8 gap-px overflow-hidden rounded-[3px]">
          <span className="w-1/3 bg-[var(--plan-5)]" />
          <span className="w-1/3 bg-[var(--plan-5)]" />
          <span className="w-1/3 bg-[var(--plan-5)] opacity-30" />
        </span>
      ),
      text: 'Cuts in a bar. Its stages, from its kind of work.',
    },
    { mark: <span className="size-2.5 rotate-45 rounded-[1px] bg-foreground" />, text: 'Milestone. One date.' },
    { mark: <Flag className="size-3.5 text-[var(--plan-3)]" />, text: 'Flag. The day it must be on site.' },
    { mark: arrow('var(--muted-foreground)', 1.4), text: 'Grey arrow. This one waits for that one.' },
    { mark: arrow('var(--foreground)', 1.4), text: 'Black arrow. The pressed bar\'s links, or the chain that sets the project finish.' },
    { mark: arrow('var(--bad)', 1.6, '4 3'), text: 'Red dashed arrow. The dates break this link.' },
    {
      mark: <span className="whitespace-nowrap text-[10px] font-medium text-muted-foreground">+7 d</span>,
      text: 'Days on an arrow. The wait between the two.',
    },
    {
      mark: <span className="h-3 w-8 rounded-[3px] bg-[var(--plan-5)] ring-2 ring-[var(--bad)]" />,
      text: 'Red outline. This one sets the project finish.',
    },
    {
      mark: (
        <span
          style={{
            width: 0,
            height: 0,
            borderLeft: '5px solid transparent',
            borderRight: '5px solid transparent',
            borderTop: '8px solid var(--foreground)',
          }}
        />
      ),
      text: 'Target date.',
    },
    {
      mark: <span className="grid size-3.5 place-items-center rounded-full bg-[var(--bad)] text-[9px] font-bold text-white">!</span>,
      text: 'Starts before what it waits for.',
    },
    { mark: <span className="h-4 border-l-[1.5px] border-dashed border-sky-500" />, text: 'Today.' },
  ];

  const swatchButton = (key: string, paint: BarPaint, name: string) => (
    <m.button
      {...pressMotion}
      type="button"
      onClick={() => setPicking((p) => (p === key ? null : key))}
      aria-label={`Colour for ${name}`}
      aria-expanded={picking === key}
      className="grid size-11 shrink-0 place-items-center rounded-lg hover:bg-muted"
    >
      <span className="size-6 rounded-md ring-1 ring-border" style={{ background: paintCss(paint) }} />
    </m.button>
  );
  const palette = (key: string, current: BarPaint, apply: (p: BarPaint) => void) =>
    picking === key && (
      <div className="animate-fade-in-up grid grid-cols-6 gap-2 pb-2 pt-1">
        {PALETTE.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => {
              apply(p.key);
              setPicking(null);
            }}
            aria-label={p.label}
            title={p.label}
            className={`aspect-square min-h-11 w-full rounded-lg ring-offset-2 ring-offset-card ${
              p.key === current ? 'ring-2 ring-foreground' : 'ring-1 ring-border'
            }`}
            style={{ background: paintCss(p.key) }}
          />
        ))}
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Bars"
        className="animate-enter max-h-[88vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">Bars</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Choose what the colours mean. Change it any time.</p>
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
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-[10px] border p-0.5">
          {modes.map((mo) => (
            <button
              key={mo.key}
              type="button"
              onClick={() => onChange({ ...view, colourBy: mo.key })}
              aria-pressed={by === mo.key}
              className={`min-h-11 rounded-lg px-2 text-[13px] font-medium transition-colors duration-200 ease-ios ${
                by === mo.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {mo.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">{modes.find((mo) => mo.key === by)?.help}</p>

        {by === 'label' ? (
          <div className="mt-3 divide-y rounded-[10px] border">
            {view.labels.map((l) => (
              <div key={l.id} className="px-2 py-1">
                <div className="flex min-h-11 items-center gap-1">
                  {swatchButton(l.id, l.paint, l.name)}
                  {/* Saved when the box is left (or Enter), not on every key:
                      each save is a write and a snapshot push. */}
                  <input
                    defaultValue={l.name}
                    onBlur={(e) => {
                      const name = e.target.value.trim();
                      if (name && name !== l.name) setLabel(l.id, { name });
                      else e.target.value = l.name;
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                    aria-label="Label name"
                    maxLength={40}
                    className="h-11 min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 text-[13px] outline-none focus:border-input"
                  />
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {((n) => `${n} ${n === 1 ? 'row' : 'rows'}`)(tasks.filter((r) => labelOf.get(r.id) === l.id).length)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLabel(l.id)}
                    aria-label={`Delete ${l.name}`}
                    className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {palette(l.id, l.paint, (p) => setLabel(l.id, { paint: p }))}
              </div>
            ))}
            <button
              type="button"
              onClick={addLabel}
              className="flex min-h-11 w-full items-center gap-2 px-3 text-[13px] font-medium text-primary hover:bg-muted/50"
            >
              <Plus className="size-4" />
              Add label
            </button>
          </div>
        ) : (
          swatches.length > 0 && (
            <div className="mt-3 divide-y rounded-[10px] border">
              {swatches.map((s) => (
                <div key={s.key} className="px-3 py-1">
                  <div className="flex min-h-11 items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {s.label}
                      {s.count != null && (
                        <span className="ml-1.5 text-muted-foreground">
                          {s.count} {s.count === 1 ? 'row' : 'rows'}
                        </span>
                      )}
                    </span>
                    {swatchButton(s.key, s.paint, s.label)}
                  </div>
                  {palette(s.key, s.paint, (p) => setColour(s.key, p))}
                </div>
              ))}
            </div>
          )
        )}

        <p className="mt-5 text-[13px] font-medium">Beside each bar</p>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-[10px] border p-0.5">
          {(
            [
              ['name', 'Name'],
              ['name-pct', 'Name and done'],
              ['dates', 'Dates'],
              ['none', 'Nothing'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onChange({ ...view, beside: key })}
              aria-pressed={view.beside === key}
              className={`min-h-11 rounded-lg px-2 text-[13px] font-medium transition-colors duration-200 ease-ios ${
                view.beside === key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">Written to the right of each bar, always on show.</p>

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

        <p className="mt-5 text-[13px] font-medium">What the bars mean</p>
        <ul className="mt-2 divide-y rounded-[10px] border">
          {meanings.map((mn) => (
            <li key={mn.text} className="flex min-h-11 items-center gap-3 px-3 py-1.5 text-[13px]">
              <span aria-hidden className="grid w-9 shrink-0 place-items-center">
                {mn.mark}
              </span>
              {mn.text}
            </li>
          ))}
        </ul>

        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_BAR_VIEW, labels: view.labels })}
            className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted"
          >
            Reset
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
