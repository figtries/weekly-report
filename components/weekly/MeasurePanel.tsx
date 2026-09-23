'use client';

import { useState, useTransition } from 'react';

import { m } from 'framer-motion';
import { createPortal } from 'react-dom';

import { pressMotion } from '@/components/motion/Press';
import { setProgressMethodAction } from '@/lib/actions';
import type { Milestone } from '@/lib/types';
import type { WeightsRow } from '@/lib/weights-screen';
import { cn } from '@/lib/utils';

/**
 * How one activity will be measured, decided once.
 *
 * This is the answer to the question the workbook could not answer. In
 * `W31 (Overall)` the ACTUAL block is 176 rows by 60 weeks of cumulative
 * percent, TYPED, and seeded from the plan column beside it — so every week
 * someone is asked "what percent is this now?", which is a question nobody on
 * a site can answer honestly. They can answer "three of eight trays" and
 * "fabrication is done". The percent is arithmetic, and arithmetic is the
 * app's job.
 *
 * ONE of these is mounted for the whole screen and pointed at the active row.
 * Not one per row: the list runs to 285 rows on Gundih, and the rule here is
 * Radix per screen, never per row.
 *
 * `linked` is deliberately not offered. Three engineering leaves already read
 * their figure from the document register and keep doing so untouched, but
 * offering it as a free choice invites linking a row that has no document
 * behind it, and a link to nothing reports zero forever.
 */
export default function MeasurePanel({
  row,
  onClose,
  onSaved,
}: {
  row: WeightsRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [method, setMethod] = useState<'qty' | 'milestone' | 'lumpsum'>(
    row.method === 'qty' || row.method === 'milestone' ? row.method : 'lumpsum'
  );
  const [total, setTotal] = useState(row.qtyTotal != null ? String(row.qtyTotal) : '');
  const [unit, setUnit] = useState(row.qtyUnit ?? '');
  const [steps, setSteps] = useState<string[]>(
    row.steps > 0 ? [] : ['Material on site', 'Fabrication', 'Installed', 'Tested']
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function save() {
    setError(null);

    if (method === 'qty') {
      const n = Number(total);
      // `vol: 1, satuan: 'Ls'` is how every seeded row is stored and it passes a
      // naive `vol > 0`. The action refuses it through `hasRealQuantity`, so
      // the same refusal is said here first, in words, before a round trip.
      if (!Number.isFinite(n) || n <= 0 || !unit.trim() || unit.trim().toLowerCase() === 'ls') {
        setError('Give it a real total and a unit to count in, like 340 and m. Ls is not a quantity.');
        return;
      }
    }

    const clean = steps.map((s) => s.trim()).filter(Boolean);
    if (method === 'milestone' && clean.length < 2) {
      setError('A step list needs at least two steps.');
      return;
    }

    // Equal shares. Uneven weighting is a real thing people want, but guessing
    // it for them would be inventing a number, and an even split is at least a
    // number they can see and argue with.
    const milestones: Milestone[] = clean.map((label, i) => ({
      id: `s${i + 1}`,
      label,
      weight: Math.round((100 / clean.length) * 100) / 100,
    }));

    startSaving(async () => {
      const res = await setProgressMethodAction(row.id, method, {
        ...(method === 'qty' ? { vol: Number(total), satuan: unit.trim() } : {}),
        ...(method === 'milestone' ? { milestones } : {}),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  }

  // A plain fixed overlay, not a Radix Dialog: this screen already refuses
  // Radix per row, and one hand-rolled panel keeps the whole list free of it.
  // PORTALLED to body: the workbench sits under an animated (transformed)
  // ancestor, and a transform makes `fixed` resolve against that box instead
  // of the screen. Rendered in place, the dim covered only the list and the
  // sheet landed at the bottom of a page-tall box, off screen until scrolled to.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="animate-enter max-h-[90vh] w-full max-w-lg overflow-auto rounded-t-2xl bg-background p-5 shadow-xl sm:rounded-2xl">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          How is this measured
        </p>
        <h2 className="mt-1 text-lg font-semibold">
          {row.code} {row.name}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Decide it once here, and every week after you count instead of estimating.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <Choice
            on={method === 'qty'}
            onPick={() => setMethod('qty')}
            title="Quantity"
            body="Count what is done against a total. 3 of 8 units, 180 of 450 m."
          >
            <div className="mt-2 flex gap-2">
              <input
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                inputMode="decimal"
                placeholder="Total"
                aria-label="Total quantity"
                className="min-h-11 w-28 rounded-lg bg-card px-3 text-sm tabular-nums ring-1 ring-foreground/12 focus:ring-2 focus:ring-chart-1 focus:outline-none"
              />
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Unit, e.g. m"
                aria-label="Unit"
                className="min-h-11 flex-1 rounded-lg bg-card px-3 text-sm ring-1 ring-foreground/12 focus:ring-2 focus:ring-chart-1 focus:outline-none"
              />
            </div>
          </Choice>

          <Choice
            on={method === 'milestone'}
            onPick={() => setMethod('milestone')}
            title="Steps"
            body="Tick a step as it is reached. For work with nothing to count."
          >
            <div className="mt-2 flex flex-col gap-1.5">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={s}
                    onChange={(e) =>
                      setSteps((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))
                    }
                    aria-label={`Step ${i + 1}`}
                    className="min-h-11 flex-1 rounded-lg bg-card px-3 text-sm ring-1 ring-foreground/12 focus:ring-2 focus:ring-chart-1 focus:outline-none"
                  />
                  <m.button
                    {...pressMotion}
                    onClick={() => setSteps((prev) => prev.filter((_, j) => j !== i))}
                    className="min-h-11 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent"
                    aria-label={`Remove step ${i + 1}`}
                  >
                    Remove
                  </m.button>
                </div>
              ))}
              <m.button
                {...pressMotion}
                onClick={() => setSteps((prev) => [...prev, ''])}
                className="min-h-11 self-start rounded-lg px-3 text-sm font-medium text-chart-1 hover:bg-accent"
              >
                Add a step
              </m.button>
              <p className="text-xs text-muted-foreground">
                Each step carries an equal share. {steps.filter((s) => s.trim()).length || 0} steps,{' '}
                {steps.filter((s) => s.trim()).length
                  ? (100 / steps.filter((s) => s.trim()).length).toFixed(1)
                  : '0'}
                % each.
              </p>
            </div>
          </Choice>

          <Choice
            on={method === 'lumpsum'}
            onPick={() => setMethod('lumpsum')}
            title="Percent, typed"
            body="For work that genuinely cannot be broken down. It is reported as an estimate, because that is what it is."
          />
        </div>

        {error && (
          <p className="animate-fade-in-up mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {row.method !== method && row.method !== 'lumpsum' && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            Changing this clears the evidence the old method collected. The percentage already
            reported is carried across, not recomputed.
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
            onClick={save}
            disabled={saving}
            className="min-h-11 rounded-lg bg-chart-1 px-5 text-sm font-medium text-white disabled:opacity-70"
          >
            {saving ? 'Saving…' : 'Save'}
          </m.button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Choice({
  on,
  onPick,
  title,
  body,
  children,
}: {
  on: boolean;
  onPick: () => void;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-3 ring-1 transition-colors duration-300 ease-ios',
        on ? 'bg-chart-1/6 ring-chart-1/40' : 'ring-foreground/10'
      )}
    >
      <button onClick={onPick} className="flex w-full min-h-11 items-start gap-3 text-left">
        <span
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0 rounded-full ring-2 transition-colors duration-300 ease-ios',
            on ? 'bg-chart-1 ring-chart-1' : 'ring-foreground/25'
          )}
        />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
        </span>
      </button>
      {on && children}
    </div>
  );
}
