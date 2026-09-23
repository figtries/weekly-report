'use client';

import { useEffect, useState, useTransition } from 'react';

import { m } from 'framer-motion';
import { createPortal } from 'react-dom';

import { pressMotion } from '@/components/motion/Press';
import { applyWeightsAction, previewWeightsAction, type WeightPreview } from '@/lib/weights-actions';

/**
 * What locking the weights would do, shown before it is done.
 *
 * This is the whole safety mechanism and it is not new: Gundih's 81
 * construction weights came from a column of the workbook that its price tree
 * does not contain, and applying a derivation over them replaces correct
 * figures with wrong ones and breaks a total that closes at exactly 100.000000.
 * So the preview names names — which rows move and by how much — rather than
 * reporting a count and asking for trust.
 *
 * The act itself is the LOCK. `syncDerivedWeights` already keeps an unlocked
 * project's weights in step with its prices on every edit, so nobody needs a
 * button to recalculate. What nobody can do without one is DECLARE the weights
 * authoritative, and that is what `weight_basis = 'boq'` means: from here on
 * the prices no longer push the weights around.
 */
export default function DeriveWeightsDialog({
  projectId,
  onClose,
  onApplied,
}: {
  projectId: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const [preview, setPreview] = useState<WeightPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, startApplying] = useTransition();

  useEffect(() => {
    let live = true;
    previewWeightsAction(projectId).then((res) => {
      if (!live) return;
      if (res.ok) setPreview(res);
      else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [projectId]);

  function apply() {
    setError(null);
    startApplying(async () => {
      const res = await applyWeightsAction(projectId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onApplied();
    });
  }

  const covers = preview ? preview.covers === preview.leaves : false;

  // Portalled to body for the same reason as MeasurePanel: under the
  // workbench's transformed ancestor, `fixed` means that box, not the screen.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-6">
      <div className="animate-enter max-h-[90vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-background p-5 shadow-xl sm:rounded-2xl">
        <h2 className="text-lg font-semibold">Lock these weights</h2>

        {!preview && !error && (
          <p className="mt-2 text-sm text-muted-foreground">Working out what would change…</p>
        )}

        {preview && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Prices reach{' '}
              <strong className="tabular-nums text-foreground">
                {preview.covers} of {preview.leaves}
              </strong>{' '}
              activities. Stored weights total{' '}
              <strong className="tabular-nums text-foreground">
                {preview.storedTotal.toFixed(2)}%
              </strong>
              , derived from prices they would total{' '}
              <strong className="tabular-nums text-foreground">
                {preview.derivedTotal.toFixed(2)}%
              </strong>
              .
            </p>

            {!covers && (
              <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                Not every activity has a price yet, so this plan cannot be called value based. The
                weights still follow the prices you have entered; the rest keep an even share.
              </p>
            )}

            {preview.changes === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing would move. The stored weights already match the prices.
              </p>
            ) : (
              <>
                <p className="mt-4 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {preview.changes} rows would move, largest first
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {preview.biggest.map((b) => (
                    <li
                      key={b.code}
                      className="flex items-baseline justify-between gap-3 rounded-lg bg-card px-3 py-1.5 text-sm ring-1 ring-foreground/10"
                    >
                      <span className="min-w-0 truncate">
                        {b.code} {b.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {b.before?.toFixed(2) ?? '0.00'} to{' '}
                        <strong className="text-foreground">{b.after?.toFixed(2) ?? '0.00'}</strong>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {error && (
          <p className="animate-fade-in-up mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <m.button
            {...pressMotion}
            onClick={onClose}
            className="min-h-11 rounded-lg px-4 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </m.button>
          <m.button
            {...pressMotion}
            onClick={apply}
            disabled={applying || !preview}
            className="min-h-11 rounded-lg bg-chart-1 px-5 text-sm font-medium text-white disabled:opacity-70"
          >
            {applying ? 'Locking…' : covers ? 'Lock as value based' : 'Apply anyway'}
          </m.button>
        </div>
      </div>
    </div>,
    document.body
  );
}
