import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, CircleAlert } from 'lucide-react';

import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PlanActualBar from '@/components/ui/PlanActualBar';
import type { PriorityAction, PriorityActions, PriorityLevel } from '@/lib/priority-actions';
import { TYPE } from '@/lib/design';
import { cn } from '@/lib/utils';

/**
 * PRIORITY ACTIONS: what has to be done in the next three weeks.
 *
 * One full-width card in place of "What is urgent" and "What has to happen
 * next" (27 Sep 2026, variant A of three rendered for him). The rule is
 * `lib/priority-actions.ts`; this only draws it.
 *
 * Three things here are decisions, not taste. THE PILL SAYS WHY AND ITS COLOUR
 * SAYS HOW URGENT: "Late 2 wk", "Finish W38", "Catch up", "Start W39" as in
 * variant A, in three colours only, red for P1, amber for P2, blue for P3. The
 * first build printed "P1".."P3" in the pill with the reason underneath; he
 * wanted A's words back and the priority carried by the colour. EVERY PILL IS
 * THE SAME SIZE whatever it says, so the column reads as a column. The week's
 * checks are ONE PILL that opens Control: the warnings they used to list
 * ("100% of values are multiples of 5") read the same every week and were
 * never urgent; the full list is still one press away. And the rows past five
 * open in place through a native `<details>`, so the card needs no client
 * JavaScript at all.
 */

/** Rows shown before "Show all". */
const ROWS = 5;

const LEVEL_TONE: Record<PriorityLevel, string> = {
  1: 'bg-bad-soft text-bad',
  2: 'bg-warn-soft text-warn',
  // Primary rather than chart-1 for the text: chart-1 on its own 10% tint is
  // too faint for the 12px label, and this app is read by people up to 60.
  3: 'bg-chart-1/10 text-primary',
};

/** The pill's words. Every one fits the fixed pill, "Late 104 wk" included. */
function labelOf(a: PriorityAction): string {
  switch (a.kind) {
    case 'late':
      return `Late ${a.weeksLate} wk`;
    case 'finish':
      return `Finish W${a.week}`;
    case 'behind':
      return a.nowPct === 0 ? 'Not started' : 'Catch up';
    case 'start':
      return `Start W${a.week}`;
  }
}

function Row({ a }: { a: PriorityAction }) {
  // Where it sits, so two rows of the same name can be told apart: the
  // heading, or on a flat plan with no headings the WBS code. A finish in red
  // says why it is red, so the colour is never the only thing saying it.
  const where = a.section ?? (a.node.wbsCode ? `WBS ${a.node.wbsCode}` : null);
  const meta = [a.kind === 'finish' && a.behind ? 'Behind plan' : null, where].filter(Boolean).join(' · ');
  return (
    // Phone: pill + name on one line, the bar and figures across the row
    // under them. From sm up the wrapper dissolves (`sm:contents`) and all
    // four sit on one grid line, so every bar and figure share a column.
    <li className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 sm:grid-cols-[6.5rem_minmax(0,1fr)_minmax(10rem,16rem)_5.5rem] sm:gap-x-4">
      <span
        className={cn(
          'flex h-7 w-26 items-center justify-center rounded-lg text-xs font-semibold tabular-nums whitespace-nowrap',
          LEVEL_TONE[a.level]
        )}
      >
        <span className="sr-only">Priority {a.level}: </span>
        {labelOf(a)}
      </span>
      <div className="min-w-0">
        <p className={cn('truncate', TYPE.row)}>{a.node.deskripsi}</p>
        {meta && <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      <div className="col-span-2 flex items-center gap-3 sm:col-span-1 sm:contents">
        <PlanActualBar actual={a.nowPct} plan={a.targetPct} />
        <span className="w-22 shrink-0 text-right text-sm font-semibold tabular-nums whitespace-nowrap">
          {a.nowPct} → {a.targetPct}%
        </span>
      </div>
    </li>
  );
}

export default function PriorityActionsCard({
  pa,
  week,
  canIssue,
  errors,
  warnings,
  plannerHref,
}: {
  pa: PriorityActions;
  week: number;
  canIssue: boolean;
  errors: number;
  warnings: number;
  plannerHref: string;
}) {
  const { actions, horizonWeek, next } = pa;
  const shown = actions.slice(0, ROWS);
  const rest = actions.slice(ROWS);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className={TYPE.cardTitle}>Priority Actions</CardTitle>
        {/* The week's checks, as one pill. Ready is green whatever the number
            of notes; only an error turns it red, because only an error stops
            the week going out. The link is 44px tall around a 32px pill. */}
        <CardAction className="flex h-6 items-center">
          <Link
            href={`/weekly/${week}/control`}
            className="-my-2.5 inline-flex min-h-11 items-center"
          >
            <span
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-[filter] duration-300 ease-ios hover:brightness-95',
                canIssue ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad'
              )}
            >
              {canIssue ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <CircleAlert className="h-3.5 w-3.5" aria-hidden />
              )}
              {/* One text run, so the flex gap never lands before the dot. */}
              <span>
                {canIssue ? (
                  <>
                    Ready<span className="hidden sm:inline"> to issue</span>
                  </>
                ) : (
                  'Not ready'
                )}
                {!canIssue ? (
                  <span className="font-medium">
                    {' '}· {errors} {errors === 1 ? 'error' : 'errors'}
                  </span>
                ) : (
                  warnings > 0 && (
                    <span className="font-medium">
                      {' '}· {warnings} {warnings === 1 ? 'note' : 'notes'}
                    </span>
                  )
                )}
              </span>
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </span>
          </Link>
        </CardAction>
      </CardHeader>

      <CardContent>
        {!pa.hasSchedule ? (
          <div>
            <p className={TYPE.figure}>No schedule yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Priorities come from each activity&apos;s dates.{' '}
              <Link href={plannerHref} className="font-medium text-primary hover:underline">
                Open the planner
              </Link>
            </p>
          </div>
        ) : actions.length === 0 ? (
          <div>
            <p className={TYPE.figure}>Nothing due by W{horizonWeek}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {next ? (
                <>
                  Next up: <span className="font-semibold text-foreground">{next.node.deskripsi}</span>{' '}
                  {next.kind === 'start' ? 'starts' : 'finishes'} W{next.week}
                </>
              ) : (
                'Every activity is finished.'
              )}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-5 flex flex-wrap items-baseline gap-x-2">
              <span className={TYPE.figure}>
                {actions.length} {actions.length === 1 ? 'activity' : 'activities'}
              </span>
              <span className="text-sm text-muted-foreground">
                {actions.length === 1 ? 'needs' : 'need'} action by W{horizonWeek}
              </span>
            </p>
            <ul className="flex flex-col gap-5">
              {shown.map((a) => (
                <Row key={a.node.id} a={a} />
              ))}
            </ul>
            {rest.length > 0 && (
              // One way only: opened, the button goes and the list simply runs
              // on. A "Show fewer" can only sit ABOVE the rows it would hide
              // (a summary is always a <details>'s first child), which read as
              // the list ending in the middle.
              <details className="group mt-5">
                <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-semibold text-primary group-open:hidden [&::-webkit-details-marker]:hidden">
                  Show all {actions.length}
                  <ChevronDown className="h-4 w-4" aria-hidden />
                </summary>
                <ul className="flex flex-col gap-5">
                  {rest.map((a) => (
                    <Row key={a.node.id} a={a} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
