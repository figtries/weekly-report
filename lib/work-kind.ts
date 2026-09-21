import type { Milestone } from './types';

/**
 * What kind of work a row is, and therefore what question it deserves.
 *
 * The app used to ask every row the same thing: "what percent?". That is a
 * question about an opinion, and Gundih shows what people do when an opinion is
 * demanded of them. Of 218 leaves at week 60, 85 sat at 0 and 108 sat at 100.
 * Only 25 were ever anywhere in between. Nobody was estimating; they were
 * flipping a switch, because for most rows a switch is the honest instrument and
 * the app had not offered one.
 *
 * So a row is asked once what KIND of work it is. In EPC the answer is a short
 * list, which is exactly why it can be answered by anyone without training. The
 * kind then supplies the ladder, and the row's own NAME decides whether it
 * carries that whole ladder or IS one rung of it.
 *
 * THIS MODULE COMPUTES NO PERCENTAGE. It produces `Milestone[]`, and
 * `lib/progress.ts` remains the single origin of every figure.
 */

/**
 * The four forms a row can be filled in with, and there are exactly four
 * because there are exactly four forms on screen.
 *
 * `quote` used to sit here as a fifth. It was never a way of MEASURING
 * anything: its form was the typed-percent box with two extra note fields for
 * who reported the figure and when. Offered as a peer of `steps` it asked
 * people to classify a percentage by where it came from before they were
 * allowed to type it, and answered nothing they could not answer by typing it.
 * So the note fields moved to `SourceNote`, which every form can show, and the
 * choice here went back to being about measurement alone. Rows already saved
 * as a quote keep their stored `source` and their note, and now render as
 * `manual` with that note already filled in.
 */
export type Shape = 'gate' | 'steps' | 'qty' | 'manual';

/**
 * What `work_kind` holds for a row that was answered WITHOUT a ladder.
 *
 * The kind question exists to fill a ladder with rungs, so it is only asked
 * for `steps`. The other three still have to record that they were answered,
 * or the panel greets the row with the same question every week as though
 * nobody had ever replied. A sentinel rather than a null because null already
 * means "never asked", and those are two different states.
 */
export const NO_KIND = 'none';

export interface WorkKind {
  id: string;
  label: string;
  /** The ladder this kind offers. Always closes at 100. */
  steps: Milestone[];
  /**
   * Names that mean the row IS one rung rather than the whole climb. Matched
   * against the normalized row name, whole string or leading word.
   */
  stageHints: string[];
  /** Words anywhere in the name that put the row in this kind. */
  kindHints: string[];
}

/**
 * The four that repeat on every EPC contract.
 *
 * Engineering's 50/30/20 is not invented: `doc_stage_weights` already stores
 * exactly that for the VDRL register, so a project's documents and its WBS
 * agree without anyone reconciling them. Construction's 15/50/25/10 was chosen
 * by this app's own user. The other two are starting points, and every one of
 * them is editable per row and per project, because a default that cannot be
 * argued with is a rule, and these are not rules.
 */
export const BUILT_IN_KINDS: WorkKind[] = [
  {
    id: 'engineering',
    label: 'Engineering',
    steps: [
      { id: 'ifr', label: 'IFR', weight: 50 },
      { id: 'ifa', label: 'IFA', weight: 30 },
      { id: 'afc', label: 'AFC', weight: 20 },
    ],
    stageHints: ['ifr', 'ifa', 'afc', 're ifr', 're ifa', 're afc'],
    kindHints: ['ifr', 'ifa', 'afc', 'drawing', 'design', 'engineering', 'document', 'calculation'],
  },
  {
    id: 'procurement',
    label: 'Procurement',
    steps: [
      { id: 'po', label: 'PO issued', weight: 20 },
      { id: 'fab', label: 'Fabrication', weight: 40 },
      { id: 'rts', label: 'Ready to ship', weight: 15 },
      { id: 'onsite', label: 'On site', weight: 25 },
    ],
    stageHints: [
      'po', 'process po', 'po unprice', 'final po', 'rts', 'ready to ship',
      'material on site', 'fat', 'manufacturing process', 'delivery',
    ],
    kindHints: ['po', 'purchase', 'procurement', 'material', 'supply', 'fabrication', 'manufacturing', 'delivery', 'vendor'],
  },
  {
    id: 'construction',
    label: 'Construction',
    steps: [
      { id: 'material', label: 'Material on site', weight: 15 },
      { id: 'install', label: 'Installation', weight: 50 },
      { id: 'connect', label: 'Connections', weight: 25 },
      { id: 'qc', label: 'QC inspection', weight: 10 },
    ],
    stageHints: ['qc inspection', 'inspection', 'connections'],
    kindHints: ['installation', 'install', 'instalasi', 'dismantle', 'erection', 'civil', 'piping', 'structure', 'tie in', 'tie-in', 'cabling', 'electrical', 'mechanical'],
  },
  {
    id: 'commissioning',
    label: 'Commissioning',
    steps: [
      { id: 'precomm', label: 'Pre-commissioning', weight: 25 },
      { id: 'function', label: 'Energize & function test', weight: 35 },
      { id: 'startup', label: 'Start up', weight: 20 },
      { id: 'running', label: 'Running test', weight: 20 },
    ],
    stageHints: ['pre commissioning', 'start up', 'running test', 'function test', 'energize'],
    kindHints: ['commissioning', 'pre commissioning', 'start up', 'startup', 'running test', 'function test', 'performance test', 'energize'],
  },
];

/**
 * One spelling for a name, so eighteen rows called "PO Unprice" are one decision.
 *
 * Lowercased, punctuation dropped, runs of whitespace collapsed. Deliberately
 * NOT stemmed: two different words that happen to share a stem are two different
 * rows, and a wrong merge here silently retypes somebody else's work.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether this row carries the whole ladder or is one rung of it.
 *
 * Matched EXACTLY against a stage hint or a step's own label, never by prefix.
 * "Start Up & Running Test" normalizes to "start up running test", which
 * starts with the commissioning hint "start up " but names the whole ladder,
 * not the rung it happens to begin with. A wrong shape asks the wrong question
 * forever, while a wrong kind is one tap to fix, so shape gets the stricter
 * test: equality, never startsWith.
 */
export function shapeOf(name: string, kind: WorkKind): Shape {
  const n = normalizeName(name);
  if (kind.stageHints.some((hint) => n === hint)) return 'gate';
  if (kind.steps.some((step) => n === normalizeName(step.label))) return 'gate';
  return 'steps';
}

/**
 * The app's opening offer, shown for correction and never applied in silence.
 *
 * Returns null rather than guessing when nothing matches. A wrong guess costs
 * more than no guess: no guess asks a question, a wrong guess writes an answer.
 */
export function guessWorkKind(
  name: string,
  kinds: WorkKind[]
): { kindId: string; shape: Shape } | null {
  const n = normalizeName(name);
  let best: { kindId: string; shape: Shape; score: number } | null = null;

  for (const kind of kinds) {
    let score = 0;
    for (const hint of kind.stageHints) {
      if (n === hint) score = Math.max(score, 100);
      else if (n.startsWith(hint + ' ')) score = Math.max(score, 80);
    }
    for (const hint of kind.kindHints) {
      if (n === hint) score = Math.max(score, 70);
      else if (n.includes(hint)) score = Math.max(score, 40 + hint.length);
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { kindId: kind.id, shape: shapeOf(name, kind), score };
    }
  }

  return best ? { kindId: best.kindId, shape: best.shape } : null;
}

/**
 * What the user already decided for a row spelled the same way.
 *
 * This beats any built-in guess, and it is what makes setting a project up stop
 * feeling like setting a project up: correcting "PO Unprice" once answers the
 * other seventeen.
 */
export function suggestFromPeers(
  name: string,
  peers: Array<{ name: string; kindId: string; shape: Shape }>
): { kindId: string; shape: Shape } | null {
  const n = normalizeName(name);
  const hit = peers.find((p) => normalizeName(p.name) === n);
  return hit ? { kindId: hit.kindId, shape: hit.shape } : null;
}

/**
 * Which of a suggestion's own peers actually SUPPORT it.
 *
 * `suggestFromPeers` matches on NAME ALONE, so two rows spelled the same way
 * can have been answered differently — one "PO Unprice" saying Procurement,
 * another saying Construction. The suggestion sentence turns a peer count
 * into "and 17 other rows", and that count is the whole economy of this
 * feature: it is what makes correcting one row answer seventeen. A count
 * that includes rows CONTRADICTING the suggestion is a claim about the
 * user's own past decisions that the user cannot check — worse than no count
 * at all, because a wrong count still looks like evidence.
 */
export function agreeingPeers(
  name: string,
  hit: { kindId: string; shape: Shape },
  peers: Array<{ name: string; kindId: string; shape: Shape }>
): Array<{ name: string; kindId: string; shape: Shape }> {
  const n = normalizeName(name);
  return peers.filter((p) => normalizeName(p.name) === n && p.kindId === hit.kindId && p.shape === hit.shape);
}

/**
 * A gate is a ladder with one rung.
 *
 * Which is why this feature needs no new progress method: `milestone` already
 * stores a ladder, `lib/progress.ts` already computes one, and a single rung
 * worth 100 lands on exactly 0 or exactly 100. The only thing that differs is
 * what the screen draws.
 */
export function gateLadder(label: string): Milestone[] {
  return [{ id: 'done', label, weight: 100 }];
}
