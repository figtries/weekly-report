import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { blockingIds, type Finding, type ValidationResult } from '@/lib/analysis';
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

function CheckRow({ f, week }: { f: Finding; week: number }) {
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
          <ul className="mt-2.5 divide-y overflow-hidden rounded-lg bg-muted/50">
            {/* Index in the key, not the label alone: a WBS legitimately
                carries the same description under several parents ("RTS",
                "Material On Site" each appear more than once on Gundih), and
                React drops the duplicates. */}
            {f.rows.slice(0, 6).map((r, i) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.label}</span>
                    {/* The last two ancestors. Without them six rows read
                        "RTS", "Material On Site", "RTS" — the same WBS
                        description under different parents. */}
                    {r.trail && (
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {r.trail}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{r.value}</span>
                </>
              );
              return (
                <li key={`${i}-${r.label}`} className="text-[13px]">
                  {/* A row is a way INTO the item, not a description of it:
                      pressing it opens that activity's panel on Fill in, where
                      the figure is edited. The chevron is what tells a phone,
                      which has no hover, that the row can be pressed. */}
                  {r.id ? (
                    <Link
                      href={`/weekly/${week}/overall?item=${encodeURIComponent(r.id)}`}
                      className="flex min-h-11 items-center gap-3 px-3 py-2 transition-colors duration-200 ease-ios hover:bg-muted active:bg-muted"
                    >
                      {body}
                      <ChevronRight className="h-4 w-4 shrink-0 text-foreground/40" strokeWidth={2} aria-hidden="true" />
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-3 py-2">{body}</div>
                  )}
                </li>
              );
            })}
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
  handTyped,
}: {
  week: number;
  validation: ValidationResult;
  /**
   * How many of this week's standing figures trace back to a hand-typed
   * percent, out of how many real (weighted) leaves the plan has. Computed on
   * the PAGE, not here — this component only ever gets `{ week, validation }`
   * plus this, and cannot see leaf snapshots itself. Deliberately not a
   * `Finding`: those carry a level of error/warn/ok, and this is neither — a
   * report is allowed to have hand-typed figures in it, the same stance this
   * app takes toward a heading handed out at 140% of its budget. Reported,
   * never corrected.
   */
  handTyped: { count: number; total: number };
}) {
  const { findings, errors, warnings, canIssue } = validation;
  const passed = findings.filter((f) => f.level === 'ok').length;
  const blocking = blockingIds(validation).length > 0;

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
            {/* Straight to the items that block the week. Fill in opens showing
                only those, with the first one's panel already up, so closing
                it leaves the rest in front of you. The set is worked out again
                on that page from the same `validateWeek`, so the URL carries a
                word and not a list of ids. A failure with no item behind it
                (the weights not closing) has nothing to open, and then this is
                plain navigation, as it always was. */}
            <Link
              href={
                canIssue
                  ? `/weekly/${week}/summary`
                  : blocking
                    ? `/weekly/${week}/overall?lens=blocking`
                    : `/weekly/${week}/overall`
              }
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
              <CheckRow key={f.title} f={f} week={week} />
            ))}
          </ul>
        </div>
      </Reveal>

      {/* A fact, not a check: it never passes or fails, so it sits outside
          the list above rather than wearing one of that list's three colours.
          Plain neutral styling on purpose — reported, never corrected. */}
      {handTyped.total > 0 && (
        <Reveal delay={0.12}>
          <Link
            href={`/weekly/${week}/overall?lens=manual`}
            className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3.5 text-[13px] text-muted-foreground shadow-sm ring-1 ring-foreground/10 transition-colors duration-200 ease-ios hover:bg-muted/50 hover:text-foreground sm:px-5"
          >
            <span>
              <span className="font-semibold text-foreground">{handTyped.count}</span> of{' '}
              {handTyped.total} {handTyped.total === 1 ? 'figure' : 'figures'}{' '}
              {handTyped.count === 1 ? 'was' : 'were'} typed by hand
            </span>
            <span aria-hidden className="shrink-0 text-foreground/50">→</span>
          </Link>
        </Reveal>
      )}
    </div>
  );
}
