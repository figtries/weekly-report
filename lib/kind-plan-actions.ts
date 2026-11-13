'use server';

import { requireEdit } from './auth/require-edit';
import { revalidatePath } from 'next/cache';
import { connection } from 'next/server';

import { applyKindInPlan } from './kind-plan';
import { getBarFacts, type BarFact } from './bar-facts';
import { getSheet, type Sheet } from './sheet';
import type { Shape } from './work-kind';
import type { Milestone } from './types';

/**
 * The planner's one door for "what kind of work is this?". Answers with the
 * plan and the bars as they now stand, so the sheet redraws from the server's
 * own reply rather than from a page payload that may be older.
 */
export async function setKindInPlanAction(
  projectId: string,
  nodeId: string,
  kindId: string,
  shape: Shape,
  steps: Milestone[]
): Promise<{ ok: true; sheet: Sheet; facts: Record<string, BarFact> } | { ok: false; error: string }> {
  await requireEdit();
  await connection();
  try {
    await applyKindInPlan(projectId, nodeId, kindId, shape, steps);
    revalidatePath('/projects', 'layout');
    revalidatePath('/weekly', 'layout');
    const [sheet, barResult] = await Promise.all([
      getSheet(projectId),
      getBarFacts(projectId),
    ]);
    return { ok: true, sheet, facts: barResult.facts };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Something went wrong' };
  }
}
