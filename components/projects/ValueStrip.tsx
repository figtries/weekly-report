'use client';

import { useState, useTransition } from 'react';
import { m } from 'framer-motion';
import { Calculator, TriangleAlert } from 'lucide-react';

import type { WeightSummary } from '@/lib/weights';
import { applyWeightsAction, previewWeightsAction, type WeightPreview } from '@/lib/weights-actions';

/**
 * The money, said out loud.
 *
 * `bobot = line value ÷ contract value × 100` is what every reported percentage
 * in this app is built from, and until now it was invisible — the contract
 * figure lived in a column nobody could trace and the weights were simply there.
 * A number nobody can trace is a number nobody trusts, so this strip says where
 * the contract came from ("4 reporting units"), what the weights add up to, and
 * how much of the plan the prices actually reach.
 *
 * The Recalculate button always shows its damage first. Deriving weights over an
 * imported project would move 121 of Gundih's 218 rows, because its construction
 * weights came from the workbook rather than from money — see lib/weights.ts.
 */
export default function ValueStrip({
  summary,
  projectId,
}: {
  summary: WeightSummary;
  projectId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<WeightPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const money = (v: number) => {
    try {
      return new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency: summary.currency,
        maximumFractionDigits: 0,
      }).format(v);
    } catch {
      return `${summary.currency} ${Math.round(v).toLocaleString('en-GB')}`;
    }
  };

  const closes = Math.abs(summary.storedTotal - 100) < 0.005;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 text-[11px] sm:px-6">
        <span className="flex items-baseline gap-1.5">
          <span className="uppercase tracking-wider text-muted-foreground">Contract</span>
          <strong className="text-sm font-semibold tabular-nums">
            {summary.contractValue > 0 ? money(summary.contractValue) : '—'}
          </strong>
          <span className="text-muted-foreground">from {summary.source}</span>
        </span>

        <span className="flex items-baseline gap-1.5">
          <span className="uppercase tracking-wider text-muted-foreground">Weights</span>
          <strong className={`tabular-nums ${closes ? '' : 'text-warn'}`}>
            {summary.storedTotal.toFixed(2)}%
          </strong>
          <span className="text-muted-foreground">
            across {summary.storedLeaves} of {summary.leaves} rows
          </span>
          {!closes && (
            <span className="flex items-center gap-1 text-warn">
              <TriangleAlert className="size-3" />
              does not close at 100
            </span>
          )}
        </span>

        <span className="text-muted-foreground">
          {summary.pricedRows > 0
            ? `${summary.pricedRows} priced rows`
            : 'no prices — weights would be spread evenly'}
        </span>

        <m.button
          type="button"
          whileTap={{ scale: 0.97 }}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await previewWeightsAction(projectId);
              if (!res.ok) {
                setError(res.error);
                return;
              }
              setPreview(res);
            })
          }
          className="ml-auto flex h-9 items-center gap-1.5 rounded-lg border px-2.5 font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Calculator className="size-3.5" />
          Recalculate from prices…
        </m.button>
      </div>

      {error && <p className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

      {preview && (
        <PreviewDialog
          preview={preview}
          money={money}
          projectId={projectId}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}

function PreviewDialog({
  preview: p,
  money,
  projectId,
  onClose,
}: {
  preview: WeightPreview;
  money: (v: number) => string;
  projectId: string;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const heavy = p.changes > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
      onClick={onClose}
    >
      <m.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="max-h-[85vh] w-full overflow-auto rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold">Recalculate weights from prices</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Weight is <strong className="text-foreground">line value ÷ contract value × 100</strong>. A
          price on a branch is the value of everything under it; rows without one take a share of
          what is left of their parent.
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Fact label="Contract" value={money(p.contractValue)} />
          <Fact label="Prices reach" value={`${p.covers} of ${p.leaves} rows`} />
          <Fact label="Weights now" value={`${p.storedTotal.toFixed(2)}%`} />
          <Fact
            label="Would become"
            value={`${p.derivedTotal.toFixed(2)}%`}
            bad={Math.abs(p.derivedTotal - 100) > 0.5}
          />
        </dl>

        {heavy && (
          <div className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-warn">
              <TriangleAlert className="size-3.5" />
              {p.changes} of {p.leaves} rows would change
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {p.basis === 'boq'
                ? 'The prices cover the whole plan, so the new weights close at 100.'
                : 'The prices do not cover the whole plan. Some of these weights were entered from a source this calculation cannot see — replacing them would lose them.'}
            </p>
            <ul className="mt-2 space-y-0.5">
              {p.biggest.map((b) => (
                <li key={b.code} className="flex items-center gap-2 text-[11px] tabular-nums">
                  <span className="w-20 shrink-0 text-muted-foreground">{b.code}</span>
                  <span className="truncate">{b.name}</span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {b.before?.toFixed(3) ?? '—'} → {b.after?.toFixed(3) ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await applyWeightsAction(projectId);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                onClose();
              })
            }
            className="h-11 flex-1 rounded-lg bg-foreground text-sm font-medium text-background disabled:opacity-50"
          >
            {pending ? 'Applying…' : `Replace ${p.changes} weights`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      </m.div>
    </div>
  );
}

function Fact({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded-lg border p-2">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold tabular-nums ${bad ? 'text-warn' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
