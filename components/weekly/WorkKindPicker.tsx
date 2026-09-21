'use client';

import { useMemo, useState } from 'react';
import { m } from 'framer-motion';

import { ladderFor } from '@/lib/work-kind-apply';
import {
  agreeingPeers,
  BUILT_IN_KINDS,
  guessWorkKind,
  shapeOf,
  suggestFromPeers,
  type Shape,
} from '@/lib/work-kind';
import type { MapNode } from '@/lib/overall-map';
import type { Milestone } from '@/lib/types';
import { pressMotion } from '@/components/motion/Press';
import { cn } from '@/lib/utils';

/**
 * ONE question, and it is the only one anybody is asked: what kind of work is
 * this?
 *
 * Everything that follows from it is the app's job, not the person's. The kind
 * supplies the rungs, and the row's own name decides whether it carries the
 * whole ladder or IS one rung of it (`shapeOf`) — so nobody is asked to choose
 * between "stages" and "one-off", which is a question about our data model
 * wearing a question about their work. A middle version of this screen did ask
 * it, as a four-way measurement choice before the kind, and it was wrong twice
 * over: it put the modelling question first, and it asked for an answer the
 * name already gives.
 *
 * NOTHING HERE WRITES. The press hands the answer up and the panel applies it
 * at once, so the form appears on the tap rather than after a round trip. The
 * save goes out behind it.
 *
 * `suggestFromPeers` is what keeps the asking cheap: answering "PO Unprice"
 * once answers the other seventeen, because every peer spelled the same way
 * already carries the answer a person chose. `guessWorkKind` is the fallback
 * for a name nothing has answered yet. When neither has anything to say the
 * buttons show with no claim above them, because a wrong guess writes an
 * answer while no guess only asks a question.
 */

/** A leaf that already has an answer, as the map needs to hand it down. */
export interface WorkKindPeer {
  name: string;
  kindId: string;
  shape: Shape;
}

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
  const label = BUILT_IN_KINDS.find((k) => k.id === suggestion.kindId)?.label;
  if (!label) return null;
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
  current,
  onPick,
  onCancel,
}: {
  node: Pick<MapNode, 'id' | 'name'>;
  peers: WorkKindPeer[];
  /**
   * The kind this row already carries, when this was opened to change an
   * answer rather than to give one. Its presence is also what puts Cancel on
   * screen: there is only something to go back to once an answer exists.
   */
  current: string | null;
  onPick: (kindId: string, shape: Shape, milestones: Milestone[]) => void;
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

  const [kindId, setKindId] = useState<string | null>(current ?? suggestion?.kindId ?? null);
  const sentence = sentenceFor(suggestion);

  function save() {
    if (!kindId) return;
    const kind = BUILT_IN_KINDS.find((k) => k.id === kindId);
    if (!kind) return;
    // The peer's own shape wins for the kind it actually suggested; any other
    // kind falls back to what the row's name itself implies.
    const shape =
      suggestion && suggestion.kindId === kindId ? suggestion.shape : shapeOf(node.name, kind);
    onPick(kindId, shape, ladderFor(kindId, shape, node.name, BUILT_IN_KINDS));
  }

  return (
    <div>
      {sentence && <p className="text-[13px] leading-relaxed text-muted-foreground">{sentence}</p>}

      <p className={cn('text-[13px] text-foreground', sentence && 'mt-2')}>
        What kind of work is this?
      </p>

      <div className="mt-2 grid grid-cols-2 gap-2">
        {BUILT_IN_KINDS.map((k) => (
          <m.button
            key={k.id}
            {...pressMotion}
            type="button"
            onClick={() => setKindId(k.id)}
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

      <div className="mt-3 flex gap-2">
        {onCancel && (
          <m.button
            {...pressMotion}
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-xl border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60"
          >
            Cancel
          </m.button>
        )}
        <m.button
          {...pressMotion}
          type="button"
          onClick={save}
          disabled={!kindId}
          className="btn-primary min-h-12 flex-1 rounded-xl text-sm font-medium disabled:opacity-40"
        >
          Save
        </m.button>
      </div>
    </div>
  );
}
