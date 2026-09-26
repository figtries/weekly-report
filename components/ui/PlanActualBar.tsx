import { cn } from '@/lib/utils';

/**
 * ACTUAL OVER PLAN, AS TWO BARS ON ONE SCALE (26 Sep 2026).
 *
 * Plan used to be a red tick standing on the blue bar. At a plan of 0% the tick
 * sat glued to the bar's start and read as a stray mark — "garis merahnya
 * kenapa? kok nggak masuk?" — and nothing on screen said the tick was the plan
 * except a grey caption. Now the plan is a bar of its own under the actual one,
 * the same way the S-curve draws two lines: blue is how far it got, red is how
 * far it was meant to be. A plan of 0% is an empty red track, which reads as
 * "nothing planned yet" instead of as a glitch.
 *
 * Every screen that compares actual with plan on a bar uses this, so the pair
 * looks the same everywhere (dashboard lists, sidebar card, Data Overall,
 * Summary, the week log). Draws no text: the caption beside it is the owner's.
 */
export default function PlanActualBar({
  actual,
  plan,
  size = 'md',
  className,
}: {
  actual: number;
  plan: number;
  /** `sm` for the sidebar card and dense rows; `md` everywhere else. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-[3px]', className)} aria-hidden>
      <div className={cn('overflow-hidden rounded-full bg-muted', size === 'sm' ? 'h-1.5' : 'h-2')}>
        <div
          className="h-full animate-bar-grow rounded-full bg-chart-1"
          style={{ width: `${clamp(actual)}%` }}
        />
      </div>
      <div className={cn('overflow-hidden rounded-full bg-muted', size === 'sm' ? 'h-1' : 'h-[5px]')}>
        <div
          className="h-full animate-bar-grow rounded-full bg-chart-2"
          style={{ width: `${clamp(plan)}%` }}
        />
      </div>
    </div>
  );
}

function clamp(n: number) {
  return Math.max(0, Math.min(100, n));
}
