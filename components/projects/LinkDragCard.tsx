'use client';

import { useState, useTransition } from 'react';

import { wouldLoop } from '@/lib/chains';
import { LINK_TYPES, MAX_WAIT, WAY_LABEL, type LinkType } from '@/lib/links';
import type { Sheet, SheetRow } from '@/lib/sheet';
import { saveRowLinksAction } from '@/lib/sheet-actions';

/**
 * What a drag between two bar ends will save. Nothing is stored before Save;
 * the way the drag implied can still be changed here, and a link that would
 * loop says so and cannot be saved.
 */
export default function LinkDragCard({
  from,
  to,
  initialType,
  rows,
  onDone,
  onCancel,
}: {
  from: SheetRow;
  to: SheetRow;
  initialType: LinkType;
  rows: SheetRow[];
  onDone: (sheet: Sheet) => void;
  onCancel: () => void;
}) {
  const [type, setType] = useState<LinkType>(initialType);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const loop = wouldLoop(rows, from.id, to.id);
  const save = () =>
    start(async () => {
      setError(null);
      const own = [...(to.links ?? []).filter((l) => l.id !== from.id), { id: from.id, type, wait }];
      const holdsUp = rows.flatMap((r) =>
        (r.links ?? []).filter((l) => l.id === to.id).map((l) => ({ id: r.id, type: l.type, wait: l.wait }))
      );
      const res = await saveRowLinksAction(to.id, own, holdsUp);
      if (!res.ok) return setError(res.error);
      onDone(res.sheet);
    });
  return (
    <div
      role="dialog"
      aria-label="New link"
      className="animate-fade-in-up fixed bottom-6 left-1/2 z-50 w-[min(92vw,24rem)] -translate-x-1/2 rounded-2xl border bg-card p-4 text-[13px] shadow-lg"
    >
      <p className="leading-snug">
        <strong className="font-semibold">{to.name}</strong> waits for <strong className="font-semibold">{from.name}</strong>
      </p>
      <div className="mt-3 flex gap-2">
        <select
          aria-label="How it waits"
          value={type}
          onChange={(e) => setType(e.target.value as LinkType)}
          className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-2"
        >
          {LINK_TYPES.map((t) => (
            <option key={t} value={t}>
              {WAY_LABEL[t]}
            </option>
          ))}
        </select>
        <label className="flex h-11 items-center gap-1.5 rounded-lg border px-2 text-muted-foreground">
          Wait
          <input
            type="number"
            min={0}
            max={MAX_WAIT}
            value={wait}
            onChange={(e) => setWait(Math.max(0, Math.min(MAX_WAIT, Math.floor(Number(e.target.value) || 0))))}
            className="w-12 bg-transparent text-right tabular-nums text-foreground outline-none"
          />
          days
        </label>
      </div>
      {loop && <p className="mt-2 text-bad">Would loop back: {loop.map((id) => names.get(id) ?? id).join(' → ')}</p>}
      {error && <p className="mt-2 text-bad">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-full px-4 text-muted-foreground hover:bg-muted">
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || Boolean(loop)}
          onClick={save}
          className="min-h-11 rounded-full bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
