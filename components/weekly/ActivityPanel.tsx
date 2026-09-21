'use client';

import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';

import {
  markNoProgressAction,
  saveFieldProgressAction,
  saveWeekUpdatesAction,
  setProgressMethodAction,
} from '@/lib/actions';
import { updateRowTextAction } from '@/lib/sheet-actions';
import type { MapNode } from '@/lib/overall-map';
import type { Milestone, ProgressMethod } from '@/lib/types';
import type { Shape } from '@/lib/work-kind';
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

const METHOD_LABEL: Record<ProgressMethod, string> = {
  qty: 'Quantity',
  milestone: 'Steps',
  lumpsum: 'Typed percent',
};

/**
 * What the "How it is counted" disclosure calls a row, which must name the
 * FORM ABOVE IT rather than the raw stored method — `milestone` covers both a
 * single-rung gate and a real multi-step ladder, and `lumpsum` covers both a
 * quote and a hand-typed percent. `METHOD_LABEL` above answers "how is this
 * measured", which is still the right question for the three-way switcher in
 * `MethodSection` (that IS choosing a stored method); this answers "what does
 * the form on screen ask", which is a `Shape`, not a `ProgressMethod`. Reuses
 * `deriveShape` rather than a second copy of its logic — same words as
 * `WorkKindPicker`'s own shape buttons, so the disclosure never disagrees with
 * the picker that put the row here.
 */
const SHAPE_METHOD_LABEL: Record<EntryShape, string> = {
  gate: 'One-off',
  steps: 'Stages',
  quote: 'Quoted',
  manual: 'Typed percent',
};

function countedAs(node: MapNode): string {
  // Quantity is the one method with no shape at all — `deriveShape` would
  // otherwise read it as 'manual', which is a real label but the wrong one.
  if ((node.method ?? 'lumpsum') === 'qty') return METHOD_LABEL.qty;
  return SHAPE_METHOD_LABEL[deriveShape(node)];
}

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
  canPrice,
  projectHref,
  peers,
  onClose,
  onSaved,
}: {
  node: MapNode | null;
  trail: MapNode[];
  week: number;
  /** SQLite projects only: the imported project's rows live in db.json. */
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
  canPrice,
  projectHref,
  peers,
  onClose,
  onSaved,
}: {
  node: MapNode;
  trail: MapNode[];
  week: number;
  canPrice: boolean;
  projectHref: string | null;
  peers: WorkKindPeer[];
  onClose: () => void;
  onSaved: (id: string, pct: number) => void;
}) {
  /**
   * Set once, right after `setWorkKindAction` succeeds, so the very same open
   * panel can show the form for the kind just chosen. `node` itself will not
   * carry the new `workKind` until the route refreshes behind it — that is
   * seconds away, not zero — so until it lands this override stands in for
   * the fields a freshly-answered leaf would have.
   */
  const [kindOverride, setKindOverride] = useState<{
    kindId: string;
    shape: Shape;
    milestones: Milestone[];
  } | null>(null);
  const asking = !node.workKind && !kindOverride;
  const effectiveNode: MapNode = kindOverride
    ? {
        ...node,
        workKind: kindOverride.kindId,
        method: kindOverride.shape === 'quote' ? 'lumpsum' : 'milestone',
        milestones: kindOverride.milestones.map((m) => ({ ...m, done: false })),
        source: kindOverride.shape === 'quote' ? 'quote' : node.source,
      }
    : node;

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
  const [heldManual, setHeldManual] = useState<{ seed: string; manual: boolean }>(() => ({ seed, manual: false }));
  const manual = heldManual.seed === seed ? heldManual.manual : false;
  const setManual = (v: boolean) => setHeldManual({ seed, manual: v });
  const shape: EntryShape = deriveShape(effectiveNode);
  const source: EntryShape = manual ? 'manual' : shape;

  const [open, setOpen] = useState<'method' | 'money' | 'schedule' | null>(null);
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
  const dirty = Math.abs(pct - node.actualPct) > 0.004;

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
    window.setTimeout(onClose, 420);
  }

  function save() {
    if (!dirty || saving) return;
    setError(null);
    startSaving(async () => {
      if (!manual && effectiveNode.method === 'qty') {
        // Quantity mode is untouched by this feature: still its own count,
        // still no note or source attached.
        const res = await saveFieldProgressAction(week, [{ leafId: node.id, qtyDone: draft.qtyDone }]);
        if (!res.ok) return setError(res.error ?? 'Could not save');
      } else if (!manual && effectiveNode.method === 'milestone') {
        const res = await saveFieldProgressAction(week, [
          { leafId: node.id, milestonesDone: draft.milestonesDone, note: draft.note || undefined, source },
        ]);
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
        });
        if (!res.ok) return setError(res.error ?? 'Could not save');
      }
      finish(pct);
    });
  }

  function nothing() {
    if (saving) return;
    setError(null);
    startSaving(async () => {
      const res = await markNoProgressAction(week, [node.id]);
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
                onDone={(kindId, kindShape, milestones) =>
                  setKindOverride({ kindId, shape: kindShape, milestones })
                }
              />
            ) : (
              <ProgressEntry
                node={effectiveNode}
                draft={draft}
                setDraft={setDraft}
                shape={shape}
                manual={manual}
                onManual={() => setManual(true)}
                onManualOff={() => setManual(false)}
              />
            )}

            {/* The anchor figure only. Its own translation into plan terms —
                rise, plan comparison, contribution — is `PlanFacts` inside
                `ProgressEntry` now: printing the plan sentence here too read
                as a stutter, the same fact said twice on one screen. */}
            <div className="mt-4 flex items-baseline gap-2 border-t border-border/60 pt-3">
              <span className="text-2xl font-semibold tabular-nums tracking-tight text-chart-1">
                {fmt1(pct)}%
              </span>
            </div>
          </div>

          <div className="mt-4 border-t border-border">
            <Disclosure
              label="How it is counted"
              value={countedAs(effectiveNode)}
              open={open === 'method'}
              onToggle={() => setOpen(open === 'method' ? null : 'method')}
            >
              <MethodSection node={effectiveNode} />
            </Disclosure>

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

/**
 * How this activity is counted — offered on EVERY project, imported or not.
 *
 * `setProgressMethodAction` forks to `applyProgressMethod` for a project on
 * db.json and to SQLite for the rest, so both stores can answer this. Only the
 * PRICE below is SQLite-only, and gating the two together would have told
 * Gundih's owner that an activity's method was fixed when it never was.
 */
function MethodSection({ node }: { node: MapNode }) {
  const current = node.method ?? 'lumpsum';
  const [pending, start] = useTransition();
  const [ask, setAsk] = useState<'qty' | 'milestone' | null>(null);
  const [total, setTotal] = useState(String(node.qtyTotal ?? ''));
  const [unit, setUnit] = useState(node.unit ?? '');
  const [steps, setSteps] = useState(String((node.milestones ?? []).length || 4));
  const [error, setError] = useState<string | null>(null);

  function apply(method: ProgressMethod, opts?: { vol?: number | null; satuan?: string | null; milestones?: Milestone[] }) {
    setError(null);
    start(async () => {
      const res = await setProgressMethodAction(node.id, method, opts ?? {});
      if (!res.ok) setError(res.error ?? 'Could not change');
      else setAsk(null);
    });
  }

  function choose(method: ProgressMethod) {
    if (method === current) return;
    if (method === 'qty') return setAsk('qty');
    if (method === 'milestone') return setAsk('milestone');
    apply('lumpsum');
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['qty', 'milestone', 'lumpsum'] as ProgressMethod[]).map((mth) => (
          <m.button
            key={mth}
            {...pressMotion}
            onClick={() => choose(mth)}
            disabled={pending}
            className={cn(
              'min-h-11 rounded-xl border px-2 text-[13px] font-medium transition-colors duration-200 ease-ios',
              mth === current
                ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                : 'border-input bg-card text-muted-foreground hover:bg-muted/60'
            )}
          >
            {METHOD_LABEL[mth]}
          </m.button>
        ))}
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        {current === 'qty'
          ? 'The percentage comes from the quantity, so nobody has to judge it.'
          : current === 'milestone'
            ? 'The percentage comes from the steps ticked off.'
            : 'Someone types the percentage. Counting it beats judging it, where there is something to count.'}
      </p>

      <Expand open={ask === 'qty'}>
        <div className="mt-3 rounded-xl bg-muted/40 p-3">
          <p className="text-[13px] text-foreground">What is the total, and in what unit?</p>
          <div className="mt-2 flex gap-2">
            <input
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              inputMode="decimal"
              placeholder="450"
              className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-card px-3 text-sm tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="m"
              className="h-11 w-20 rounded-lg border border-input bg-card px-3 text-sm text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
            />
          </div>
          <m.button
            {...pressMotion}
            onClick={() => {
              const v = Number(total);
              if (!v || v <= 0) return setError('A quantity needs a total above zero');
              apply('qty', { vol: v, satuan: unit.trim() || null });
            }}
            disabled={pending}
            className="btn-primary mt-2 min-h-11 w-full rounded-lg text-sm font-medium"
          >
            {pending ? 'Changing…' : 'Count it by quantity'}
          </m.button>
        </div>
      </Expand>

      <Expand open={ask === 'milestone'}>
        <div className="mt-3 rounded-xl bg-muted/40 p-3">
          <p className="text-[13px] text-foreground">How many steps does it take?</p>
          <input
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            inputMode="numeric"
            className="mt-2 h-11 w-full rounded-lg border border-input bg-card px-3 text-sm tabular-nums text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-chart-1"
          />
          <p className="mt-1.5 text-[12px] text-muted-foreground">
            Each step carries an equal share. Rename them later in the planner.
          </p>
          <m.button
            {...pressMotion}
            onClick={() => {
              const n = Math.round(Number(steps));
              if (!n || n < 2) return setError('Two steps or more');
              const weight = round2(100 / n);
              apply('milestone', {
                milestones: Array.from({ length: n }, (_, i) => ({
                  id: `${node.id}-s${i + 1}`,
                  label: `Step ${i + 1}`,
                  weight,
                })),
              });
            }}
            disabled={pending}
            className="btn-primary mt-2 min-h-11 w-full rounded-lg text-sm font-medium"
          >
            {pending ? 'Changing…' : 'Count it by steps'}
          </m.button>
        </div>
      </Expand>

      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
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
