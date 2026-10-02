'use client';

import { useImperativeHandle, useMemo, useState, type Ref } from 'react';
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
import {
  CONSTRUCTION_DISCIPLINES,
  OTHER,
  disciplineOf,
  findDiscipline,
  guessDiscipline,
} from '@/lib/disciplines';
import type { MapNode } from '@/lib/overall-map';
import type { Milestone } from '@/lib/types';
import { pressMotion } from '@/components/motion/Press';
import { Panel } from '@/components/daily/Panel';
import DisciplineIcon from './DisciplineIcon';
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

/** An answer the picker can hand up: a kind, how the row is filled in, and its rungs. */
export interface KindChoice {
  kindId: string;
  shape: Shape;
  steps: Milestone[];
}

/**
 * What the panel's own Save needs from the picker. There is ONE Save, at the
 * foot of the panel (2 Oct 2026): the picker used to carry a second one, and two
 * Save buttons stacked one above the other read as a mistake.
 */
export interface WorkKindPickerHandle {
  /**
   * What Save should apply when it is pressed with the question still on
   * screen: the chosen answer, 'same' when that is the row's own answer, or
   * null when nothing is chosen yet.
   */
  choice: () => KindChoice | 'same' | null;
}

/** A leaf that already has an answer, as the map needs to hand it down. */
export interface WorkKindPeer {
  name: string;
  kindId: string;
  shape: Shape;
  /** A construction peer's discipline, read from its rungs. */
  disciplineId?: string | null;
}

interface Suggestion {
  kindId: string;
  shape: Shape;
  /** Construction only: the discipline the app offers with it. */
  disciplineId: string | null;
  /** The peer's own name, or null when the guess came from `guessWorkKind` instead. */
  exampleName: string | null;
  /** Peers beyond the one named, or null when there was no peer at all. */
  otherCount: number | null;
}

function sentenceFor(suggestion: Suggestion | null): string | null {
  if (!suggestion) return null;
  const kindLabel = BUILT_IN_KINDS.find((k) => k.id === suggestion.kindId)?.label;
  if (!kindLabel) return null;
  const discipline = findDiscipline(suggestion.disciplineId);
  const label = discipline ? `${kindLabel}, ${discipline.short}` : kindLabel;
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
  context = [],
  currentLadder,
  onPick,
  onCancel,
  ref,
}: {
  node: Pick<MapNode, 'id' | 'name'>;
  peers: WorkKindPeer[];
  /**
   * The kind this row already carries, when this was opened to change an
   * answer rather than to give one.
   */
  current: string | null;
  /** The row's headings, nearest first: a row named "Section 3" under "Pipeline" is a pipeline. */
  context?: string[];
  /** The step ids of the rungs the row carries now, when it is answered. */
  currentLadder?: string[];
  onPick: (kindId: string, shape: Shape, milestones: Milestone[]) => void;
  /** The row's own answer pressed again: go back having changed nothing. */
  onCancel?: () => void;
  /** The panel's Save drives the picker through this. */
  ref?: Ref<WorkKindPickerHandle>;
}) {
  // The panel hands `context` down as a fresh array on every render; keyed on
  // its content, the suggestion (a pass over every peer) runs when the row
  // changes, not on every render of the panel around it.
  const contextKey = context.join('\u0000');
  const suggestion = useMemo<Suggestion | null>(() => {
    // An answered row is not a row to make suggestions about. Showing "looks
    // like Procurement" over a decision somebody already took reads as the app
    // arguing with them.
    if (current) return null;
    const disciplineFor = (kindId: string, peerDiscipline?: string | null) =>
      kindId === 'construction' ? peerDiscipline ?? guessDiscipline(node.name, context).id : null;
    const peerHit = suggestFromPeers(node.name, peers);
    if (peerHit) {
      // Only the peers that AGREE with this suggestion count — see
      // `agreeingPeers`'s own comment in `lib/work-kind.ts` for why a
      // disagreeing peer must never inflate this number.
      const agreeing = agreeingPeers(node.name, peerHit, peers);
      return {
        kindId: peerHit.kindId,
        shape: peerHit.shape,
        disciplineId: disciplineFor(peerHit.kindId, agreeing[0]?.disciplineId),
        exampleName: agreeing[0]?.name ?? null,
        otherCount: agreeing.length - 1,
      };
    }
    const guess = guessWorkKind(node.name, BUILT_IN_KINDS);
    return guess
      ? { ...guess, disciplineId: disciplineFor(guess.kindId), exampleName: null, otherCount: null }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, node.name, peers, contextKey]);

  // A Construction guess is SAID (the sentence names it and its discipline)
  // but does not select the tile: the disciplines open when a person presses
  // Construction, not before (user, 2 Oct 2026). Any other guess selects its
  // tile as it always has. A row already answered Construction opens with them
  // shown, since the discipline is what Change is usually pressed for.
  const [kindId, setKindId] = useState<string | null>(
    current ?? (suggestion?.kindId === 'construction' ? null : suggestion?.kindId ?? null)
  );
  // The row's own discipline when it has one. A row on Other opens on the
  // app's guess instead: before 2 Oct 2026 every construction row was on that
  // ladder because there was no other, not because anybody chose it, and
  // Change is how those rows get their real one.
  const [disciplineId, setDisciplineId] = useState<string>(() => {
    const own = disciplineOf((currentLadder ?? []).map((id) => ({ id })))?.id;
    return own && own !== 'other' ? own : suggestion?.disciplineId ?? guessDiscipline(node.name, context).id;
  });
  const chosen = findDiscipline(disciplineId) ?? OTHER;
  const sentence = sentenceFor(suggestion);

  /** The answer a kind (and, for Construction, a discipline) amounts to. */
  function resolve(kId: string | null, dId: string): KindChoice | 'same' | null {
    if (!kId) return null;
    const kind = BUILT_IN_KINDS.find((k) => k.id === kId);
    if (!kind) return null;
    const discipline = kId === 'construction' ? findDiscipline(dId) ?? OTHER : null;
    // The peer's own shape wins for the kind (and discipline) it actually
    // suggested; anything else falls back to what the row's name implies.
    const shape =
      suggestion && suggestion.kindId === kId && (!discipline || suggestion.disciplineId === discipline.id)
        ? suggestion.shape
        : shapeOf(node.name, discipline ?? kind);
    const steps = ladderFor(kId, shape, node.name, BUILT_IN_KINDS, discipline?.id ?? null);
    // The same answer is the way back (there is no Cancel, 27 Sep 2026), and
    // it must change nothing, because a pick rebuilds the milestone ladder and
    // would overwrite one somebody had already adjusted. For Construction the
    // same answer is the same RUNGS, so moving a row from Other to Testing is a
    // change and staying on Testing is not.
    const sameLadder = !discipline || (currentLadder ?? []).join() === steps.map((m) => m.id).join();
    if (current && kId === current && sameLadder) return 'same';
    return { kindId: kId, shape, steps };
  }

  /**
   * A press APPLIES the answer on screen at once (2 Oct 2026: "langsung
   * masuk"), and nothing is written until the panel's Save. Construction is
   * the one kind that needs a second press, on its discipline.
   */
  function apply(kId: string, dId: string) {
    const c = resolve(kId, dId);
    if (c === 'same') onCancel?.();
    else if (c) onPick(c.kindId, c.shape, c.steps);
  }

  useImperativeHandle(ref, () => ({ choice: () => resolve(kindId, disciplineId) }));

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
            onClick={() => {
              setKindId(k.id);
              if (k.id !== 'construction') apply(k.id, disciplineId);
            }}
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

      {/* The second question, and only for Construction: which discipline,
          so the rungs are that discipline's own. Opens on the press with the
          daily report's panel motion; the app's guess is already chosen. No
          line of rung names under it: the tiles say enough (2 Oct 2026). */}
      <Panel id={`discipline-${node.id}`} open={kindId === 'construction'} innerClassName="pt-3">
        <div className="rounded-2xl border border-input bg-card p-3">
          <p className="text-[13px] text-foreground">Which part of construction?</p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {CONSTRUCTION_DISCIPLINES.map((d) => (
              <m.button
                key={d.id}
                {...pressMotion}
                type="button"
                onClick={() => {
                  setDisciplineId(d.id);
                  apply('construction', d.id);
                }}
                aria-pressed={d.id === chosen.id}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[12.5px] font-medium transition-colors duration-200 ease-ios',
                  d.id === chosen.id
                    ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                    : 'border-input bg-card text-foreground hover:bg-muted/50'
                )}
              >
                <DisciplineIcon
                  id={d.id}
                  className={cn('h-5 w-5', d.id === chosen.id ? 'text-chart-1' : 'text-muted-foreground')}
                />
                {d.short}
              </m.button>
            ))}
          </div>
        </div>
      </Panel>

    </div>
  );
}
