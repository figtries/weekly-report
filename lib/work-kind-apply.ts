import { milestoneProgress } from './progress';
import type { Milestone } from './types';
import { gateLadder, type Shape, type WorkKind } from './work-kind';

/**
 * Turning a work kind into stored rungs, and saying out loud what that costs.
 *
 * Changing how you measure must not change what was measured, and this module is
 * where that promise is kept honest. It cannot be kept perfectly: a row reported
 * at 57.5% against a 15/50/25/10 ladder is not on any rung, and the only honest
 * restatement is the rung below it. So the figure moves, and because it moves the
 * app must SAY SO BEFORE it happens rather than afterwards. That is the whole
 * reason `impactOf` exists and why nothing here writes anything.
 */

export interface KindTarget {
  id: string;
  name: string;
  /** Share of the whole project, 0..100. */
  bobot: number;
  /** Where the row stands today, in its own percent. */
  pct: number;
}

export interface KindChange {
  id: string;
  fromPct: number;
  toPct: number;
  /** Share of the whole project, carried so an impact can be weighted without a second lookup. */
  bobot: number;
  milestones: Milestone[];
  /** Ids of the rungs awarded by the restatement. */
  done: string[];
}

/** The rungs a row gets. A gate is one rung carrying the row's own name. */
export function ladderFor(
  kindId: string,
  shape: Shape,
  rowName: string,
  kinds: WorkKind[]
): Milestone[] {
  if (shape === 'gate') return gateLadder(rowName);
  if (shape === 'quote') return [];
  const kind = kinds.find((k) => k.id === kindId);
  return kind ? kind.steps.map((s) => ({ ...s })) : [];
}

/**
 * What a row becomes, without becoming it.
 *
 * Rungs are awarded in order while the running total stays at or below what was
 * already reported. Never more generous than the number it came from, which is
 * the same rule `applyProgressMethod` applies when a method changes, stated here
 * so a preview and an apply cannot drift apart.
 */
export function changeFor(row: KindTarget, milestones: Milestone[]): KindChange {
  const pct = Math.max(0, Math.min(100, row.pct));
  if (milestones.length === 0) {
    return { id: row.id, fromPct: pct, toPct: pct, bobot: row.bobot, milestones, done: [] };
  }
  const total = milestones.reduce((s, m) => s + m.weight, 0) || 1;
  const done: string[] = [];
  let acc = 0;
  for (const m of milestones) {
    if (((acc + m.weight) / total) * 100 <= pct + 1e-9) {
      acc += m.weight;
      done.push(m.id);
    } else break; // a ladder is climbed in order; a rung missed ends the climb
  }
  return {
    id: row.id,
    fromPct: pct,
    toPct: milestoneProgress(milestones, done),
    bobot: row.bobot,
    milestones,
    done,
  };
}

/**
 * What a bulk apply would do to the project total, in the project's own points.
 *
 * Reported, never corrected. The figures stand; the screen says how far they
 * will move and the person decides. Measured on Gundih week 60 across every
 * decision in the spec, this comes to 1.01 points over 25 of 218 rows.
 */
export function impactOf(changes: KindChange[]): { movedRows: number; pointsDelta: number } {
  let movedRows = 0;
  let pointsDelta = 0;
  for (const c of changes) {
    if (Math.abs(c.toPct - c.fromPct) > 0.01) movedRows += 1;
    pointsDelta += ((c.toPct - c.fromPct) / 100) * c.bobot;
  }
  return { movedRows, pointsDelta };
}
