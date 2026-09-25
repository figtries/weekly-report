'use client';

import { m } from 'framer-motion';
import { useEffect, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeftRight, ChevronRight, Clock, TriangleAlert } from 'lucide-react';

import {
  markNoProgressAction,
  saveFieldProgressAction,
  saveWeekUpdatesAction,
  setWorkKindAction,
} from '@/lib/actions';
import type { MapNode } from '@/lib/overall-map';
import type { Milestone } from '@/lib/types';
import { BUILT_IN_KINDS, type Shape } from '@/lib/work-kind';
import { changeFor } from '@/lib/work-kind-apply';
import { pressMotion } from '@/components/motion/Press';
import CodeChip, { splitCode } from '@/components/ui/CodeChip';
import { cn } from '@/lib/utils';
import ProgressEntry, { deriveShape, type EntryShape } from './ProgressEntry';
import WeekLog, { forgetLeafLog } from './WeekLog';
import WorkKindPicker, { type WorkKindPeer } from './WorkKindPicker';
import { formatMoney } from '@/lib/currency';

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

/** "29 Dec 25": the long form does not fit two to a half-width tile. */
function fmtShortDate(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtMoney(v: number | null | undefined, currency: string) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return formatMoney(v, currency);
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
  currency,
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
  /** The project's own currency, so a budget reads SGD on an SGD project and not Rp. */
  currency: string;
  /** Every leaf elsewhere in the tree that already has an answer, for the work-kind picker. */
  peers: WorkKindPeer[];
  onClose: () => void;
  onSaved: (id: string, pct: number) => void;
}) {
  // No AnimatePresence: the slide-up spring over a blurred map stuttered on
  // every device it was tried on, iPhone, Android and desktop alike (25 Sep
  // 2026). Both ways are CSS keyframes instead, `.animate-sheet-in` and
  // `.animate-sheet-out`; PanelBody plays the second before calling `onClose`.
  return (
    node && (
      <PanelBody
        key={node.id}
        node={node}
        trail={trail}
        week={week}
        projectId={projectId}
        canPrice={canPrice}
        projectHref={projectHref}
        currency={currency}
        peers={peers}
        onClose={onClose}
        onSaved={onSaved}
      />
    )
  );
}

/** Tell the parent the sheet is gone — once, whichever signal arrives first. */
function handOver(closed: { current: boolean }, onClose: { current: () => void }) {
  if (closed.current) return;
  closed.current = true;
  onClose.current();
}

function PanelBody({
  node,
  trail,
  week,
  projectId,
  canPrice,
  projectHref,
  currency,
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
  currency: string;
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
   *
   * And so does a change to the figure itself from UNDER the panel: a save in
   * the week log below can move this week too (a correction to an earlier week
   * carries the weeks after it). A draft still holding the old figure would
   * then count as dirty, and Save would write it back over the new one.
   */
  const seed = [
    effectiveNode.method,
    effectiveNode.qtyTotal,
    (effectiveNode.milestones ?? []).length,
    node.actualPct,
    node.qtyDone ?? '',
    (node.milestones ?? []).filter((m) => m.done).length,
  ].join(':');
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
  const pctRef = useRef<HTMLInputElement>(null);

  /*
   * EVERY WAY OUT GOES THROUGH `close()`, which plays the exit slide and only
   * then hands over to `onClose` — the parent unmounts this the moment that is
   * called, so calling it directly is a cut, which is what closing used to be
   * (25 Sep 2026). `closedRef` makes the handover happen once whichever of the
   * two lands first: the wrapper's own `animationend`, or the timer, which
   * covers a tab hidden mid-slide where no animation event ever arrives.
   */
  const [closing, setClosing] = useState(false);
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const close = () => setClosing(true);
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => handOver(closedRef, onCloseRef), 650);
    return () => window.clearTimeout(t);
  }, [closing]);

  /**
   * The week log's own row for the week on screen hands over to the figure
   * here rather than opening a second editor for the same week.
   */
  function focusHeadline() {
    const input = pctRef.current;
    if (!input) return;
    input.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.focus({ preventScroll: true });
  }

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
      if (e.key === 'Escape') setClosing(true);
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the PANEL, not the close button. Focusing a control draws its ring
    // the moment the sheet opens, which reads as the app pointing at the way
    // out before anyone has looked at what is inside.
    // preventScroll: the sheet is still below the fold on this frame, mid-slide.
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  function finish(nextPct: number) {
    // The week just saved is one of the log's weeks; the log cached for this
    // activity no longer says what the database says.
    forgetLeafLog(projectId, node.id);
    onSaved(node.id, nextPct);
    setSaved(true);
    // Short enough that the tick is a confirmation rather than a wait. It used
    // to be 420ms, which is most of a beat added to the end of every single
    // row on a screen people fill in nine at a time.
    window.setTimeout(close, 140);
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

  /**
   * The one button at the foot. A changed figure is saved; an unchanged one
   * is recorded as "checked, nothing moved", which is what takes the row out
   * of this week's queue. There used to be a separate "Nothing this week"
   * button beside Save for that, and three ways out of one panel (that, Save
   * and the X) read as three different questions. The X still records
   * nothing, and a row already dealt with this week just closes rather than
   * writing a second identical entry into its log.
   */
  function saveOrConfirm() {
    if (dirty) return save();
    if (node.filledCount > 0) return close();
    nothing();
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
    // Closing, the sheet stops taking presses: it is on its way out, and a tap
    // that lands on it mid-slide should reach the page it is uncovering.
    <div className={cn('fixed inset-0 z-50 flex sm:justify-end', closing && 'pointer-events-none')}>
      {/* No blur: a full-screen backdrop-filter is the most expensive thing a
          phone can be asked to paint, and it was paid on the opening frame. */}
      <div
        className={cn('absolute inset-0 bg-black/40', closing ? 'animate-scrim-out' : 'animate-scrim-in')}
        onClick={close}
      />

      {/* The slides, in and out, live on this wrapper and the drag on the
          `m.div` inside it, so the two never write the same transform. The
          target check matters: animations inside the sheet bubble their own
          `animationend` up through here. */}
      <div
        className={cn(
          'relative mt-auto flex w-full flex-col sm:mt-0 sm:h-full sm:w-[27rem]',
          closing ? 'animate-sheet-out' : 'animate-sheet-in'
        )}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) handOver(closedRef, onCloseRef);
        }}
      >
        <m.div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label={name}
          tabIndex={-1}
          drag={wide ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.4 }}
          onDragEnd={(_, info) => {
            if (info.offset.y > 120 || info.velocity.y > 600) close();
          }}
          className={cn(
            'relative flex w-full flex-col bg-card shadow-2xl outline-none',
            'max-h-[88vh] rounded-t-3xl',
            'sm:h-full sm:max-h-none sm:rounded-none sm:rounded-l-3xl'
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
              {/* The week only: the span and the weight each have a card of their
                  own at the foot of the panel, and a figure said twice is a
                  figure somebody has to check twice. */}
              <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">Week {week}</p>
            </div>
            <m.button
              {...pressMotion}
              onClick={close}
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
                      and carrying the word "Change".
  
                      ONLY "CHANGE" IS THE BUTTON. The row used to be the button
                      and light up as a whole, first grey (the same hover as every
                      rung under it) and then a blue border, and both read as
                      "all of this is lit" rather than "this is the action". Now
                      the row is a plain label and the pill is the one thing that
                      answers the pointer: faintly tinted at rest so a phone,
                      which has no hover, still sees a button, and SOLID blue under
                      the pointer (a deeper tint was measured and read as the same
                      pill). 44px tall, so a thumb still finds it. */}
                  <div className="-mt-1 mb-4 flex min-h-12 w-full items-center gap-3 rounded-xl border border-input bg-card py-1.5 pl-3.5 pr-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] text-muted-foreground">Kind of work</span>
                      <span className="block text-[14px] font-medium text-foreground">{kindLabel}</span>
                    </span>
                    {/* The exchange arrows, not a chevron: a › reads as "next",
                        and this goes BACK to the question to swap the answer. */}
                    <m.button
                      {...pressMotion}
                      type="button"
                      onClick={() => setPicking(true)}
                      className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-primary/6 px-3.5 text-[13px] font-medium text-primary transition-colors duration-200 ease-ios hover:bg-primary hover:text-primary-foreground active:bg-primary/85 active:text-primary-foreground"
                    >
                      <ArrowLeftRight className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
                      Change
                    </m.button>
                  </div>
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
                  ref={pctRef}
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
  
            <FinishNotice node={node} />
  
            {/* Keyed on what the SERVER says the row is measured by, not on the
                optimistic override: the log is re-read when a new way of counting
                has actually been written, not while the write is still in flight. */}
            <WeekLog
              key={`${node.id}:${node.workKind ?? ''}:${node.method ?? ''}`}
              node={effectiveNode}
              week={week}
              projectId={projectId}
              onFocusHeadline={focusHeadline}
              onOpenWeekChanged={(p) => onSaved(node.id, p)}
            />
  
            <FactTiles
              node={node}
              weightsHref={canPrice ? `/weekly/${week}/weights` : null}
              projectHref={projectHref}
              currency={currency}
            />
  
            {error && (
              <p className="mt-3 animate-fade-in-up rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
                {error}
              </p>
            )}
          </div>
  
          <div className="flex gap-2 border-t border-border bg-card px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
            <m.button
              {...pressMotion}
              onClick={saveOrConfirm}
              disabled={saving}
              className="btn-primary min-h-12 flex-1 rounded-xl px-3 text-sm font-medium disabled:opacity-40"
            >
              {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
            </m.button>
          </div>
        </m.div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}

/**
 * The reminder, in the panel: late, or ending within the next few weeks.
 *
 * Both facts come from `lib/worklist.ts` through the map (`lateBy`, `dueIn`),
 * measured against the week on screen, so this box, the chip on the row and
 * the count above the map can never disagree. Late is warn-coloured because it
 * has already happened; ending soon is the blue the app uses for "due", because
 * it is still a thing somebody can act on.
 */
function FinishNotice({ node }: { node: MapNode }) {
  const toGo = fmt1(Math.max(0, 100 - node.actualPct));
  const weeks = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
  if (node.lateBy !== undefined) {
    return (
      <div className="mt-4 flex gap-3 rounded-xl border border-warn/30 bg-warn-soft px-3.5 py-3">
        <TriangleAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warn" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-warn">{weeks(node.lateBy)} late</p>
          <p className="mt-0.5 text-[12.5px] text-warn">
            Plan ended W{node.finishWeek}. Still {toGo}% to go.
          </p>
        </div>
      </div>
    );
  }
  if (node.dueIn !== undefined) {
    return (
      <div className="mt-4 flex gap-3 rounded-xl border border-chart-1/25 bg-chart-1/8 px-3.5 py-3">
        <Clock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-chart-1" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-chart-1">
            {node.dueIn === 0 ? 'Ends this week' : `Ends in ${weeks(node.dueIn)}`}
          </p>
          <p className="mt-0.5 text-[12.5px] text-chart-1">
            Plan ends W{node.finishWeek}. {toGo}% to go.
          </p>
        </div>
      </div>
    );
  }
  return null;
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

/* ------------------------------------------------------------ fact tiles */

/**
 * Budget and schedule as two tiles side by side, each one the way to the
 * screen that changes it: Weights for money, the planner for dates. The same
 * tile as the kind-of-work choice at the top of the panel, so the panel opens
 * and closes on one shape instead of adding a second one at the foot.
 *
 * Nothing is edited here. A budget edit is checked against its heading's pool
 * and moves every weight in that pool, which only the Weights screen can show.
 * A tile with nowhere to go (an imported project has no Weights screen) is
 * drawn without its chevron rather than hidden, because the figures still hold.
 */
function FactTiles({
  node,
  weightsHref,
  projectHref,
  currency,
}: {
  node: MapNode;
  weightsHref: string | null;
  projectHref: string | null;
  currency: string;
}) {
  const money = fmtMoney(node.price, currency);
  const span =
    node.startWeek && node.finishWeek ? `W${node.startWeek}–W${node.finishWeek}` : null;
  const from = fmtShortDate(node.startDate);
  const to = fmtShortDate(node.finishDate);
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <FactTile label="Budget" href={weightsHref}>
        <FactValue value={money} empty="No budget" />
        <p className="mt-0.5 text-[12px] tabular-nums text-chart-1">{fmt2(node.weight)}% of project</p>
      </FactTile>
      <FactTile label="Schedule" href={projectHref}>
        <FactValue value={span} empty="Not set" />
        {from && to && (
          <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">
            {from} to {to}
          </p>
        )}
      </FactTile>
    </div>
  );
}

function FactTile({
  label,
  href,
  children,
}: {
  label: string;
  href: string | null;
  children: React.ReactNode;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[12px] text-muted-foreground">{label}</p>
        {href && <ChevronRight className="h-4 w-4 text-muted-foreground" strokeWidth={2} aria-hidden="true" />}
      </div>
      {children}
    </>
  );
  const cls = 'block min-w-0 rounded-2xl border border-input bg-card px-3.5 py-3';
  return href ? (
    <Link
      href={href}
      className={cn(cls, 'transition-colors duration-200 ease-ios hover:bg-muted/60 active:bg-muted')}
    >
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/**
 * The figure itself. A long budget steps down a size instead of wrapping or
 * being cut: at 390px a tile holds "Rp 56,162" at 17px but not
 * "Rp 11,253,000,000", and a figure broken over two lines is not read as one.
 */
function FactValue({ value, empty }: { value: string | null; empty: string }) {
  const long = (value ?? '').length > 12;
  return (
    <p
      className={cn(
        'mt-1 font-semibold tabular-nums tracking-tight',
        long ? 'text-[15px] leading-6' : 'text-[17px] leading-6',
        value === null ? 'text-muted-foreground' : 'text-foreground'
      )}
    >
      {value ?? empty}
    </p>
  );
}
