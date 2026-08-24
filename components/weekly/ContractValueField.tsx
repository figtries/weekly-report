'use client';

import { useState, useTransition } from 'react';
import { setContractValueAction } from '@/lib/actions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * The single field that turns every percentage in the app into a Rupiah
 * figure. It lives inline on the control panel rather than in a settings page
 * because its whole point is that the numbers beside it move the moment it is
 * filled in.
 *
 * Digits are grouped as you type: contract values run to twelve digits and an
 * ungrouped string of them is unreadable, which is how a zero gets miscounted.
 */
export default function ContractValueField({ value }: { value: number | null }) {
  const [raw, setRaw] = useState(value ? value.toLocaleString('id-ID') : '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const digits = raw.replace(/\D/g, '');
  const parsed = digits ? Number(digits) : 0;
  const dirty = parsed !== (value ?? 0);

  function onChange(next: string) {
    const d = next.replace(/\D/g, '');
    setRaw(d ? Number(d).toLocaleString('id-ID') : '');
    setError(null);
  }

  function save() {
    startTransition(async () => {
      const res = await setContractValueAction(parsed);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label
          htmlFor="contract-value"
          className="mb-1.5 block text-xs font-medium tracking-wide text-muted-foreground"
        >
          Nilai kontrak
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rp</span>
          <Input
            id="contract-value"
            inputMode="numeric"
            value={raw}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && dirty) save();
            }}
            placeholder="0"
            className="max-w-56 tabular-nums"
          />
        </div>
      </div>
      <Button size="sm" onClick={save} disabled={!dirty || pending}>
        {pending ? 'Menyimpan…' : 'Simpan'}
      </Button>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}
