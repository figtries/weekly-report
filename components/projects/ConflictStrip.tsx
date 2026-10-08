'use client';

import { useState } from 'react';
import { ChevronDown, CircleAlert } from 'lucide-react';

import type { Network } from '@/lib/chains';

/**
 * The one standing reminder over the planner: activities whose typed dates
 * break a link, by name; each name opens that row's links. Absent when there
 * are none. "Nothing waits for this yet" is a per-row chip, never a strip: at
 * the start every row would be on it, shouting before anyone did anything.
 *
 * A white band with the red kept to its mark (8 Oct 2026): the pink band with
 * red names across the full width was called uncomfortable to look at. On a
 * phone the names are one press away (Show), so the strip is one row tall.
 */
export default function ConflictStrip({
  network,
  names,
  onOpen,
}: {
  network: Network;
  names: Map<string, string>;
  onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const ids = [...network.rows.entries()].filter(([, r]) => r.conflicts.length > 0).map(([id]) => id);
  if (!ids.length) return null;
  const one = ids.length === 1;
  const shown = all ? ids : ids.slice(0, 3);
  return (
    <div className="animate-fade-in-up flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b bg-card px-3 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-bad-soft text-bad">
        <CircleAlert className="size-4" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 leading-tight sm:flex-none">
        <span className="block text-[13px] font-semibold text-foreground">
          {one ? '1 activity starts too early' : `${ids.length} activities start too early`}
        </span>
        <span className="block text-xs text-muted-foreground">
          {one ? 'It starts before what it waits for.' : 'They start before what they wait for.'}
        </span>
      </p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:hidden"
      >
        {open ? 'Hide' : 'Show'}
        <ChevronDown className={`size-3.5 transition-transform duration-300 ease-ios ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      <div
        className={`${open ? 'flex' : 'hidden'} min-w-0 basis-full flex-wrap gap-1.5 pl-[42px] sm:ml-auto sm:flex sm:basis-auto sm:justify-end sm:pl-0`}
      >
        {shown.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpen(id)}
            className="inline-flex h-8 max-w-60 items-center rounded-md border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:border-bad/40 hover:bg-bad-soft"
          >
            <span className="truncate">{names.get(id) ?? id}</span>
          </button>
        ))}
        {ids.length > shown.length && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="inline-flex h-8 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            +{ids.length - shown.length} more
          </button>
        )}
      </div>
    </div>
  );
}
