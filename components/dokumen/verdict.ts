/**
 * Actual against plan as SHOWN, one decimal, for every Document Control screen.
 *
 * 51.1% beside 55.6% reads "Behind 4.5" and a calculator agrees (see
 * lib/figures.ts). Three words only, decided 3 Oct 2026: the old set also had
 * "slipping", and "on plan" covered anything within a point, which put an
 * "on plan" chip on a register 3.3 ahead. The summary and the data screen both
 * read this, so a discipline cannot be "ahead" on one and "on plan" on the other.
 */

/** One decimal, the way every figure in Document Control is printed. */
export const r1 = (n: number) => {
  const v = Number(n.toFixed(1));
  return Object.is(v, -0) ? 0 : v;
};

export function verdict(actual: number, plan: number): { label: string; chip: string; diff: number } {
  const diff = r1(r1(actual) - r1(plan));
  if (diff > 0) return { label: `Ahead ${diff.toFixed(1)}`, chip: 'bg-ok-soft text-ok', diff };
  if (diff === 0) return { label: 'On plan', chip: 'bg-muted text-muted-foreground', diff };
  return {
    label: `Behind ${Math.abs(diff).toFixed(1)}`,
    chip: diff <= -10 ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn',
    diff,
  };
}
