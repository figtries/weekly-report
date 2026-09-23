'use client';

import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';

import {
  markNoProgressAction,
  saveFieldProgressAction,
  saveWeekUpdatesAction,
  setWorkKindAction,
} from '@/lib/actions';
import { updateRowTextAction } from '@/lib/sheet-actions';
import type { MapNode } from '@/lib/overall-map';
import type { Milestone } from '@/lib/types';
import { BUILT_IN_KINDS, type Shape } from '@/lib/work-kind';
import { changeFor } from '@/lib/work-kind-apply';
import { MOTION } from '@/lib/design';
import { Expand } from '@/components/motion/Expand';
import { pressMotion } from '@/components/motion/Press';
import CodeChip, { splitCode } from '@/components/ui/CodeChip';
import MoneyInput from '@/components/ui/MoneyInput';
import { cn } from '@/lib/utils';
import ProgressEntry, { deriveShape, type EntryShape } from './ProgressEntry';
import WorkKindPicker, { type WorkKindPeer } from './WorkKindPicker';

/**
 * Everything about ONE activity, in one place, over the map that was not
 * disturbed to get here.
 *
 * This panel is the third answer to the question two earlier cuts of Data
 * Overall got wrong. Both of them spread one row's facts over three screens —
 * the percentage on Fill in, the price and the measurement method on
 * Weights, the dates in the planner — so using the app meant remembering
 * which screen held which field. Here the row is the subject and the screens
 * are gone: the figure at the top, and under it the three things that decide
 * what that figure MEANS.
 *
 * WHY A PANEL AND NOT AN INLINE FIELD. Typing into the row itself is fewer taps
 * on a desktop and worse everywhere else: at 390px the field is a sliver, the
 * keyboard covers the map, and the name — the thing you identify the row by —
 * is the first casualty of the space. A sheet that rises over the map keeps the
 * map's scroll position, gives the name a full line, and puts the input at
 * thumb height.
 *
 * ONE INSTANCE PER SCREEN, never one per row: `WbsTreeTable` can render 285
 * leaves at once and a panel inside that loop would mount 285 portals. The map
 * holds the active id and this renders once.
 */

/**
 * A name for the form on screen, used ONLY when a row got its method from
 * somewhere other than the question — the importer, the planner, a paste.
 *
 * A row that was asked carries its kind, and the kind is what the way back is
 * labelled with, because that is the word the person replied with. This panel
 * used to carry a second vocabulary as well, a "How it is counted" disclosure
 * offering Quantity / Steps / Typed percent beside a picker offering One-off /
 * Stages / Quoted. It is gone: the question itself reopens now.
 */
const SHAPE_LABEL: Record<EntryShape, string> = {
  gate: 'One-off',
  steps: 'Stages',
  qty: 'Quantity',
  manual: 'Typed percent',
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const fmt1 = (v: number) => v.toFixed(1);
const fmt2 = (v: number) => v.toFixed(2);

function fmtDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtMoney(v: number | null | undefined) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return `Rp ${Math.round(v).toLocaleString('en-GB')}`;
}

/** What the panel is currently holding, before it is saved. */
export interface Draft {
  qtyDone: number;
  milestonesDone: string[];
  pct: number;
  /** Free text beside the figure — a date, a vendor name, whatever the shape asks for. */
  note: string;
}

function draftOf(node: MapNode): Draft {
  return {
    qtyDone: node.qtyDone ?? 0,
    milestonesDone: (node.milestones ?? []).filter((m) => m.done).map((m) => m.id),
    pct: node.actualPct,
    note: node.note ?? '',
  };
}

/** The percent a draft comes to, read from whatever the item is measured by. */
function pctOfDraft(node: MapNode, draft: Draft): number {
  if (node.method === 'qty') {
    const total = node.qtyTotal && node.qtyTotal > 0 ? node.qtyTotal : 1;
    return clampPct(round2((draft.qtyDone / total) * 100));
  }
  if (node.method === 'milestone') {
    const ms = node.milestones ?? [];
    const total = ms.reduce((s, m) => s + m.weight, 0);
    if (!total) return 0;
    const done = ms.filter((m) => draft.milestonesDone.includes(m.id)).reduce((s, m) => s + m.weight, 0);
    return clampPct(round2((done / total) * 100));
  }
  return clampPct(round2(draft.pct));
}

export default function ActivityPanel({
  node,
  trail,
  week,
  projectId,
  canPrice,
  projectHref,
  peers,
  onClose,
  onSaved,
}: {
  node: MapNode | null;
  trail: MapNode[];
  week: number;
  /**
   * The project this page was rendered for, passed to every write below. See
   * `OverallMap`'s own note: asking again at save time is what made a save
   * land in another project's store and answer "Item not found".
   */
  projectId: string | null;
  canPrice: boolean;
  projectHref: string | null;
  /** Every leaf elsewhere in the tree that already has an answer, for the work-kind picker. */
  peers: WorkKindPeer[];
  onClose: () => void;
  onSaved: (id: string, pct: number) => void;
}) {
  return (
    <AnimatePresence>{node && (
      <PanelBody
        key={node.id}
        node={node}
        trail={trail}
        week={week}
        projectId={projectId}
        canPrice={canPrice}
        projectHref={projectHref}
        peers={peers}
        onClose={onClose}
        onSaved={onSaved}
      />
    )}</AnimatePresence>
  );
}

function PanelBody({
  node,
  trail,
  week,
  projectId,
  canPrice,
  projectHref,
  peers,
  onClose,
  onSaved,
}: {
  node: MapNode;
  trail: MapNode[];
  week: number;
  projectId: string | null;
  canPrice: boolean;
  projectHref: string | null;
  peers: WorkKindPeer[];
  onClose: () => void;
  onSaved: (id: string, pct: number) => void;
}) {
  /**
   * Set on the TAP, before the write goes out, so the form for the kind just
   * chosen is on screen immediately. `node` itself will not carry the new
   * `workKind` until the route refreshes behind it — that is a round trip
   * away, not zero — so until it lands this override stands in for the fields
   * a freshly-answered leaf would have. `pickKind` drops it again if the write
   * comes back a failure.
   */
  const [kindOverride, setKindOverride] = useState<{
    kindId: string;
    shape: Shape;
    milestones: Milestone[];
    /** Rungs the restatement awards, so the optimistic figure is the server's. */
    done: string[];
  } | null>(null);

  /**
   * Whether the picker is on screen because somebody ASKED for it, as opposed
   * to because the row has never been answered.
   *
   * This is the whole fix for a one-way door. `asking` used to be read off the
   * data alone, so the first Save closed the question for good: a row measured
   * the wrong way could only be corrected through a disclosure that spoke a
   * different language, and a row answered by accident could not be corrected
   * at all. Now the question is a place the panel can go back to, and Cancel
   * returns from it having changed nothing.
   */
  const [picking, setPicking] = useState(false);
  const answered = Boolean(node.workKind) || Boolean(kindOverride);
  const asking = !answered || picking;
  const effectiveNode: MapNode = kindOverride
    ? {
        ...node,
        workKind: kindOverride.kindId,
        method:
          kindOverride.shape === 'qty'
            ? 'qty'
            : kindOverride.shape === 'manual'
              ? 'lumpsum'
              : 'milestone',
        milestones: kindOverride.milestones.map((m) => ({
          ...m,
          done: kindOverride.done.includes(m.id),
        })),
        source: kindOverride.shape,
      }
    : node;

  /**
   * The answer is applied on the TAP, and the write follows it.
   *
   * Nothing on this path needs the server's opinion: the rungs come from
   * `ladderFor`, which is the same pure function the action itself calls, so
   * waiting for the round trip bought a spinner and nothing else. The form is
   * on screen before the request leaves. If the write does fail, the override
   * is dropped and the question comes back with the reason on it, which is the
   * only part of this that has to be true rather than fast.
   */
  function pickKind(kindId: string, kindShape: Shape, milestones: Milestone[]) {
    const previous = kindOverride;
    // CHANGING HOW YOU MEASURE MUST NOT CHANGE WHAT WAS MEASURED, and the
    // optimistic view has to keep that promise too. The server restates the
    // figure into the new ladder's own terms through `changeFor`; showing an
    // untouched ladder here instead read a row sitting at 100% as 0.0%, which
    // is not only wrong on screen — the draft would have counted as dirty and
    // Save would have written the zero over it.
    const { done } = changeFor(
      { id: node.id, name: node.name, bobot: node.weight, pct: node.actualPct },
      milestones
    );
    setKindOverride({ kindId, shape: kindShape, milestones, done });
    setPicking(false);
    setError(null);
    // Deliberately not inside the panel's own transition: that one drives the
    // Save button, and a question that has already been answered should not
    // leave the button reading "Saving…" over a form nobody has typed in yet.
    void setWorkKindAction(
      node.id,
      node.name,
      kindId,
      kindShape,
      { steps: milestones },
      projectId
    ).then(
      (res) => {
        if (res.ok) return;
        setKindOverride(previous);
        setPicking(true);
        setError(res.error ?? 'Could not save');
      }
    );
  }

  /**
   * The draft is RE-SEEDED when the row stops being measured the same way.
   *
   * Changing the method happens inside this panel, and the server answers by
   * re-expressing the progress in the new method's terms —
   * `applyProgressMethod` seeds a quantity from the percent the row already
   * had. A draft still holding `qtyDone: 0` from before the switch would then
   * read 0% on a row sitting at 40, count as dirty, and Save would write the
   * zero. Keyed state rather than an effect, and rather than remounting: a
   * remount would slide the sheet out and back for what is not a new row.
   *
   * A work-kind pick reseeds it the same way, for the same reason: `seed`
   * reads off `effectiveNode`, which changes the moment `kindOverride` lands.
   */
  const seed = `${effectiveNode.method}:${effectiveNode.qtyTotal}:${(effectiveNode.milestones ?? []).length}`;
  const [held, setHeld] = useState<{ seed: string; draft: Draft }>(() => ({ seed, draft: draftOf(effectiveNode) }));
  const draft = held.seed === seed ? held.draft : draftOf(effectiveNode);
  const setDraft = (fn: (d: Draft) => Draft) => setHeld({ seed, draft: fn(draft) });

  // The escape hatch: a one-off swap to the manual form, not a decision about
  // what the row is. Reset whenever the row starts measuring itself
  // differently, same keyed pattern as the draft above rather than an effect.
  //
  // A row whose standing figure WAS typed opens with the hatch already on,
  // because that is how the server reads it: `resolveLeafProgress` lets a
  // `source: 'manual'` figure win over the rungs. Opening it off showed the
  // rungs' 0.0% over a row the map called 80%, counted that as a change, and
  // Save wrote the zero over the 80 (PHSS Samberah, 23 Sep 2026).
  const standsTyped = node.source === 'manual';
  const [heldManual, setHeldManual] = useState<{ seed: string; manual: boolean }>(() => ({ seed, manual: standsTyped }));
  const manual = heldManual.seed === seed ? heldManual.manual : standsTyped;
  const setManual = (v: boolean) => setHeldManual({ seed, manual: v });
  const shape: EntryShape = deriveShape(effectiveNode);
  const source: EntryShape = manual ? 'manual' : shape;
  // Named by the ANSWER somebody gave, not by the form that answer produced:
  // the question was "what kind of work is this", so the way back to it has to
  // carry the word they replied with. The shape is the fallback for a row the
  // importer or the planner set a method on without anyone being asked.
  const kindLabel =
    BUILT_IN_KINDS.find((k) => k.id === effectiveNode.workKind)?.label ?? SHAPE_LABEL[shape];

  const [open, setOpen] = useState<'money' | 'schedule' | null>(null);
  // The raw string in the percent box while it has focus. See the input.
  const [typing, setTyping] = useState<string | null>(null);

  /**
   * One point up or down. Pressing these IS typing by hand, so they take the
   * override the same way the box does, and they start from whatever is on
   * screen now — the ladder's figure on a row nobody has touched, the typed
   * one after that.
   */
  function stepPct(delta: number) {
    const from = manual ? draft.pct : pct;
    const next = clampPct(round2(from + delta));
    setTyping(null);
    setManual(true);
    setDraft((d) => ({ ...d, pct: next }));
  }
  const [saving, startSaving] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * Read once, at mount, which is safe precisely because this component never
   * exists on the server: the map mounts it on a press. A media query read
   * during a server render would be a hydration mismatch.
   */
  const [wide] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(min-width: 640px)').matches
  );

  // The escape hatch reads from `draft.pct` regardless of how the row is
  // normally measured — that is the whole point of typing a percent instead.
  const pct = manual ? clampPct(round2(draft.pct)) : pctOfDraft(effectiveNode, draft);
  // The note counts as a change too. It did not have to before, because the
  // only form that carried one also carried its own percent box; now a ladder
  // row can be answered "nothing moved, but here is who told me so", and a
  // Save button greyed out over a filled-in field reads as the app refusing.
  const dirty =
    Math.abs(pct - node.actualPct) > 0.004 || (draft.note ?? '') !== (node.note ?? '');

  // What the percent field is showing right now: the raw string while it has
  // focus, the typed figure after that, the evidence's own figure otherwise.
  const shownPct = typing ?? (manual ? String(draft.pct) : fmt1(pct));

  // Escape closes, the scroll behind is frozen, and focus starts inside the
  // panel — the three things a hand-rolled overlay always forgets.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the PANEL, not the close button. Focusing a control draws its ring
    // the moment the sheet opens, which reads as the app pointing at the way
    // out before anyone has looked at what is inside.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  function finish(nextPct: number) {
    onSaved(node.id, nextPct);
    setSaved(true);
    // Short enough that the tick is a confirmation rather than a wait. It used
    // to be 420ms, which is most of a beat added to the end of every single
    // row on a screen people fill in nine at a time.
    window.setTimeout(onClose, 140);
  }

  function save() {
    if (!dirty || saving) return;
    setError(null);
    startSaving(async () => {
      if (!manual && effectiveNode.method === 'qty') {
        // The count still decides the percentage. What changed is that a count
        // can now carry the same source note as everything else, because who
        // walked the line and when is a fact about a count too.
        const res = await saveFieldProgressAction(week, [
          { leafId: node.id, qtyDone: draft.qtyDone, note: draft.note || undefined, source },
        ], projectId);
        if (!res.ok) return setError(res.error ?? 'Could not save');
      } else if (!manual && effectiveNode.method === 'milestone') {
        const res = await saveFieldProgressAction(week, [
          { leafId: node.id, milestonesDone: draft.milestonesDone, note: draft.note || undefined, source },
        ], projectId);
        if (!res.ok) return setError(res.error ?? 'Could not save');
      } else {
        // Lumpsum rows (quote or plain manual), and the escape hatch on any
        // other row. `resolveLeafProgress` still recomputes a 'qty' or
        // 'milestone' row from its own evidence and ignores this stored
        // figure, so a one-off override only fully takes effect on a row
        // that is already lumpsum-measured — it is still recorded honestly
        // either way, which is what lets a report later say how much of
        // itself was judged.
        const res = await saveWeekUpdatesAction(week, {
          [node.id]: { cumProgressPct: pct, note: draft.note || undefined, source },
        }, projectId);
        if (!res.ok) return setError(res.error ?? 'Could not save');
      }
      finish(pct);
    });
  }

  function nothing() {
    if (saving) return;
    setError(null);
    startSaving(async () => {
      const res = await markNoProgressAction(week, [node.id], projectId);
      if (!res.ok) return setError(res.error ?? 'Could not save');
      finish(node.actualPct);
    });
  }

  const { tag, name } = splitCode(node.name);
  const crumb = trail.map((t) => splitCode(t.name).name).join(' › ');

  const body = (
    <div className="fixed inset-0 z-50 flex sm:justify-end">
      <m.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
        onClick={onClose}
      />

      {/* The spring, not the curve: this panel MOVES from somewhere to
          somewhere. `y`/`x` are transforms, so it runs on the compositor and a
          phone stays at sixty frames while the map sits behind it. */}
      <m.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={name}
        tabIndex={-1}
        initial={wide ? { x: '100%' } : { y: '100%' }}
        animate={wide ? { x: 0 } : { y: 0 }}
        exit={wide ? { x: '100%' } : { y: '100%' }}
        transition={MOTION.spring}
        drag={wide ? false : 'y'}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.4 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 600) onClose();
        }}
        className={cn(
          'relative flex w-full flex-col bg-card shadow-2xl outline-none',
          'mt-auto max-h-[88vh] rounded-t-3xl',
          'sm:mt-0 sm:h-full sm:max-h-none sm:w-[27rem] sm:rounded-none sm:rounded-l-3xl'
        )}
      >
        {/* The grab handle is the affordance for the drag above it — without
            one, a sheet that can be flicked away never tells anyone it can. */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-border" />
        </div>

        <div className="flex items-start gap-3 px-5 pb-3 pt-3 sm:pt-5">
          <div className="min-w-0 flex-1">
            {crumb && <p className="truncate text-[11px] text-muted-foreground">{crumb}</p>}
            <div className="mt-1 flex items-start gap-2">
              {tag && <CodeChip className="mt-0.5">{tag}</CodeChip>}
              <h2 className="text-[15px] font-semibold leading-snug text-foreground">{name}</h2>
            </div>
            <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
              Week {week}
              {node.startWeek && node.finishWeek
                ? ` · W${node.startWeek}–W${node.finishWeek}`
                : ''}
              {' · '}
              Weight {fmt2(node.weight)}%
            </p>
          </div>
          <m.button
            {...pressMotion}
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </m.button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          <div className="rounded-2xl bg-muted/40 p-4">
            {asking ? (
              <WorkKindPicker
                node={node}
                peers={peers}
                current={answered ? effectiveNode.workKind ?? null : null}
                onPick={pickKind}
                onCancel={answered ? () => setPicking(false) : undefined}
              />
            ) : (
              <>
                {/* The way back in, named with the same word the answer was
                    given in. It sits above the form because it is what the
                    form IS, not an action to take on it.

                    A BUTTON THAT SAYS SO. It was the answer and a chevron in
                    plain text, which read as a heading: nobody pressed it to
                    change the kind of work, because nothing on it said it
                    could (23 Sep 2026). Now it is a bordered row, the same
                    surface as the picker's own Cancel, naming what it holds
                    and carrying the word "Change". */}
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  className="-mt-1 mb-4 flex min-h-12 w-full items-center gap-3 rounded-xl border border-input bg-card px-3.5 py-2 text-left transition-colors duration-200 ease-ios hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11px] text-muted-foreground">Kind of work</span>
                    <span className="block text-[14px] font-medium text-foreground">{kindLabel}</span>
                  </span>
                  {/* The exchange arrows, not a chevron: a › reads as "next",
                      and this goes BACK to the question to swap the answer. */}
                  <span className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-primary">
                    <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                    Change
                  </span>
                </button>
                <ProgressEntry
                  node={effectiveNode}
                  draft={draft}
                  setDraft={setDraft}
                  shape={shape}
                  /* Clearing the raw string matters as much as clearing the flag:
                     the box may still be holding "42.5" from a moment ago, and
                     a display that outranks the evidence would keep showing it
                     over the rung that was just ticked. */
                  onManualOff={() => {
                    setManual(false);
                    setTyping(null);
                  }}
                />
              </>
            )}

            {/* THE FIGURE IS THE INPUT. It was a read-only number with a pair
                of buttons above it for swapping to a percent box and back;
                three controls saying one thing. Typing here is the override:
                the typed figure wins until somebody touches a rung or the
                count, and then the evidence takes over again. Nothing is
                asked, and nothing has to be pressed first. */}
            <div className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3">
              <BareStep label="Less" onClick={() => stepPct(-1)}>
                −
              </BareStep>
              {/* NO BOX. The panel's own card is already a rounded surface, so
                  a bordered field inside it is a box in a box, and it made the
                  figure look like a widget dropped on the card rather than the
                  card's own headline. What says "you can change this" instead
                  is the size and the rule under it: 40px, the largest thing on
                  the screen, over a line that lights up when the caret lands. */}
              <div className="group min-w-0 flex-1">
                <div className="flex items-baseline justify-center gap-1">
              <input
                /* TEXT, NEVER `type="number"`. A number input renders its value
                   through the BROWSER's locale, so "100.0" came back on screen
                   as "100,0" — a decimal comma, in an app whose every other
                   figure is written with a point, and a string `Number()`
                   reads as NaN. A text box shows the string it was given. */
                type="text"
                inputMode="decimal"
                aria-label="Percent complete"
                /* `typing` is what makes a decimal typeable at all: parsing
                   every keystroke back into the value turns "4." into "4" and
                   eats the dot before the digit after it can be pressed. The
                   raw string stands while the box has focus, the parsed figure
                   is what the draft carries, and blur hands the display back to
                   whatever the evidence says. */
                value={shownPct}
                /* Sized to its own digits rather than to a fixed width, so
                   "7.5 %" sits in the middle of the card exactly as "100.0 %"
                   does. A right-aligned box of constant width would put a
                   short figure visibly off centre. `ch` is the width of a
                   DIGIT under tabular-nums; a dot is about half that, so a
                   plain character count over-measures and opens a gap before
                   the per-cent sign. */
                style={{
                  width: `${Math.max(shownPct.length - (shownPct.split('.').length - 1) * 0.55, 1)}ch`,
                }}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => setTyping(null)}
                onChange={(e) => {
                  // A comma is what an Indonesian phone keyboard puts under the
                  // decimal key, and it means the same thing here: a percent is
                  // 0 to 100, so there is no thousands separator for it to be
                  // confused with. Everything else that is not a digit or a dot
                  // is dropped rather than rejected.
                  const cleaned = e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
                  // One dot only. A second one makes `Number()` return NaN, and
                  // the box would then sit showing "7.42.55" while the draft
                  // quietly kept the last figure that did parse.
                  const parts = cleaned.split('.');
                  const raw =
                    parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
                  setTyping(raw);
                  setManual(true);
                  const n = Number(raw);
                  if (raw !== '' && Number.isFinite(n)) {
                    setDraft((d) => ({ ...d, pct: clampPct(round2(n)) }));
                  }
                }}
                className="appearance-none border-0 bg-transparent p-0 text-center text-[40px] font-semibold leading-tight tabular-nums tracking-tight text-chart-1 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="text-[40px] font-semibold leading-tight tabular-nums tracking-tight text-chart-1">
                    %
                  </span>
                </div>
                <div className="mt-1.5 h-[2px] w-full rounded-full bg-border transition-colors duration-200 ease-ios group-focus-within:bg-chart-1" />
              </div>
              <BareStep label="More" onClick={() => stepPct(1)}>
                +
              </BareStep>
            </div>
          </div>

          <div className="mt-4 border-t border-border">
            <Disclosure
              label="Price and weight"
              value={fmtMoney(node.price) ?? `${fmt2(node.weight)}%`}
              open={open === 'money'}
              onToggle={() => setOpen(open === 'money' ? null : 'money')}
            >
              <MoneySection node={node} canEdit={canPrice} />
            </Disclosure>

            <Disclosure
              label="Schedule"
              value={
                node.startWeek && node.finishWeek
                  ? `W${node.startWeek}–W${node.finishWeek}`
                  : 'Not scheduled'
              }
              open={open === 'schedule'}
              onToggle={() => setOpen(open === 'schedule' ? null : 'schedule')}
            >
              <ScheduleSection node={node} projectHref={projectHref} />
            </Disclosure>
          </div>

          {error && (
            <p className="mt-3 animate-fade-in-up rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <m.button
            {...pressMotion}
            onClick={nothing}
            disabled={saving}
            className="min-h-12 flex-1 rounded-xl border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60 disabled:opacity-50"
          >
            Nothing this week
          </m.button>
          <m.button
            {...pressMotion}
            onClick={save}
            disabled={!dirty || saving}
            className="btn-primary min-h-12 flex-1 rounded-xl px-3 text-sm font-medium disabled:opacity-40"
          >
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </m.button>
        </div>
      </m.div>
    </div>
  );

  return createPortal(body, document.body);
}

/**
 * A step button with no box on it, because the figure beside it has no box
 * either. Bordered ones would put two more rectangles on a card that is
 * already a rectangle, which is exactly what the field lost its border for.
 * Still 44px, which is the part that is not taste.
 */
function BareStep({
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
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted hover:text-foreground"
    >
      {children}
    </m.button>
  );
}

/* ------------------------------------------------------------- disclosures */

function Disclosure({
  label,
  value,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border">
      <m.button
        {...pressMotion}
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-3 py-1 text-left"
      >
        <span className="flex-1 text-sm text-foreground">{label}</span>
        <span className="text-[13px] tabular-nums text-muted-foreground">{value}</span>
        <m.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: MOTION.duration, ease: [...MOTION.ease] }}
          className="text-muted-foreground"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M7.5 4.5l6 5.5-6 5.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </m.span>
      </m.button>
      <Expand open={open}>
        <div className="pb-4 pt-1">{children}</div>
      </Expand>
    </div>
  );
}

function MoneySection({ node, canEdit }: { node: MapNode; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [value, setValue] = useState(node.price === null || node.price === undefined ? '' : String(node.price));
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = useMemo(
    () => Number(value || 0) !== Number(node.price ?? 0),
    [value, node.price]
  );

  if (!canEdit) {
    return (
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        This row carries {fmt2(node.weight)}% of the project. Weights on the imported project come
        from the file it was imported from.
      </p>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-muted-foreground">
        Its price, from the BOQ. Weight is worked out from it — never typed.
      </p>
      <MoneyInput
        defaultValue={value}
        placeholder="0"
        disabled={pending}
        onValueChange={(v) => {
          setValue(v);
          setDone(false);
        }}
        className="mt-2 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
      />
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        Currently {fmt2(node.weight)}% of the project.
      </p>
      <m.button
        {...pressMotion}
        onClick={() => {
          setError(null);
          start(async () => {
            const res = await updateRowTextAction(node.id, 'price', value);
            if (!res.ok) setError(res.error);
            else setDone(true);
          });
        }}
        disabled={pending || !changed}
        className="btn-primary mt-2 min-h-11 w-full rounded-lg text-sm font-medium disabled:opacity-40"
      >
        {done ? 'Saved' : pending ? 'Saving…' : 'Save price'}
      </m.button>
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
    </div>
  );
}

function ScheduleSection({ node, projectHref }: { node: MapNode; projectHref: string | null }) {
  const start = fmtDate(node.startDate);
  const finish = fmtDate(node.finishDate);
  return (
    <div className="text-[13px] text-muted-foreground">
      <div className="flex justify-between py-1">
        <span>Starts</span>
        <span className="text-foreground">{start ?? (node.startWeek ? `Week ${node.startWeek}` : '—')}</span>
      </div>
      <div className="flex justify-between py-1">
        <span>Finishes</span>
        <span className="text-foreground">{finish ?? (node.finishWeek ? `Week ${node.finishWeek}` : '—')}</span>
      </div>
      <p className="mt-2 leading-relaxed">
        Dates come from the plan, and moving one moves the curve — so they are changed in the
        planner, where the whole schedule is in view.
      </p>
      {projectHref && (
        <Link
          href={projectHref}
          className="mt-2 inline-flex min-h-11 items-center text-[13px] font-medium text-chart-1 hover:underline"
        >
          Open the planner
        </Link>
      )}
    </div>
  );
}
