'use client';

import { useState, useTransition } from 'react';
import { approveWeekAction, revokeApprovalAction } from '@/lib/actions';
import { fmtPct } from '@/lib/analysis';
import type { Approval } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Sign-off for a reporting week.
 *
 * The gate above this decides whether the numbers *may* be issued; this records
 * that someone actually stood behind them. Those are different questions, and
 * collapsing them is how an approval ends up meaning "the software allowed it".
 *
 * A week approved at one figure and then edited shows the drift rather than
 * hiding it — an approval that silently follows the number it approved is worth
 * nothing in a dispute.
 */
export default function ApprovalPanel({
  week,
  currentPct,
  approval,
  blocked,
}: {
  week: number;
  currentPct: number;
  approval: Approval | null;
  blocked: boolean;
}) {
  const [by, setBy] = useState(approval?.by ?? '');
  const [role, setRole] = useState(approval?.role ?? 'Project Manager');
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const drift = approval ? currentPct - approval.approvedPct : 0;
  const drifted = approval && Math.abs(drift) > 0.005;

  function approve() {
    setError(null);
    startTransition(async () => {
      const res = await approveWeekAction(week, by, role, currentPct, note);
      if (!res.ok) setError(res.error);
      else setNote('');
    });
  }

  function revoke() {
    setError(null);
    startTransition(async () => {
      const res = await revokeApprovalAction(week);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <section
      className="animate-fade-in-up rounded-lg border bg-card p-4 sm:p-5"
      style={{ animationDelay: '300ms' }}
    >
      <h2 className="text-sm font-semibold">Week {week} approval</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        The gate beside this decides whether the figure <em>may</em> be issued. This records that
        a person stands behind it.
      </p>

      {approval ? (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
            <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Approved by {approval.by}
            </div>
            <div className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-400/80">
              {approval.role} ·{' '}
              {new Date(approval.at).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              · at {fmtPct(approval.approvedPct)}
            </div>
            {approval.note && (
              <p className="mt-1.5 text-xs italic text-emerald-700/80 dark:text-emerald-400/80">
                “{approval.note}”
              </p>
            )}
          </div>

          {drifted && (
            <p className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              The figure moved <strong className="tabular-nums">{fmtPct(Math.abs(drift))}</strong>{' '}
              {drift > 0 ? 'up' : 'down'} since it was approved — this approval covers{' '}
              {fmtPct(approval.approvedPct)}, not {fmtPct(currentPct)}. Approve again if the change
              was intended.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={approve} disabled={pending || !by.trim()}>
              Approve again at {fmtPct(currentPct)}
            </Button>
            <Button size="sm" variant="ghost" onClick={revoke} disabled={pending}>
              Revoke
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {blocked && (
            <p className="rounded-md border border-dashed border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Findings are still holding the report back. You can approve anyway, but the
              approval will be recorded on top of data that is not clean.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={by}
              onChange={(e) => setBy(e.target.value)}
              placeholder="Approver name"
              className="text-sm"
            />
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Role"
              className="text-sm"
            />
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="text-sm"
          />
          <Button size="sm" onClick={approve} disabled={pending || !by.trim()}>
            {pending ? 'Saving…' : `Approve at ${fmtPct(currentPct)}`}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
