import Link from 'next/link';
import type { Finding, ValidationResult } from '@/lib/analysis';
import { Reveal } from '@/components/motion/Reveal';
import { cn } from '@/lib/utils';

/**
 * The verdict on a week, and the list of things that produced it.
 *
 * This screen used to be six stat cards, a contract-value field, a narrative,
 * a look-ahead, a laggard table and — tucked into the bottom right, the same
 * size as everything else — the checks. The one question the screen exists to
 * answer ("can this week be issued?") was the least prominent thing on it, and
 * the checks themselves were invisible until one failed, so nobody could say
 * what was being checked. It read as a wall of numbers with no point.
 *
 * So: the verdict is first and it is the biggest thing here, and EVERY check is
 * listed whether it passed or not. A list that only appears when something is
 * wrong teaches nobody what the app is looking at.
 */

const STYLE: Record<
  Finding['level'],
  { ring: string; icon: string; mark: string; label: string }
> = {
  error: { ring: 'ring-bad/25', icon: 'bg-bad text-white', mark: '!', label: 'text-bad' },
  warn: { ring: 'ring-warn/25', icon: 'bg-warn text-white', mark: '!', label: 'text-warn' },
  ok: { ring: 'ring-foreground/10', icon: 'bg-ok text-white', mark: '✓', label: 'text-ok' },
};

function CheckRow({ f }: { f: Finding }) {
  const s = STYLE[f.level];
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-bold leading-none',
          s.icon
        )}
        aria-hidden
      >
        {s.mark}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cn('text-[14px] font-semibold', f.level === 'ok' ? 'text-foreground' : s.label)}>
          {f.title}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{f.detail}</p>

        {/* The offending rows, listed rather than described. A failing check
            whose evidence is three names glued into a sentence cannot be
            scanned, and the person then has to go hunting for the other three. */}
        {f.rows && f.rows.length > 0 && (
          <ul className="mt-2.5 divide-y rounded-lg bg-muted/50">
            {/* Index in the key, not the label alone: a WBS legitimately
                carries the same description under several parents ("RTS",
                "Material On Site" each appear more than once on Gundih), and
                React drops the duplicates. */}
            {f.rows.slice(0, 6).map((r, i) => (
              <li
                key={`${i}-${r.label}`}
                className="flex items-start justify-between gap-3 px-3 py-2 text-[13px]"
              >
                <span className="min-w-0">
                  <span className="block truncate">{r.label}</span>
                  {/* The last two ancestors. Without them six rows read
                      "RTS", "Material On Site", "RTS" — the same WBS
                      description under different parents — and the person is
                      sent to the Update screen with nothing to search for. */}
                  {r.trail && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {r.trail}
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{r.value}</span>
              </li>
            ))}
            {f.rows.length > 6 && (
              <li className="px-3 py-2 text-[12px] text-muted-foreground">
                and {f.rows.length - 6} more
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  );
}

export default function WeekChecks({
  week,
  validation,
}: {
  week: number;
  validation: ValidationResult;
}) {
  const { findings, errors, warnings, canIssue } = validation;
  const passed = findings.filter((f) => f.level === 'ok').length;

  // Worst first. Someone opening this screen wants the thing that stops them,
  // not a list in the order the code happened to run its checks.
  const order: Record<Finding['level'], number> = { error: 0, warn: 1, ok: 2 };
  const sorted = [...findings].sort((a, b) => order[a.level] - order[b.level]);

  return (
    <div className="space-y-4">
      <Reveal>
        <div
          className={cn(
            'rounded-2xl px-4 py-4 ring-1 sm:px-6 sm:py-5',
            canIssue ? 'bg-ok-soft ring-ok/25' : 'bg-bad-soft ring-bad/25'
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[17px] font-bold leading-none text-white',
                  canIssue ? 'bg-ok' : 'bg-bad'
                )}
                aria-hidden
              >
                {canIssue ? '✓' : '!'}
              </span>
              <div className="min-w-0">
                <p className={cn('text-lg font-semibold sm:text-xl', canIssue ? 'text-ok' : 'text-bad')}>
                  {canIssue
                    ? `Week ${week} is ready to issue`
                    : `Week ${week} is not ready to issue`}
                </p>
                <p className="mt-0.5 text-[13px] text-foreground/70">
                  {canIssue
                    ? warnings > 0
                      ? `Nothing blocks it. ${warnings} ${warnings === 1 ? 'thing is' : 'things are'} worth a look first.`
                      : 'All checks passed.'
                    : `${errors} ${errors === 1 ? 'thing has' : 'things have'} to be fixed before this week can be printed.`}
                </p>
              </div>
            </div>
            {/* Plain navigation, not "fix these": the queue on that screen
                lists what is DUE this week, and a failing item is not
                necessarily due — promising a jump straight to it would be a
                promise this button cannot keep. The names are listed below so
                they can be searched there. */}
            <Link
              href={`/weekly/${week}/${canIssue ? 'summary' : 'overall'}`}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center rounded-xl px-4 text-[14px] font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.97]',
                canIssue ? 'bg-ok' : 'bg-bad'
              )}
            >
              {canIssue ? 'Go to the report →' : 'Back to Fill in →'}
            </Link>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.06}>
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3.5 sm:px-5">
            <h2 className="text-[15px] font-semibold">What the app checked</h2>
            <p className="text-[12px] tabular-nums text-muted-foreground">
              {passed} passed
              {errors > 0 && <> · <span className="font-semibold text-bad">{errors} failed</span></>}
              {warnings > 0 && <> · <span className="font-semibold text-warn">{warnings} to look at</span></>}
            </p>
          </div>
          <ul className="divide-y">
            {sorted.map((f) => (
              <CheckRow key={f.title} f={f} />
            ))}
          </ul>
        </div>
      </Reveal>
    </div>
  );
}
