'use client';

import { useTransition } from 'react';
import { m } from 'framer-motion';
import { ArrowRight, CalendarClock, CheckCircle2, TriangleAlert } from 'lucide-react';

import { MOTION } from '@/lib/design';
import type { ShiftPreview as Shift, WeekSpan } from '@/lib/chains';
import { weeksTouched } from '@/lib/chains';
import { moveFollowersAction } from '@/lib/sheet-actions';
import type { Sheet } from '@/lib/sheet';

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * What else this date change does, said after the fact rather than before it.
 *
 * Decision ④: **the sheet never refuses an edit.** Schedules change because the
 * site changes, and a tool that argues gets abandoned for Excel, which is how
 * these plans end up living in a workbook nobody can report from. So the date
 * lands first. Then this appears, with the two things the person could not have
 * known:
 *
 * **What it pushes.** Links are stored now (lib/links.ts, made in Projects),
 * so a row that moved can push what waits for it past the link. The offer
 * moves each follower by the smallest amount that clears its link, durations
 * kept; it is offered, never done. "Keep dates" leaves the conflict visible
 * in the strip over the planner and on the Gantt.
 *
 * **Which weeks it moves.** The plan curve is derived from these dates, so
 * shifting one today changes the planned figure for a week that was approved
 * last month. That is not hidden and not prevented — the deviation becoming
 * visible is the point, and it is the same rule the approval panel already
 * follows: a signature that silently follows the number it signed is worth
 * nothing in a dispute.
 */
export default function ShiftPreviewBar({
  projectId,
  rowId,
  rowName,
  shift,
  weeks,
  onApplied,
  onDismiss,
}: {
  projectId: string;
  rowId: string;
  rowName: string;
  shift: Shift;
  weeks: WeekSpan[];
  onApplied: (sheet: Sheet) => void;
  onDismiss: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const delta = shift.moved[0]?.days ?? 0;

  // The weeks of what HAS happened — this row's own span, before and after.
  // Not the whole chain's: the followers have not moved yet, and naming their
  // weeks would report a change nobody has agreed to. Take the offer below and
  // the page reloads with the wider span already true.
  const self = shift.moved[0];
  const lo = self ? (self.fromStart < self.toStart ? self.fromStart : self.toStart) : null;
  const hi = self ? (self.fromFinish > self.toFinish ? self.fromFinish : self.toFinish) : null;
  const touched = weeksTouched(weeks, lo, hi);
  const reported = touched.reported;
  const hasFollowers = shift.followers.length > 0;

  if (!hasFollowers && touched.all.length === 0) return null;

  const weekList = (list: WeekSpan[]) => {
    if (list.length === 0) return '';
    const nos = list.map((w) => w.weekNo);
    const first = nos[0];
    const last = nos[nos.length - 1];
    return first === last ? `week ${first}` : `weeks ${first}–${last}`;
  };

  return (
    <m.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: MOTION.duration, ease: MOTION.ease }}
      className="shrink-0 border-b bg-muted/60 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs">
          <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
          <strong className="max-w-[14rem] truncate font-medium">{rowName}</strong>
          {self && (
            <span className="tabular-nums text-muted-foreground">
              {delta === 0
                ? `now finishes ${SHORT.format(new Date(self.toFinish + 'T00:00:00Z'))}`
                : `moved ${delta > 0 ? `${delta} days later` : `${Math.abs(delta)} days earlier`}`}
            </span>
          )}
        </span>

        {touched.all.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            changes the plan curve for {weekList(touched.all)}
            {reported.length > 0 && (
              <span className="flex items-center gap-1 rounded bg-warn/10 px-1.5 py-px font-medium text-warn">
                <TriangleAlert className="size-3" />
                {weekList(reported)} already{' '}
                {reported.every((w) => w.status === 'approved') ? 'approved' : 'reported'}, so the
                deviation will show
              </span>
            )}
          </span>
        )}

        {hasFollowers && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              <strong className="text-foreground">{shift.followers[0].name}</strong>
              {shift.followers.length > 1 ? ` and ${shift.followers.length - 1} after it` : ''} now{' '}
              {shift.followers.length === 1 ? 'starts before what it waits for.' : 'start before what they wait for.'}
            </span>
            <m.button
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await moveFollowersAction(projectId, shift.fromIds ?? [rowId]);
                  if (res.ok) onApplied(res.sheet);
                })
              }
              className="btn-primary flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
            >
              <CheckCircle2 className="size-3.5" />
              {pending ? 'Moving…' : `Move ${shift.followers.length} ${shift.followers.length === 1 ? 'row' : 'rows'}`}
            </m.button>
            <button
              type="button"
              onClick={onDismiss}
              className="h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Keep dates
            </button>
          </span>
        )}

        {!hasFollowers && (
          <button
            type="button"
            onClick={onDismiss}
            className="ml-auto h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            Got it
          </button>
        )}
      </div>
    </m.div>
  );
}
