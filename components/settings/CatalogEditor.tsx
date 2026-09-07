'use client';

import { useState, useTransition } from 'react';
import { saveCatalogAction } from '@/lib/actions';
import { CATALOG_TITLES, type CatalogKey } from '@/lib/catalogs';
import type { CatalogEntry } from '@/lib/types';
import { Button } from '@/components/ui/button';

/**
 * Editing the lists that used to be compiled into the app.
 *
 * Small on purpose: this screen exists to prove a project owns its own
 * categories, not to be a data-management suite. Renames apply to future
 * reports only — reports already written keep the text they were saved with,
 * because a signed report must not change after the fact.
 */
export default function CatalogEditor({
  catalogKey,
  entries,
}: {
  catalogKey: CatalogKey;
  entries: CatalogEntry[];
}) {
  const [rows, setRows] = useState<CatalogEntry[]>(entries);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = CATALOG_TITLES[catalogKey];
  const dirty = JSON.stringify(rows) !== JSON.stringify(entries);
  const showClaim = catalogKey === 'delayCause';
  // Weather ids are WeatherInfo field names, so the four rows are structural:
  // adding or removing one would orphan a field the daily form still writes to.
  const fixedLength = catalogKey === 'weather';

  function patch(i: number, p: Partial<CatalogEntry>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...p } : r)));
    setSaved(false);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveCatalogAction(catalogKey, rows);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <section className="animate-fade-in-up rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="text-sm font-semibold">{meta.title}</h2>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{meta.hint}</p>

      <ul className="divide-y rounded-md border">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 p-2">
            <input
              value={r.label}
              onChange={(e) => patch(i, { label: e.target.value })}
              className="h-11 min-w-40 flex-1 rounded-md sm:h-8 border bg-background px-2 text-sm outline-none transition-colors duration-150 ease-ios focus:border-primary/60"
            />
            {showClaim && (
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={!!r.claimable}
                  onChange={(e) => patch(i, { claimable: e.target.checked })}
                  className="size-5 accent-primary sm:size-4"
                />
                claimable
              </label>
            )}
            <button
              hidden={fixedLength}
              onClick={() => {
                setRows((p) => p.filter((_, j) => j !== i));
                setSaved(false);
              }}
              className="min-h-11 shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground sm:min-h-0 transition-colors duration-150 ease-ios hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${r.label}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          hidden={fixedLength}
          onClick={() => {
            setRows((p) => [...p, { id: `baru-${p.length + 1}`, label: '', claimable: false }]);
            setSaved(false);
          }}
        >
          Add row
        </Button>
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {saved && !dirty && <span className="text-xs text-emerald-600">Saved.</span>}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
