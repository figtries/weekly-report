'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveStageWeights } from '@/lib/doc-actions';
import { STAGE_FULL, STAGE_LABEL } from '@/lib/register-shared';
import type { DocStage, RegisterKind } from '@/lib/schema';

/**
 * The three numbers every percentage in this register is computed from.
 *
 * Only the stages that carry weight are shown. A resubmission is deliberately
 * worth nothing — it is evidence of how many times a drawing went round, not
 * progress on top of the round before it — and showing those as empty boxes
 * only invites someone to fill them in.
 */
export function StageWeightsCard({
  projectId, register, weights,
}: {
  projectId: string;
  register: RegisterKind;
  weights: { stage: DocStage; weight: number }[];
}) {
  const weighted = weights.filter((w) => w.weight > 0);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(weighted.map((w) => [w.stage, String(w.weight)])),
  );
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (weighted.length === 0) return null;

  const total = Object.values(values).reduce((a, v) => a + (Number(v) || 0), 0);
  const balanced = Math.abs(total - 100) < 0.001;

  const submit = () => {
    setError(null); setSaved(false);
    start(async () => {
      const result = await saveStageWeights({
        projectId,
        register,
        weights: Object.entries(values).map(([stage, v]) => ({ stage, weight: Number(v) || 0 })),
      });
      if (!result.ok) { setError(result.error); return; }
      setSaved(true);
    });
  };

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">How much each stage is worth</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        An agreement per contract, not a law. Every percentage in this register is computed from it.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        {weighted.map((w) => (
          <div key={w.stage} className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground" htmlFor={`w-${w.stage}`}>
              <span className="font-medium text-foreground">{STAGE_LABEL[w.stage]}</span>
              {' · '}
              {STAGE_FULL[w.stage]}
            </label>
            <Input
              id={`w-${w.stage}`}
              inputMode="decimal"
              className="h-11 w-24 tabular-nums"
              value={values[w.stage] ?? ''}
              onChange={(e) => {
                setSaved(false);
                setValues((v) => ({ ...v, [w.stage]: e.target.value }));
              }}
            />
          </div>
        ))}

        <div className="flex w-full items-center gap-3 sm:ml-auto sm:w-auto">
          <span
            className={`text-sm tabular-nums ${balanced ? 'text-muted-foreground' : 'font-medium text-rose-600'}`}
          >
            total {Number(total.toFixed(2))}
            {!balanced && ' — must be 100'}
          </span>
          <Button className="ml-auto h-11" onClick={submit} disabled={pending || !balanced}>
            {pending ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="animate-fade-in-up mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-300"
        >
          {error}
        </p>
      )}
    </section>
  );
}
