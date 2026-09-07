import { MOTION } from '@/lib/design';

/**
 * A number that arrives with its own small movement. Used only for the two or
 * three figures a page is actually about — on every number it becomes noise,
 * and on a table it becomes a performance problem.
 *
 * IT WAS framer-motion AND IT SHIPPED THE HERO FIGURE INVISIBLE. `motion.span`
 * writes its `initial` prop into the server HTML, so the number rendered as
 * `opacity: 0` and waited for hydration to raise it — the exact bug
 * `components/motion/Reveal.tsx` was written to document, hiding in the one
 * element on the page that matters most. Under `prefers-reduced-motion` it did
 * not even recover: the reduced branch returns a plain `<span>`, React
 * reconciles it against the motion `<span>` as the same host element, the
 * server's inline `opacity: 0` stays on it, and a reduced-motion visitor was
 * left looking at a blank space where the project percentage should be. A test
 * on the dashboard caught it at 390px.
 *
 * So it is a CSS keyframe now, like every other entrance in this app. The
 * number is in the first paint, the animation runs on the compositor, and the
 * global `prefers-reduced-motion` block in globals.css collapses it to nothing
 * without this file needing an opinion. It also takes framer-motion back out
 * of the Dashboard's and the EDL summary's bundles, which is what it was split
 * away from `Reveal` to protect in the first place.
 *
 * `.animate-fade-in-up` and not `.animate-enter`: this is one figure inside a
 * card that is itself arriving, and the two must not travel the same distance
 * or the number visibly slides against the card around it.
 *
 * `delay` exists so a figure can land just after the card carrying it.
 */
export function CountUp({
  value,
  suffix = '%',
  decimals = 2,
  delay = MOTION.stagger,
}: {
  value: number;
  suffix?: string;
  decimals?: number;
  /** Seconds. Defaults to one stagger step behind its card. */
  delay?: number;
}) {
  return (
    <span
      className="tabular-nums animate-fade-in-up"
      style={delay ? { animationDelay: `${delay}s` } : undefined}
    >
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}
