'use client';

import { useMemo, useState, useTransition } from 'react';
import { m } from 'framer-motion';

import { setWorkKindAction } from '@/lib/actions';
import { ladderFor } from '@/lib/work-kind-apply';
import {
  BUILT_IN_KINDS,
  guessWorkKind,
  normalizeName,
  shapeOf,
  suggestFromPeers,
  type Shape,
  type WorkKind,
} from '@/lib/work-kind';
import type { MapNode } from '@/lib/overall-map';
import type { Milestone } from '@/lib/types';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';

/**
 * The one question the whole feature turns on: what kind of work is this row?
 *
 * Asked once, never pre-applied. `suggestFromPeers` is what makes "once" true:
 * correcting "PO Unprice" the first time answers the other seventeen, because
 * every peer spelled the same way already carries the kind and shape a person
 * chose for it. `guessWorkKind` is the fallback for a name nothing has
 * answered yet. When neither has anything to say, the four kind buttons show
 * with no claim above them — a wrong guess writes an answer, no guess only
 * asks a question.
 */

/** A leaf that already has an answer, as the map needs to hand it down. */
export interface WorkKindPeer {
  name: string;
  kindId: string;
  shape: Shape;
}

const SHAPE_LABEL: Record<Shape, string> = {
  gate: 'One-off',
  steps: 'Stages',
  quote: 'Quoted',
};

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
  const label = BUILT_IN_KINDS.find((k) => k.id === suggestion.kindId)?.label ?? suggestion.kindId;
  if (!suggestion.exampleName) return `Looks like ${label}.`;
  const tail =
    suggestion.otherCount && suggestion.otherCount > 0
      ? ` and ${suggestion.otherCount} other ${suggestion.otherCount === 1 ? 'row' : 'rows'}`
      : '';
  return `Looks like ${label}, same as "${suggestion.exampleName}"${tail}.`;
}

export default function WorkKindPicker({
  node,
  peers,
  onDone,
}: {
  node: Pick<MapNode, 'id' | 'name'>;
  peers: WorkKindPeer[];
  onDone: (kindId: string, shape: Shape, milestones: Milestone[]) => void;
}) {
  const suggestion = useMemo<Suggestion | null>(() => {
    const peerHit = suggestFromPeers(node.name, peers);
    if (peerHit) {
      const n = normalizeName(node.name);
      const matches = peers.filter((p) => normalizeName(p.name) === n);
      return {
        kindId: peerHit.kindId,
        shape: peerHit.shape,
        exampleName: matches[0]?.name ?? null,
        otherCount: matches.length - 1,
      };
    }
    const guess = guessWorkKind(node.name, BUILT_IN_KINDS);
    return guess ? { ...guess, exampleName: null, otherCount: null } : null;
  }, [node.name, peers]);

  const [kindId, setKindId] = useState<string | null>(suggestion?.kindId ?? null);
  const [shape, setShape] = useState<Shape>(suggestion?.shape ?? 'steps');
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const sentence = sentenceFor(suggestion);

  function pick(k: WorkKind) {
    setKindId(k.id);
    // The peer's own shape wins for the kind it actually suggested; any other
    // kind falls back to what the row's name itself implies, same as the
    // built-in guess would.
    setShape(suggestion && suggestion.kindId === k.id ? suggestion.shape : shapeOf(node.name, k));
  }

  function save() {
    if (!kindId || saving) return;
    setError(null);
    startSaving(async () => {
      const res = await setWorkKindAction(node.id, node.name, kindId, shape);
      if (!res.ok) return setError(res.error ?? 'Could not save');
      onDone(kindId, shape, ladderFor(kindId, shape, node.name, BUILT_IN_KINDS));
    });
  }

  return (
    <div>
      {sentence && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{sentence}</p>
      )}

      <div className={cn('grid grid-cols-2 gap-2', sentence && 'mt-3')}>
        {BUILT_IN_KINDS.map((k) => (
          <m.button
            key={k.id}
            {...pressMotion}
            type="button"
            onClick={() => pick(k)}
            aria-pressed={k.id === kindId}
            className={cn(
              'flex min-h-14 items-center justify-center rounded-2xl border px-3 text-center text-sm font-medium transition-colors duration-200 ease-ios',
              k.id === kindId
                ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                : 'border-input bg-card text-foreground hover:bg-muted/50'
            )}
          >
            {k.label}
          </m.button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {(['gate', 'steps', 'quote'] as const).map((s) => (
          <m.button
            key={s}
            {...pressMotion}
            type="button"
            onClick={() => setShape(s)}
            aria-pressed={s === shape}
            className={cn(
              'min-h-11 rounded-xl border px-2 text-[13px] font-medium transition-colors duration-200 ease-ios',
              s === shape
                ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                : 'border-input bg-card text-muted-foreground hover:bg-muted/50'
            )}
          >
            {SHAPE_LABEL[s]}
          </m.button>
        ))}
      </div>

      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}

      <m.button
        {...pressMotion}
        type="button"
        onClick={save}
        disabled={!kindId || saving}
        className="btn-primary mt-3 min-h-12 w-full rounded-xl text-sm font-medium disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </m.button>
    </div>
  );
}
