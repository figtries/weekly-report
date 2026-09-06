'use client';

import { useTransition } from 'react';
import { m } from 'framer-motion';
import { ArrowRight, CalendarClock, CheckCircle2, TriangleAlert } from 'lucide-react';

import { MOTION } from '@/lib/design';
import type { ShiftPreview as Shift, WeekSpan } from '@/lib/chains';
import { weeksTouched } from '@/lib/chains';
import { shiftFollowersAction } from '@/lib/sheet-actions';

/**
 * What else this date change does, said after the fact rather than before it.
 *
 * Decision ④: **the sheet never refuses an edit.** Schedules change because the
 * site changes, and a tool that argues gets abandoned for Excel, which is how
 * these plans end up living in a workbook nobody can report from. So the date
 * lands first. Then this appears, with the two things the person could not have
 * known:
 *
 * **What follows it.** The chain is inferred from the dates — see
 * `lib/chains.ts` — so a row that had work queued behind it can drag that work
 * along, keeping every gap exactly as it was. It is offered, never done: the
 * chain is a guess, and a guess does not get to move twelve rows on its own.
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
  onApplied: () => void;
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
      className="shrink-0 border-b bg-muted/60 px-3 py-2 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex items-center gap-1.5 text-xs">
          <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
          <strong className="max-w-[14rem] truncate font-medium">{rowName}</strong>
          <span className="tabular-nums text-muted-foreground">
            moved {delta > 0 ? `${delta} days later` : `${Math.abs(delta)} days earlier`}
          </span>
        </span>

        {touched.all.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowRight className="size-3.5 shrink-0" aria-hidden />
            changes the plan curve for {weekList(touched.all)}
            {reported.length > 0 && (
              <span className="flex items-center gap-1 rounded bg-warn/10 px-1.5 py-px font-medium text-warn">
                <TriangleAlert className="size-3" />
                {weekList(reported)} already{' '}
                {reported.every((w) => w.status === 'approved') ? 'approved' : 'reported'} — the
                deviation will show
              </span>
            )}
          </span>
        )}

        {hasFollowers && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              <strong className="tabular-nums text-foreground">{shift.followers.length}</strong>{' '}
              {shift.followers.length === 1 ? 'row follows' : 'rows follow'} it —{' '}
              <span className="truncate">
                {shift.followers
                  .slice(0, 3)
                  .map((f) => f.name)
                  .join(' → ')}
                {shift.followers.length > 3 ? ' → …' : ''}
              </span>
            </span>
            <m.button
              type="button"
              whileTap={{ scale: 0.97 }}
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await shiftFollowersAction(projectId, rowId, delta);
                  if (res.ok) onApplied();
                })
              }
              className="flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background disabled:opacity-50"
            >
              <CheckCircle2 className="size-3.5" />
              {pending ? 'Moving…' : 'Move them too'}
            </m.button>
            <button
              type="button"
              onClick={onDismiss}
              className="h-9 rounded-lg px-3 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              Leave them
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
