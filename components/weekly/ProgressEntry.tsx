'use client';

import { m } from 'framer-motion';

import type { MapNode } from '@/lib/overall-map';
import type { Shape } from '@/lib/work-kind';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';
import type { Draft } from './ActivityPanel';

/**
 * The four questions, and none of them is "how many percent".
 *
 * Of 218 leaves in the reference project at week 60, 85 sat at exactly 0 and
 * 108 at exactly 100. Only 25 were ever anywhere in between. Nobody was
 * estimating — they were flipping a switch, because for most rows a switch is
 * the honest instrument and the app never offered one. Each shape below asks
 * for a FACT a site foreman says out loud every day; only Manual asks for a
 * judgement, and it says so.
 *
 * SHAPE IS DERIVED, NEVER STORED — `deriveShape` reads it off `method`,
 * `milestones.length` and `source` every time, so there is no fourth column
 * for something two existing ones already imply.
 */

export type EntryShape = Shape | 'manual';

/** Reused by the Task 7 picker to preview what a chosen shape turns into. */
export function deriveShape(node: Pick<MapNode, 'method' | 'milestones' | 'source'>): EntryShape {
  if (node.method === 'milestone') {
    return (node.milestones ?? []).length === 1 ? 'gate' : 'steps';
  }
  if (node.method === 'lumpsum' && node.source === 'quote') return 'quote';
  return 'manual';
}

type SetDraft = (fn: (d: Draft) => Draft) => void;

const round2 = (v: number) => Math.round(v * 100) / 100;
const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const fmt1 = (v: number) => v.toFixed(1);
const fmt2 = (v: number) => v.toFixed(2);

/**
 * The percent this draft comes to right now, whatever shape is on screen.
 *
 * Mirrors `pctOfDraft` in ActivityPanel.tsx rather than importing it: that
 * file imports `ProgressEntry`/`deriveShape` from this one already, and a
 * second cross-import would make the two circular. This is preview
 * arithmetic over what is already sitting in the draft, not a leaf's
 * percentage — `lib/progress.ts` is still the only thing allowed to write
 * one, and this value is never saved anywhere.
 */
function currentPct(node: MapNode, draft: Draft, manual: boolean): number {
  if (!manual && node.method === 'qty') {
    const total = node.qtyTotal && node.qtyTotal > 0 ? node.qtyTotal : 1;
    return clampPct(round2((draft.qtyDone / total) * 100));
  }
  if (!manual && node.method === 'milestone') {
    const ms = node.milestones ?? [];
    const total = ms.reduce((s, step) => s + step.weight, 0);
    if (!total) return 0;
    const done = ms
      .filter((step) => draft.milestonesDone.includes(step.id))
      .reduce((s, step) => s + step.weight, 0);
    return clampPct(round2((done / total) * 100));
  }
  return clampPct(round2(draft.pct));
}

/**
 * What today's answer just did to the plan, in three short facts: the rise
 * since last week, where that puts the row against the plan, and what the
 * row is worth to the project at that figure. Every value here is already on
 * `node` or `draft` — no new query, no new prop, and no re-derivation of a
 * leaf's own percentage.
 */
function PlanFacts({ node, draft, manual }: { node: MapNode; draft: Draft; manual: boolean }) {
  const pct = currentPct(node, draft, manual);
  const lastWeek = round2(node.actualPct - node.weekPct);
  const rise = round2(pct - lastWeek);

  let riseLine: string;
  if (rise > 0.05) riseLine = `Up ${fmt1(rise)} points to ${fmt1(pct)}%`;
  else if (rise < -0.05) riseLine = `Down ${fmt1(-rise)} points to ${fmt1(pct)}%`;
  else riseLine = `Unchanged, still at ${fmt1(pct)}%`;

  // No schedule reaches this row: compared against zero it would always
  // read as "ahead", which is not a fact about the row, just an absence.
  let planLine: string | null = null;
  if (node.planPct > 0) {
    const behind = round2(node.planPct - pct);
    if (behind > 0.05) planLine = `Plan says ${fmt1(node.planPct)} this week, so ${fmt1(behind)} behind`;
    else if (behind < -0.05)
      planLine = `Plan says ${fmt1(node.planPct)} this week, so ${fmt1(-behind)} ahead`;
    else planLine = `Plan says ${fmt1(node.planPct)} this week, exactly on plan`;
  }

  const points = round2((pct / 100) * node.weight);

  return (
    <div className="mt-3 space-y-0.5 text-[12px] leading-relaxed text-muted-foreground">
      <p>{riseLine}</p>
      {planLine && <p>{planLine}</p>}
      <p>This row carries {fmt2(points)} points of the project</p>
    </div>
  );
}

export default function ProgressEntry({
  node,
  draft,
  setDraft,
  shape,
  manual,
  onManual,
  onManualOff,
}: {
  node: MapNode;
  draft: Draft;
  setDraft: SetDraft;
  shape: EntryShape;
  manual: boolean;
  onManual: () => void;
  onManualOff: () => void;
}) {
  // Quantity mode exists in the app, is not part of this ladder, and is left
  // exactly as it was: a count is already a fact, so it keeps its own form
  // rather than being folded into "manual". The escape hatch still reaches
  // it, because point 8 is unconditional: every row, whatever form it is
  // showing, can be typed over by hand.
  const showQuantity = !manual && node.method === 'qty';
  // The form actually on screen is the manual percent form either because the
  // escape hatch was pressed, or because the row has no ladder/quote and
  // never needed one. Either way, offering to swap TO the form already
  // showing reads as a control that does nothing.
  const isManualForm = manual || (!showQuantity && shape === 'manual');

  return (
    <>
      {/* EVERY arm below is gated on `isManualForm`, not on `shape` alone.
          The first cut keyed them off `shape` only, so pressing the escape
          hatch on a ladder row hid the button, left the ladder on screen and
          never rendered the percent box: the form could not be typed into at
          all. Worse, the save path already honoured `manual`, so the press
          silently changed what would be written while showing nothing. The
          escape hatch is point 8 of the spec and it is unconditional, so the
          thing that decides which form is drawn has to be the same value that
          decides whether the hatch is open. */}
      {showQuantity && <QuantityEntry node={node} draft={draft} setDraft={setDraft} />}
      {isManualForm && <PercentEntry draft={draft} setDraft={setDraft} />}
      {!showQuantity && !isManualForm && shape === 'gate' && (
        <GateEntry node={node} draft={draft} setDraft={setDraft} />
      )}
      {!showQuantity && !isManualForm && shape === 'steps' && (
        <MilestoneEntry node={node} draft={draft} setDraft={setDraft} />
      )}
      {!showQuantity && !isManualForm && shape === 'quote' && (
        <QuoteEntry draft={draft} setDraft={setDraft} />
      )}

      <PlanFacts node={node} draft={draft} manual={manual} />

      {/* A one-way door is not flexibility. Someone who types a percent and
          then wants the ladder back had to close the panel and reopen it,
          which looks like the app losing their place. */}
      {!isManualForm && (
        <button
          type="button"
          onClick={onManual}
          className="mt-3 min-h-11 w-full rounded-xl text-sm text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted/50 hover:text-foreground"
        >
          Type a percent instead
        </button>
      )}
      {manual && shape !== 'manual' && (
        <button
          type="button"
          onClick={onManualOff}
          className="mt-3 min-h-11 w-full rounded-xl text-sm text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted/50 hover:text-foreground"
        >
          {shape === 'gate'
            ? 'Go back to Not yet / Done'
            : shape === 'quote'
              ? 'Go back to the vendor report'
              : 'Go back to the steps'}
        </button>
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

/* --------------------------------------------------------------- quote */

function QuoteEntry({ draft, setDraft }: { draft: Draft; setDraft: SetDraft }) {
  // Who and when live inside the one free-text `note` field the store already
  // has, so re-derived from it on every render rather than kept as separate
  // draft state that could drift out of sync with what gets saved.
  const parsed = /^(.*) · reported (\d{4}-\d{2}-\d{2})$/.exec(draft.note ?? '');
  const who = parsed ? parsed[1] : draft.note ?? '';
  const date = parsed ? parsed[2] : '';

  const setPct = (v: number) => setDraft((d) => ({ ...d, pct: clampPct(round2(v)) }));
  const setWho = (value: string) =>
    setDraft((d) => ({ ...d, note: date ? `${value} · reported ${date}` : value }));
  // Deliberately not defaulted to today: a vendor report read a week late is
  // still that week's report, and a default here would quietly backdate
  // nothing and post-date everything.
  const setDate = (value: string) =>
    setDraft((d) => ({ ...d, note: value ? `${who} · reported ${value}` : who }));

  return (
    <>
      <p className="text-[13px] text-muted-foreground">What did the latest report say?</p>
      <input
        type="number"
        inputMode="decimal"
        value={String(draft.pct)}
        onChange={(e) => setPct(Number(e.target.value))}
        className="mt-2 h-12 w-full rounded-xl border border-input bg-card px-3 text-center text-xl font-semibold tabular-nums text-foreground shadow-sm transition-colors duration-200 ease-ios focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
      />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="block text-[13px] text-muted-foreground">
          Report date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
          />
        </label>
        <label className="block text-[13px] text-muted-foreground">
          Reported by
          <input
            type="text"
            placeholder="Who reported it"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
          />
        </label>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- manual */

function PercentEntry({
  draft,
  setDraft,
}: {
  draft: Draft;
  setDraft: SetDraft;
}) {
  const set = (v: number) => setDraft((d) => ({ ...d, pct: clampPct(round2(v)) }));
  return (
    <>
      <p className="text-[13px] text-muted-foreground">Percent complete, cumulative</p>
      <div className="mt-2 flex items-center gap-2">
        <StepBtn label="Less" onClick={() => set(draft.pct - 1)}>−</StepBtn>
        <input
          type="number"
          inputMode="decimal"
          value={String(draft.pct)}
          onChange={(e) => set(Number(e.target.value))}
          className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-center text-xl font-semibold tabular-nums text-foreground shadow-sm transition-colors duration-200 ease-ios focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
        />
        <StepBtn label="More" onClick={() => set(draft.pct + 1)}>+</StepBtn>
      </div>
      {/* The slider is not decoration. A typed percent is a judgement, and a
          judgement is made by feel before it is made by digits — dragging to
          "about three quarters" is the motion the number comes from. */}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={draft.pct}
        onChange={(e) => set(Number(e.target.value))}
        aria-label="Percent complete"
        className="mt-3 h-11 w-full accent-chart-1"
      />
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
