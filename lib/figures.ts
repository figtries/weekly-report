/**
 * A figure you can recompute on screen must recompute.
 *
 * Every percentage in the app is shown to two decimals, and people check the
 * screen with a calculator: week 35 printed 40.71% actual beside 34.44% plan
 * and called the gap 6.26%, because the gap was taken between the unrounded
 * figures (40.7063 − 34.4431). Nothing was wrong and it read as wrong. So a
 * difference is taken between the figures AS SHOWN, and parts that explain a
 * shown total are apportioned so they add up to it exactly (26 Sep 2026).
 *
 * `r2` rounds the way `fmtPct` prints (toFixed), so what is computed here and
 * what is on screen can never land on different sides of a half.
 */

export function r2(n: number): number {
  const v = Number(n.toFixed(2));
  return Object.is(v, -0) ? 0 : v;
}

/** `a − b` between the two figures as they are printed. */
export function shownDiff(a: number, b: number): number {
  return r2(r2(a) - r2(b));
}

/**
 * Round each value to two decimals so the rounded parts add up to `total`
 * rounded — largest remainder, in hundredths. Order is kept.
 *
 * Used wherever a list explains a figure printed above it: By section sums to
 * the deviation, Work spread to 100, What moved to "added this week". Plain
 * rounding leaves those a hundredth off often enough to be noticed.
 */
export function apportion(values: number[], total: number): number[] {
  if (values.length === 0) return [];
  const target = Math.round(r2(total) * 100);
  const floors = values.map((v) => Math.floor(v * 100 + 1e-9));
  const rest = values.map((v, i) => v * 100 - floors[i]);
  let gap = target - floors.reduce((s, f) => s + f, 0);
  const order = values.map((_, i) => i);
  if (gap > 0) {
    order.sort((a, b) => rest[b] - rest[a]);
    for (let k = 0; gap > 0; k = (k + 1) % order.length, gap -= 1) floors[order[k]] += 1;
  } else if (gap < 0) {
    order.sort((a, b) => rest[a] - rest[b]);
    for (let k = 0; gap < 0; k = (k + 1) % order.length, gap += 1) floors[order[k]] -= 1;
  }
  return floors.map((c) => {
    const v = c / 100;
    return Object.is(v, -0) ? 0 : v;
  });
}
