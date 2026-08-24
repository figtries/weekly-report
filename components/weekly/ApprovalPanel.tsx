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
      <h2 className="text-sm font-semibold">Persetujuan minggu {week}</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Gerbang di samping memutuskan angkanya <em>boleh</em> terbit. Ini mencatat bahwa ada orang
        yang berdiri di belakangnya.
      </p>

      {approval ? (
        <div className="space-y-3">
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
            <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              Disetujui oleh {approval.by}
            </div>
            <div className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-400/80">
              {approval.role} ·{' '}
              {new Date(approval.at).toLocaleString('id-ID', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}{' '}
              · pada {fmtPct(approval.approvedPct)}
            </div>
            {approval.note && (
              <p className="mt-1.5 text-xs italic text-emerald-700/80 dark:text-emerald-400/80">
                “{approval.note}”
              </p>
            )}
          </div>

          {drifted && (
            <p className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Angka berubah <strong className="tabular-nums">{fmtPct(Math.abs(drift))}</strong>{' '}
              {drift > 0 ? 'naik' : 'turun'} sejak disetujui — persetujuan ini menyangkut{' '}
              {fmtPct(approval.approvedPct)}, bukan {fmtPct(currentPct)}. Setujui ulang bila
              perubahannya memang dimaksudkan.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={approve} disabled={pending || !by.trim()}>
              Setujui ulang pada {fmtPct(currentPct)}
            </Button>
            <Button size="sm" variant="ghost" onClick={revoke} disabled={pending}>
              Cabut
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {blocked && (
            <p className="rounded-md border border-dashed border-destructive/50 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Masih ada temuan yang menahan penerbitan. Kamu tetap bisa menyetujui, tapi
              persetujuan itu akan tercatat di atas data yang belum bersih.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={by}
              onChange={(e) => setBy(e.target.value)}
              placeholder="Nama penyetuju"
              className="text-sm"
            />
            <Input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Jabatan"
              className="text-sm"
            />
          </div>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan (opsional)"
            className="text-sm"
          />
          <Button size="sm" onClick={approve} disabled={pending || !by.trim()}>
            {pending ? 'Menyimpan…' : `Setujui pada ${fmtPct(currentPct)}`}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
