'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { m } from 'framer-motion';
import { Lock } from 'lucide-react';

import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { MOTION } from '@/lib/design';
import { lockContractAction } from '@/lib/sheet-actions';

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' });

/**
 * Lock today's plan as the contract, once. Afterwards it only says when it
 * was locked: there is no unlock in the app (revisions are board item 18).
 * Sits beside Details and matches it, so the two read as a pair.
 */
export default function LockContract({
  projectId,
  lockedAt,
  activities,
}: {
  projectId: string;
  lockedAt: string | null;
  activities: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (lockedAt) {
    return (
      <span className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground sm:h-9">
        <Lock className="size-3.5" aria-hidden />
        Contract locked {DATE.format(new Date(lockedAt.slice(0, 10) + 'T00:00:00Z'))}
      </span>
    );
  }

  return (
    <>
      <m.button
        type="button"
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.97 }}
        transition={{ duration: MOTION.duration, ease: MOTION.ease }}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors hover:bg-muted sm:h-9"
      >
        <Lock className="size-3.5" />
        Lock as contract
      </m.button>
      <ConfirmDialog
        open={open}
        title="Lock this plan as the contract?"
        destructive={false}
        confirmLabel="Lock as contract"
        busyLabel="Locking…"
        busy={pending}
        message={
          <div className="space-y-3">
            <p>
              Copies today&apos;s plan of {activities} {activities === 1 ? 'activity' : 'activities'} as the contract. The plan
              stays editable; the contract never moves.
            </p>
            <label className="block text-[12px] font-medium text-muted-foreground">
              Why is this the contract?
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border bg-card px-3 py-2 text-[13px] text-foreground"
              />
            </label>
            {error && <p className="text-[12.5px] text-bad">{error}</p>}
          </div>
        }
        onCancel={() => {
          setOpen(false);
          setError(null);
        }}
        onConfirm={() =>
          start(async () => {
            if (!reason.trim()) {
              setError('Say why this plan is the contract.');
              return;
            }
            const res = await lockContractAction(projectId, reason);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setOpen(false);
            router.refresh();
          })
        }
      />
    </>
  );
}
