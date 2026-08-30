'use client';

import { useState, useTransition } from 'react';

import { Expand } from '@/components/motion/Expand';
import { approveWeekAction, revokeApprovalAction } from '@/lib/actions';
import { fmtPct } from '@/lib/analysis';
import type { Approval } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TYPE } from '@/lib/design';

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
    <Card>
      <CardHeader>
        <CardTitle className={TYPE.cardTitle}>Week {week} approval</CardTitle>
        <CardDescription className={TYPE.cardDesc}>
          The gate beside this decides whether the figure <em>may</em> be issued. This records that
          a person stands behind it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {approval ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-ok-soft p-3">
            <div className="text-sm font-semibold text-ok">
              Approved by {approval.by}
            </div>
            <div className="mt-0.5 text-xs text-ok/85">
              {approval.role} ·{' '}
              {new Date(approval.at).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              · at {fmtPct(approval.approvedPct)}
            </div>
            {approval.note && (
              <p className="mt-1.5 text-xs italic text-ok/85">
                “{approval.note}”
              </p>
            )}
          </div>

          {/* The drift notice is the one that most needed the movement: it
              appears when a week someone already signed is edited underneath
              them, and a warning that pops in without travel reads as a page
              glitch rather than as something that just became true. */}
          <Expand open={!!drifted}>
            <p className="rounded-xl bg-warn-soft px-3 py-2.5 text-xs text-warn">
              The figure moved <strong className="tabular-nums">{fmtPct(Math.abs(drift))}</strong>{' '}
              {drift > 0 ? 'up' : 'down'} since it was approved — this approval covers{' '}
              {fmtPct(approval.approvedPct)}, not {fmtPct(currentPct)}. Approve again if the change
              was intended.
            </p>
          </Expand>

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
          <Expand open={blocked}>
            <p className="rounded-xl bg-bad-soft px-3 py-2.5 text-xs font-medium text-bad">
              Findings are still holding the report back. You can approve anyway, but the
              approval will be recorded on top of data that is not clean.
            </p>
          </Expand>
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
          {/* The button greys out until a name is typed, and used to give no
              reason for it — a dead control next to a red warning reads as "the
              findings have locked me out", which is the opposite of true: the
              findings never block approval, only an unsigned name does. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Button size="sm" onClick={approve} disabled={pending || !by.trim()}>
              {pending ? 'Saving…' : `Approve at ${fmtPct(currentPct)}`}
            </Button>
            {!by.trim() && !pending && (
              <span className="text-xs text-muted-foreground">
                Type your name above to approve.
              </span>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}
