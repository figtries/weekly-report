'use client';

import { useState, useTransition } from 'react';
import { m } from 'framer-motion';
import { Check } from 'lucide-react';

import { CURRENCIES } from '@/lib/currency';
import { setProjectCurrencyAction } from '@/lib/project-actions';

/**
 * Which money this project is priced in.
 *
 * A native `<select>` rather than a Radix one: this sits in a strip that also
 * renders inside long lists, and on iOS a native select opens the system wheel,
 * which is the better control on a phone anyway.
 *
 * It relabels, it does not convert — said out loud in the panel, because a
 * picker that silently turned 12,313 rupiah into 12,313 dollars would restate a
 * contract by a factor of fifteen thousand.
 */
export default function CurrencyPicker({
  projectId,
  currency,
}: {
  projectId: string;
  currency: string;
}) {
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = CURRENCIES.find((c) => c.code === currency);

  return (
    <>
      <select
        value={currency}
        disabled={pending}
        onChange={(e) => setAsking(e.target.value)}
        aria-label="Currency"
        className="h-8 rounded-lg border bg-card px-1.5 text-[11px] font-medium outline-none transition-colors hover:bg-muted focus:border-foreground disabled:opacity-50"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </select>

      {asking && asking !== currency && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center sm:p-6"
          onClick={() => setAsking(null)}
        >
          <m.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="w-full rounded-t-2xl border bg-card p-4 shadow-lg sm:max-w-sm sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold">
              Price this project in {CURRENCIES.find((c) => c.code === asking)?.label}?
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              This changes the label, not the numbers. Every price stays exactly the figure it is
              now — the app holds no exchange rate, and inventing one would silently restate the
              contract.
              {current && (
                <>
                  {' '}
                  Anything already entered as <strong className="text-foreground">{current.code}</strong>{' '}
                  will read as <strong className="text-foreground">{asking}</strong> afterwards.
                </>
              )}
            </p>

            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await setProjectCurrencyAction(projectId, asking);
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    setAsking(null);
                  })
                }
                className="btn-primary flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-medium"
              >
                <Check className="size-4" />
                {pending ? 'Saving…' : `Use ${asking}`}
              </button>
              <button
                type="button"
                onClick={() => setAsking(null)}
                className="h-11 rounded-lg border px-4 text-sm font-medium hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </m.div>
        </div>
      )}
    </>
  );
}
