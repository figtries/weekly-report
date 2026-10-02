/**
 * The plan read as a STAGE (spec 2026-10-02 §5). "−35.0" says how far; this
 * says which rung is late, which is what a project control engineer reports.
 * Pure: the caller decides whether a plan figure may be shown at all.
 */
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export function stageAt(steps: { weight: number }[], pct: number): number {
  const total = steps.reduce((s, m) => s + m.weight, 0) || 1;
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    acc += (steps[i].weight / total) * 100;
    if (acc > pct + 1e-9) return i;
  }
  return steps.length;
}

export function stageSentence(input: {
  steps: { label: string; weight: number }[];
  actualPct: number;
  planPct: number;
  week: number;
}): string | null {
  const { steps, actualPct, planPct, week } = input;
  if (steps.length < 2) return null;
  const a = stageAt(steps, actualPct);
  const p = stageAt(steps, planPct);
  if (a === p) return null;
  const k = Math.abs(p - a);
  const count = `${WORDS[k - 1] ?? k} ${k === 1 ? 'stage' : 'stages'}`;
  const plan =
    planPct <= 0.004
      ? `Plan has not started it by week ${week}.`
      : p === steps.length
        ? `Plan has it finished by week ${week}.`
        : `Plan has it at ${steps[p].label} by week ${week}.`;
  if (p > a) {
    return actualPct <= 0.004
      ? `${plan} It has not started, ${count} behind.`
      : `${plan} It is at ${steps[a].label}, ${count} behind.`;
  }
  return a === steps.length
    ? `${plan} It is already finished, ${count} ahead.`
    : `${plan} It is already at ${steps[a].label}, ${count} ahead.`;
}
