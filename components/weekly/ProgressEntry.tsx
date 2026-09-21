'use client';

import { m } from 'framer-motion';

import type { MapNode } from '@/lib/overall-map';
import type { Shape } from '@/lib/work-kind';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';
import type { Draft } from './ActivityPanel';

/**
 * The form that asks for EVIDENCE, and never for a percent.
 *
 * Of 218 leaves in the reference project at week 60, 85 sat at exactly 0 and
 * 108 at exactly 100. Only 25 were ever anywhere in between. Nobody was
 * estimating — they were flipping a switch, because for most rows a switch is
 * the honest instrument and the app never offered one. Each form below asks
 * for a fact a site foreman says out loud every day: a rung reached, a count
 * done, a thing finished on a date.
 *
 * The percent itself is not here. It is the figure at the bottom of the panel,
 * which is an input: editable at any moment, on any row, with nothing to press
 * first. Typing in it wins until somebody touches the evidence again.
 *
 * SHAPE IS DERIVED, NEVER STORED — `deriveShape` reads it off `method` and
 * `milestones.length` every time, so there is no extra column for something
 * two existing ones already imply.
 */

/**
 * Kept as its own name because four files import it, but it is now exactly
 * `Shape`: the forms on screen and the answers the picker offers are the same
 * four things, which is the whole point of the change that removed 'quote'.
 */
export type EntryShape = Shape;

/** Reused by the picker to preview what a chosen shape turns into. */
export function deriveShape(node: Pick<MapNode, 'method' | 'milestones' | 'source'>): EntryShape {
  if (node.method === 'qty') return 'qty';
  if (node.method === 'milestone') {
    return (node.milestones ?? []).length === 1 ? 'gate' : 'steps';
  }
  // Includes every row saved as a quote before that form was folded away: it
  // was lumpsum all along, and its stored note is left exactly where it is.
  return 'manual';
}

type SetDraft = (fn: (d: Draft) => Draft) => void;

const round2 = (v: number) => Math.round(v * 100) / 100;
const fmt1 = (v: number) => v.toFixed(1);

export default function ProgressEntry({
  node,
  draft,
  setDraft,
  shape,
  onManualOff,
}: {
  node: MapNode;
  draft: Draft;
  setDraft: SetDraft;
  shape: EntryShape;
  onManualOff: () => void;
}) {
  /**
   * THE FORM IS NEVER SWAPPED AWAY, AND THERE IS NO BUTTON TO SWAP IT.
   *
   * Typing a percent by hand used to hide the ladder and put a percent box in
   * its place, reached through one button and left through another. Three
   * controls for one row. The figure at the bottom of the panel is an input
   * now, so the percent is simply editable, always: type in it and the typed
   * figure wins, touch a rung or the count and the evidence takes over again.
   * That handover is what this wrapper does, and it is why nothing here asks
   * anybody anything.
   */
  const setFromEvidence: SetDraft = (fn) => {
    onManualOff();
    setDraft(fn);
  };

  return (
    <>
      {node.method === 'qty' && (
        <QuantityEntry node={node} draft={draft} setDraft={setFromEvidence} />
      )}
      {node.method !== 'qty' && shape === 'gate' && (
        <GateEntry node={node} draft={draft} setDraft={setFromEvidence} />
      )}
      {node.method !== 'qty' && shape === 'steps' && (
        <MilestoneEntry node={node} draft={draft} setDraft={setFromEvidence} />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ gate */

function GateEntry({
  node,
  draft,
  setDraft,
}: {
  node: MapNode;
  draft: Draft;
  setDraft: SetDraft;
}) {
  const gateId = (node.milestones ?? [])[0]?.id ?? 'done';
  const isDone = draft.milestonesDone.includes(gateId);
  const dateMatch = /^on (.+)$/.exec(draft.note ?? '');
  const date = dateMatch ? dateMatch[1] : '';

  function toggle() {
    setDraft((d) => ({
      ...d,
      milestonesDone: d.milestonesDone.includes(gateId) ? [] : [gateId],
    }));
  }

  function setDate(value: string) {
    setDraft((d) => ({ ...d, note: value ? `on ${value}` : '' }));
  }

  return (
    <>
      <m.button
        {...pressMotion}
        type="button"
        onClick={toggle}
        aria-pressed={isDone}
        className={cn(
          'flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border px-4 text-left transition-colors duration-200 ease-ios',
          isDone ? 'border-ok/30 bg-ok-soft' : 'border-input bg-card hover:bg-muted/50'
        )}
      >
        <span className="min-w-0 flex-1 text-[15px] font-medium text-foreground">{node.name}</span>
        <span
          className={cn(
            'shrink-0 text-sm font-semibold',
            isDone ? 'text-ok' : 'text-muted-foreground'
          )}
        >
          {isDone ? 'Done' : 'Not yet'}
        </span>
      </m.button>
      <label className="mt-3 block text-[13px] text-muted-foreground">
        When
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
        />
      </label>
    </>
  );
}

/* --------------------------------------------------------------- quantity */

function QuantityEntry({
  node,
  draft,
  setDraft,
}: {
  node: MapNode;
  draft: Draft;
  setDraft: SetDraft;
}) {
  const total = node.qtyTotal && node.qtyTotal > 0 ? node.qtyTotal : 1;
  const step = total >= 1000 ? 50 : total >= 100 ? 10 : 1;
  const set = (v: number) => setDraft((d) => ({ ...d, qtyDone: Math.max(0, Math.min(total, v)) }));

  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        {node.unit ? `${node.unit} done, total` : 'Quantity done, total'}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <StepBtn label="Less" onClick={() => set(round2(draft.qtyDone - step))}>−</StepBtn>
        <input
          type="number"
          inputMode="decimal"
          value={String(draft.qtyDone)}
          onChange={(e) => set(Number(e.target.value))}
          className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-center text-xl font-semibold tabular-nums text-foreground shadow-sm transition-colors duration-200 ease-ios focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
        />
        <StepBtn label="More" onClick={() => set(round2(draft.qtyDone + step))}>+</StepBtn>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        of {total.toLocaleString('en-GB')} {node.unit ?? ''}
      </p>
    </>
  );
}

/* --------------------------------------------------------------- steps */

function MilestoneEntry({
  node,
  draft,
  setDraft,
}: {
  node: MapNode;
  draft: Draft;
  setDraft: SetDraft;
}) {
  const ms = node.milestones ?? [];
  const toggle = (id: string) =>
    setDraft((d) => ({
      ...d,
      milestonesDone: d.milestonesDone.includes(id)
        ? d.milestonesDone.filter((x) => x !== id)
        : [...d.milestonesDone, id],
    }));

  return (
    <>
      <p className="text-[13px] text-muted-foreground">How far has it got?</p>
      <div className="mt-2 space-y-1.5">
        {ms.map((step) => {
          const done = draft.milestonesDone.includes(step.id);
          return (
            <m.button
              key={step.id}
              {...pressMotion}
              onClick={() => toggle(step.id)}
              aria-pressed={done}
              className={cn(
                'flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left text-sm transition-colors duration-200 ease-ios',
                done
                  ? 'border-ok/30 bg-ok-soft text-foreground'
                  : 'border-input bg-card text-foreground hover:bg-muted/50'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition-colors duration-200 ease-ios',
                  done ? 'border-ok bg-ok text-white' : 'border-input bg-card'
                )}
              >
                {done && (
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M5 10.5l3.5 3.5L15 7" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="min-w-0 flex-1">{step.label}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmt1(step.weight)}%</span>
            </m.button>
          );
        })}
      </div>
    </>
  );
}


function StepBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <m.button
      {...pressMotion}
      onClick={onClick}
      aria-label={label}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-input bg-card text-lg font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60"
    >
      {children}
    </m.button>
  );
}
