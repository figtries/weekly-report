'use client';

import { useState } from 'react';
import { CircleAlert } from 'lucide-react';

import type { Network } from '@/lib/chains';

/**
 * The one standing reminder over the planner: activities whose typed dates
 * break a link, by name; each name opens that row's links. Absent when there
 * are none. "Nothing waits for this yet" is a per-row chip, never a strip: at
 * the start every row would be on it, shouting before anyone did anything.
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
  const [all, setAll] = useState(false);
  const ids = [...network.rows.entries()].filter(([, r]) => r.conflicts.length > 0).map(([id]) => id);
  if (!ids.length) return null;
  // Three names and a count: one quiet line, not a red wall. The rest are a
  // press away.
  const shown = all ? ids : ids.slice(0, 3);
  return (
    <div className="animate-fade-in-up flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b bg-bad-soft px-3 py-2 text-xs text-bad sm:px-6">
      <CircleAlert className="size-3.5 shrink-0" aria-hidden />
      <span className="font-medium">
        {ids.length === 1 ? '1 activity starts before what it waits for:' : `${ids.length} activities start before what they wait for:`}
      </span>
      {shown.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onOpen(id)}
          className="min-h-8 rounded-md px-1.5 font-semibold underline-offset-2 hover:underline"
        >
          {names.get(id) ?? id}
        </button>
      ))}
      {ids.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="min-h-8 rounded-md px-1.5 font-medium text-bad/80 hover:bg-bad/10"
        >
          +{ids.length - shown.length} more
        </button>
      )}
    </div>
  );
}
