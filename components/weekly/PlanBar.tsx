import { cn } from '@/lib/utils';

/**
 * One bar carrying two marks: how far the work has actually got, and where the
 * plan says it should be by now.
 *
 * Written once because Overall Summary and Detail Progress each drew their own,
 * with different heights, different track greys and — the part that mattered —
 * different colour rules. Detail tinted the fill by verdict, so on a contract
 * that had fallen behind the bar went red and the plan tick went red too, and
 * the one week you most need to see the gap was the week the gap disappeared.
 *
 * SO THE COLOURS ARE MEASUREMENT, NEVER VERDICT — rule 1 of `lib/design.ts`.
 * The fill is `--chart-1` because it is the actual, the tick is `--chart-2`
 * because it is the plan, on a good week and a bad one, exactly as the S-Curve
 * draws the same two things. Whether the news is good is said by the chip and
 * the deviation figure beside it, which is where a verdict belongs.
 *
 * IT GROWS ON ARRIVAL, and the reason it did not used to is worth keeping in
 * view. The old note said a bar growing inside a card that is fading in was two
 * animations arguing over one element, and that staying still kept it free to
 * render inside a list of leaves without a motion instance per row.
 *
 * The second half stopped being true when the entrance became CSS: a keyframe
 * costs no instance, no ref and no JavaScript, so a list of leaves pays nothing
 * for it. The first half was a timing problem rather than a conflict — the card
 * moves opacity and translate, the bar scales its own X, and a `stagger` on the
 * card is all it takes for the bar to land just after its card rather than
 * against it. Detail Progress has done exactly this the whole time, and it is
 * the screen people point at when they say the app feels finished.
 *
 * `animate={false}` is still there for the one case that has not changed: a
 * list long enough that every row starting a 1s animation at once is real work
 * on a phone. Above roughly twenty rows, turn it off.
 */
export default function PlanBar({
  actual,
  plan,
  className,
  animate = true,
}: {
  /** 0..100. */
  actual: number;
  /** 0..100 — where the plan says we should be. */
  plan: number;
  className?: string;
  /** Set false inside a list that can exceed ~20 rows. */
  animate?: boolean;
}) {
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  const a = clamp(actual);
  const p = clamp(plan);

  return (
    <div className={cn('relative h-3 rounded-full bg-muted', className)}>
      {/* `animate-bar-grow` scales X from its own left edge; the WIDTH in the
          markup is already the real one, so a browser that never runs the
          animation still draws the correct bar. That is the same standard every
          entrance in this app is held to. */}
      <div
        className={cn(
          'h-full rounded-full bg-chart-1 transition-[width] duration-500 ease-ios',
          animate && 'animate-bar-grow'
        )}
        style={{ width: `${a}%` }}
      />
      {/* Taller than the track and drawn over it, so the mark stays readable
          even when the fill has already passed it.

          The clamp keeps the 2px mark inside the track at both ends. Centred on
          the plan position it hung 1px outside at 0% and at 100%, and a
          completed contract — SPK-002 in week 36 — showed a plan tick sliced in
          half at the right edge. */}
      <div
        className="absolute -top-1 h-5 w-0.5 rounded-full bg-chart-2"
        style={{ left: `clamp(0px, calc(${p}% - 1px), calc(100% - 2px))` }}
        title={`Plan ${p.toFixed(2)}%`}
      />
    </div>
  );
}
