'use client';

import { useMemo, useState, useTransition } from 'react';
import { m } from 'framer-motion';

import { setWorkKindAction } from '@/lib/actions';
import { ladderFor } from '@/lib/work-kind-apply';
import {
  agreeingPeers,
  BUILT_IN_KINDS,
  guessWorkKind,
  NO_KIND,
  suggestFromPeers,
  type Shape,
  type WorkKind,
} from '@/lib/work-kind';
import type { MapNode } from '@/lib/overall-map';
import type { Milestone } from '@/lib/types';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';

/**
 * One question: how is this row measured?
 *
 * It used to be two, asked in the wrong order. The first cut opened with the
 * KIND of work (Engineering, Procurement, Construction, Commissioning) and put
 * the form beside it, which meant answering a question about classification
 * before the question anyone actually had. Worse, the kind changes nothing
 * unless the answer is Stages: it exists to fill a ladder with rungs, and a
 * gate, a count and a typed percent have no rungs to fill. So the kind became
 * the SECOND question, asked only on the branch that uses it, and there it
 * stops being "what sort of work is this" and becomes "which stages" — a
 * question with a visible answer right under it.
 *
 * The four answers here are the four forms in `ProgressEntry`, with the same
 * words. Nothing on this screen can now pick something that is not a form, and
 * no form can be reached that is not offered here.
 *
 * `suggestFromPeers` is what keeps the asking cheap: correcting "PO Unprice"
 * once answers the other seventeen, because every peer spelled the same way
 * already carries the answer a person chose. `guessWorkKind` is the fallback
 * for a name nothing has answered yet. When neither has anything to say, the
 * buttons show with no claim above them, because a wrong guess writes an
 * answer while no guess only asks a question.
 */

/** A leaf that already has an answer, as the map needs to hand it down. */
export interface WorkKindPeer {
  name: string;
  kindId: string;
  shape: Shape;
}

const SHAPE_LABEL: Record<Shape, string> = {
  steps: 'Stages',
  qty: 'Quantity',
  gate: 'One-off',
  manual: 'Typed percent',
};

const SHAPE_CAPTION: Record<Shape, string> = {
  steps: 'It climbs through stages, and you tick off the ones that are done.',
  qty: 'There is a total to count towards, and the percent is the arithmetic.',
  gate: 'It is either done or it is not, so the answer is a switch and a date.',
  manual: 'Someone types the percent. Always available, whatever else is set.',
};

const ORDER: Shape[] = ['steps', 'qty', 'gate', 'manual'];

interface Suggestion {
  kindId: string;
  shape: Shape;
  /** The peer's own name, or null when the guess came from `guessWorkKind` instead. */
  exampleName: string | null;
  /** Peers beyond the one named, or null when there was no peer at all. */
  otherCount: number | null;
}

function sentenceFor(suggestion: Suggestion | null): string | null {
  if (!suggestion) return null;
  const label = BUILT_IN_KINDS.find((k) => k.id === suggestion.kindId)?.label ?? null;
  if (!suggestion.exampleName) return label ? `Looks like ${label}.` : null;
  const tail =
    suggestion.otherCount && suggestion.otherCount > 0
      ? ` and ${suggestion.otherCount} other ${suggestion.otherCount === 1 ? 'row' : 'rows'}`
      : '';
  // A peer answered without a ladder carries `NO_KIND`, so there is no kind to
  // name and the sentence says only what it can stand behind: this row was
  // spelled the same way as one somebody already answered.
  return label
    ? `Looks like ${label}, same as "${suggestion.exampleName}"${tail}.`
    : `Same as "${suggestion.exampleName}"${tail}.`;
}

export default function WorkKindPicker({
  node,
  peers,
  current,
  onDone,
  onCancel,
}: {
  node: Pick<MapNode, 'id' | 'name' | 'qtyTotal' | 'unit'>;
  peers: WorkKindPeer[];
  /**
   * What the row is measured by RIGHT NOW, when this was opened to change an
   * answer rather than to give one. Its presence is also what puts Cancel on
   * screen: there is only something to go back to once an answer exists.
   */
  current: { kindId: string | null; shape: Shape } | null;
  onDone: (
    kindId: string,
    shape: Shape,
    milestones: Milestone[],
    qty?: { total: number; unit: string | null }
  ) => void;
  onCancel?: () => void;
}) {
  const suggestion = useMemo<Suggestion | null>(() => {
    // An answered row is not a row to make suggestions about. Showing "looks
    // like Procurement" over a decision somebody already took reads as the app
    // arguing with them.
    if (current) return null;
    const peerHit = suggestFromPeers(node.name, peers);
    if (peerHit) {
      // Only the peers that AGREE with this suggestion count — see
      // `agreeingPeers`'s own comment in `lib/work-kind.ts` for why a
      // disagreeing peer must never inflate this number.
      const agreeing = agreeingPeers(node.name, peerHit, peers);
      return {
        kindId: peerHit.kindId,
        shape: peerHit.shape,
        exampleName: agreeing[0]?.name ?? null,
        otherCount: agreeing.length - 1,
      };
    }
    const guess = guessWorkKind(node.name, BUILT_IN_KINDS);
    return guess ? { ...guess, exampleName: null, otherCount: null } : null;
  }, [current, node.name, peers]);

  const seedKind = current
    ? current.kindId && current.kindId !== NO_KIND
      ? current.kindId
      : null
    : (suggestion?.kindId === NO_KIND ? null : suggestion?.kindId) ?? null;

  const [step, setStep] = useState<'measure' | 'kind' | 'qty'>('measure');
  const [shape, setShape] = useState<Shape | null>(current?.shape ?? suggestion?.shape ?? null);
  const [kindId, setKindId] = useState<string | null>(seedKind);
  // Seeded from the row only when the row has a REAL quantity. Every seeded
  // item is stored as `vol: 1, satuan: 'Ls'`, which is a placeholder and not a
  // total: offering it here would hand somebody a prefilled answer that the
  // server then refuses, which reads as the app breaking rather than as the
  // app asking. Mirrors `hasRealQuantity` in lib/progress.ts.
  const real =
    (node.qtyTotal ?? 0) > 0 && !['', 'ls', 'lot'].includes((node.unit ?? '').trim().toLowerCase());
  const [total, setTotal] = useState(real ? String(node.qtyTotal) : '');
  const [unit, setUnit] = useState(real ? node.unit ?? '' : '');
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sentence = sentenceFor(suggestion);
  const kind = BUILT_IN_KINDS.find((k) => k.id === kindId) ?? null;

  function commit(finalShape: Shape, finalKindId: string, qtyTotal?: number) {
    setError(null);
    const milestones = ladderFor(finalKindId, finalShape, node.name, BUILT_IN_KINDS);
    const qty =
      finalShape === 'qty'
        ? { total: qtyTotal as number, unit: unit.trim() || null }
        : undefined;
    startSaving(async () => {
      const res = await setWorkKindAction(node.id, node.name, finalKindId, finalShape, {
        steps: milestones,
        ...(qty ? { vol: qty.total, satuan: qty.unit } : {}),
      });
      if (!res.ok) return setError(res.error ?? 'Could not save');
      onDone(finalKindId, finalShape, milestones, qty);
    });
  }

  function onwards() {
    if (!shape || saving) return;
    if (shape === 'steps') return setStep('kind');
    if (shape === 'qty') return setStep('qty');
    // A gate carries the row's own name as its single rung and a typed percent
    // carries none, so neither has a second question to ask.
    commit(shape, NO_KIND);
  }

  if (step === 'kind') {
    return (
      <div>
        <BackLink onClick={() => setStep('measure')} />
        <p className="mt-2 text-[13px] text-foreground">Which stages does it go through?</p>

        <div className="mt-2 grid grid-cols-2 gap-2">
          {BUILT_IN_KINDS.map((k) => (
            <KindButton key={k.id} kind={k} active={k.id === kindId} onClick={() => setKindId(k.id)} />
          ))}
        </div>

        {kind && (
          <ul className="mt-3 space-y-1">
            {kind.steps.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between rounded-lg bg-card px-3 py-2 text-[13px] text-foreground"
              >
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{s.weight}%</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          Rename or reweight the stages later in the planner.
        </p>

        {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}

        <SaveButton
          disabled={!kindId}
          saving={saving}
          onClick={() => kindId && commit('steps', kindId)}
        />
      </div>
    );
  }

  if (step === 'qty') {
    return (
      <div>
        <BackLink onClick={() => setStep('measure')} />
        <p className="mt-2 text-[13px] text-foreground">What is the total, and in what unit?</p>

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
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          The percent comes from the count, so nobody has to judge it.
        </p>

        {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}

        <SaveButton
          disabled={false}
          saving={saving}
          onClick={() => {
            const v = Number(total);
            if (!v || v <= 0) return setError('A count needs a total above zero');
            commit('qty', NO_KIND, v);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      {sentence && <p className="text-[13px] leading-relaxed text-muted-foreground">{sentence}</p>}

      <p className={cn('text-[13px] text-foreground', sentence && 'mt-2')}>
        How is this measured?
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {ORDER.map((s) => (
          <m.button
            key={s}
            {...pressMotion}
            type="button"
            onClick={() => setShape(s)}
            aria-pressed={s === shape}
            className={cn(
              'flex min-h-14 items-center justify-center rounded-2xl border px-3 text-center text-sm font-medium transition-colors duration-200 ease-ios',
              s === shape
                ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                : 'border-input bg-card text-foreground hover:bg-muted/50'
            )}
          >
            {SHAPE_LABEL[s]}
          </m.button>
        ))}
      </div>

      {shape && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          {SHAPE_CAPTION[shape]}
        </p>
      )}

      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}

      <div className="mt-3 flex gap-2">
        {onCancel && (
          <m.button
            {...pressMotion}
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-h-12 flex-1 rounded-xl border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60 disabled:opacity-50"
          >
            Cancel
          </m.button>
        )}
        <m.button
          {...pressMotion}
          type="button"
          onClick={onwards}
          disabled={!shape || saving}
          className="btn-primary min-h-12 flex-1 rounded-xl text-sm font-medium disabled:opacity-40"
        >
          {saving
            ? 'Saving…'
            : shape === 'steps' || shape === 'qty'
              ? 'Continue'
              : 'Save'}
        </m.button>
      </div>
    </div>
  );
}

function KindButton({
  kind,
  active,
  onClick,
}: {
  kind: WorkKind;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <m.button
      {...pressMotion}
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex min-h-14 items-center justify-center rounded-2xl border px-3 text-center text-sm font-medium transition-colors duration-200 ease-ios',
        active
          ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
          : 'border-input bg-card text-foreground hover:bg-muted/50'
      )}
    >
      {kind.label}
    </m.button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 flex min-h-11 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground transition-colors duration-200 ease-ios hover:bg-muted/50 hover:text-foreground"
    >
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      How is this measured
    </button>
  );
}

function SaveButton({
  disabled,
  saving,
  onClick,
}: {
  disabled: boolean;
  saving: boolean;
  onClick: () => void;
}) {
  return (
    <m.button
      {...pressMotion}
      type="button"
      onClick={onClick}
      disabled={disabled || saving}
      className="btn-primary mt-3 min-h-12 w-full rounded-xl text-sm font-medium disabled:opacity-40"
    >
      {saving ? 'Saving…' : 'Save'}
    </m.button>
  );
}
