'use client';

import { useState, useTransition } from 'react';
import SoftSheet from '@/components/ui/SoftSheet';
import { Check } from 'lucide-react';

import { CURRENCIES } from '@/lib/currency';
import NativeSelect from '@/components/ui/NativeSelect';
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
  // The pick the sheet names, kept while it slides away after `asking` clears.
  const [shown, setShown] = useState<string | null>(null);
  if (asking && asking !== shown) setShown(asking);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <NativeSelect
        compact
        wrapperClassName="w-auto"
        value={currency}
        disabled={pending}
        onChange={(e) => setAsking(e.target.value)}
        aria-label="Currency"
        className="bg-card pl-3 text-[13px] hover:bg-muted sm:h-9"
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code}
          </option>
        ))}
      </NativeSelect>

      <SoftSheet open={!!asking && asking !== currency} onClose={() => setAsking(null)} label="Currency" size="sm">
            <h2 className="text-sm font-semibold">
              Price this project in {CURRENCIES.find((c) => c.code === shown)?.label}?
            </h2>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Only the label changes; no figure is converted.
            </p>

            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    if (!asking) return;
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
                {pending ? 'Saving…' : `Use ${shown}`}
              </button>
              <button
                type="button"
                onClick={() => setAsking(null)}
                className="btn-cancel h-11 rounded-lg px-4 text-sm"
              >
                Cancel
              </button>
            </div>
      </SoftSheet>
    </>
  );
}
