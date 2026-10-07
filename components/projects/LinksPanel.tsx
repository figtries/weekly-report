'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';

import { whySentence, wouldLoop, type Network } from '@/lib/chains';
import { LINK_TYPES, MAX_WAIT, WAY_LABEL, type LinkType, type StoredLink } from '@/lib/links';
import type { Sheet, SheetRow } from '@/lib/sheet';
import { saveRowLinksAction } from '@/lib/sheet-actions';
import { cn } from '@/lib/utils';

/**
 * One activity's links: what it waits for, what waits for it, and one sentence
 * saying why its date is what it is. Nothing is saved before Save. Native
 * inputs: both lists can run long (Radix per screen, never per row).
 *
 * A "holds up" entry's way is the FOLLOWER's: "After it finishes" there means
 * the follower starts after THIS activity finishes.
 *
 * Loaded through next/dynamic from RowMenu, so the planner's first load does
 * not carry it; EPC order's guesses are fetched only when this opens on a row
 * nobody has answered.
 */
export default function LinksPanel({
  projectId,
  row,
  rows,
  network,
  names,
  suggestions,
  onBack,
  onSaved,
}: {
  projectId: string;
  row: SheetRow;
  rows: SheetRow[];
  network: Network;
  names: Map<string, string>;
  /** The date-chain guesses, worked out on the client. */
  suggestions: string[];
  onBack: () => void;
  onSaved: (sheet: Sheet, touched: string[]) => void;
}) {
  const logic = network.rows.get(row.id);
  const [waits, setWaits] = useState<StoredLink[]>(() => row.links ?? []);
  const [holds, setHolds] = useState<StoredLink[]>(() =>
    rows.flatMap((r) => (r.links ?? []).filter((l) => l.id === row.id).map((l) => ({ id: r.id, type: l.type, wait: l.wait })))
  );
  const [adding, setAdding] = useState<'waits' | 'holds' | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [epc, setEpc] = useState<string[]>([]);
  const [pending, start] = useTransition();

  // EPC order's guesses, only for a row nobody has answered. One retry; a
  // failure just shows the date guesses, which already stand.
  useEffect(() => {
    if (row.links !== null) return;
    let alive = true;
    const url = `/api/projects/${encodeURIComponent(projectId)}/link-suggestions`;
    const get = () => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    get()
      .catch(() => get())
      .then((json: Record<string, string[]>) => {
        if (alive) setEpc(json[row.id] ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, row.id, row.links]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const why = whySentence(row.id, network, byId, names);
  const offered = [...suggestions, ...epc.filter((id) => !suggestions.includes(id))].filter(
    (id) => !waits.some((w) => w.id === id) && byId.get(id)?.isLeaf
  );

  // The graph as it would stand with this panel's edits, for the loop check.
  const draft = useMemo(
    () =>
      rows.map((r) => {
        if (r.id === row.id) return { ...r, links: waits };
        const rest = (r.links ?? []).filter((l) => l.id !== row.id);
        const h = holds.find((x) => x.id === r.id);
        return h
          ? { ...r, links: [...rest, { id: row.id, type: h.type, wait: h.wait }] }
          : { ...r, links: r.links === null ? null : rest };
      }),
    [rows, row.id, waits, holds]
  );
  const loops = (other: string, side: 'waits' | 'holds') =>
    Boolean(side === 'waits' ? wouldLoop(draft, other, row.id) : wouldLoop(draft, row.id, other));

  const chip = why.conflict
    ? null
    : logic?.setsProjectFinish
      ? { text: 'Sets the project finish', tone: 'bg-bad-soft text-bad' }
      : logic?.canSlip != null
        ? { text: `Can slip ${logic.canSlip} ${logic.canSlip === 1 ? 'day' : 'days'}`, tone: 'bg-muted text-foreground' }
        : logic && logic.outgoing.length === 0
          ? { text: 'Nothing waits for this yet', tone: 'bg-muted text-muted-foreground' }
          : { text: 'Not linked through to the finish yet', tone: 'bg-muted text-muted-foreground' };

  const contractGap =
    row.contractFinish && row.finishDate && row.contractFinish !== row.finishDate
      ? Math.round((Date.parse(row.finishDate + 'T00:00:00Z') - Date.parse(row.contractFinish + 'T00:00:00Z')) / 86_400_000)
      : 0;

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveRowLinksAction(row.id, waits, holds);
      if (!res.ok) return setError(res.error);
      onSaved(res.sheet, [row.id, ...waits.map((w) => w.id)]);
    });

  const clampWait = (v: string) => Math.max(0, Math.min(MAX_WAIT, Math.floor(Number(v) || 0)));

  const list = (side: 'waits' | 'holds') => {
    const items = side === 'waits' ? waits : holds;
    const set = side === 'waits' ? setWaits : setHolds;
    return items.map((l, i) => (
      <div key={l.id} className="mt-2 rounded-xl border p-2.5">
        <div className="flex items-center gap-2 text-[13px]">
          <span className="min-w-0 flex-1 truncate">{names.get(l.id) ?? l.id}</span>
          {side === 'waits' && logic?.setsDateBy.includes(l.id) && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary">Sets the date</span>
          )}
          <button
            type="button"
            aria-label={`Remove ${names.get(l.id) ?? ''}`}
            onClick={() => set(items.filter((_, k) => k !== i))}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex gap-2">
          <select
            aria-label="How it waits"
            value={l.type}
            onChange={(e) => set(items.map((x, k) => (k === i ? { ...x, type: e.target.value as LinkType } : x)))}
            className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-2 text-[13px]"
          >
            {LINK_TYPES.map((t) => (
              <option key={t} value={t}>
                {WAY_LABEL[t]}
              </option>
            ))}
          </select>
          <label className="flex h-11 items-center gap-1.5 rounded-lg border px-2 text-[13px] text-muted-foreground">
            Wait
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_WAIT}
              value={l.wait}
              onChange={(e) => set(items.map((x, k) => (k === i ? { ...x, wait: clampWait(e.target.value) } : x)))}
              className="w-12 bg-transparent text-right tabular-nums text-foreground outline-none"
            />
            days
          </label>
        </div>
      </div>
    ));
  };

  const picker = (side: 'waits' | 'holds') => {
    const taken = new Set((side === 'waits' ? waits : holds).map((l) => l.id));
    const q = query.trim().toLowerCase();
    const shown = rows
      .filter((r) => r.isLeaf && r.id !== row.id && !taken.has(r.id))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.code.startsWith(q))
      .slice(0, 50);
    return (
      <div className="mt-2 rounded-xl border p-2">
        <label className="flex h-11 items-center gap-2 rounded-lg border px-2">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an activity"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          />
        </label>
        <ul className="mt-1 max-h-64 overflow-y-auto">
          {shown.map((r) => {
            const loop = loops(r.id, side);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={loop}
                  onClick={() => {
                    const add = { id: r.id, type: 'FS' as const, wait: 0 };
                    if (side === 'waits') setWaits([...waits, add]);
                    else setHolds([...holds, add]);
                    setAdding(null);
                    setQuery('');
                  }}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-muted disabled:opacity-50"
                >
                  <span className="shrink-0 rounded bg-muted px-1.5 text-[10.5px] font-semibold tabular-nums text-muted-foreground">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  {loop && <span className="shrink-0 text-[11px] text-muted-foreground">Would loop back</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" onClick={() => setAdding(null)} className="mt-1 min-h-9 w-full rounded-lg text-[12px] text-muted-foreground hover:bg-muted">
          Close
        </button>
      </div>
    );
  };

  const addButton = (side: 'waits' | 'holds', label: string) =>
    adding === side ? (
      picker(side)
    ) : (
      <button
        type="button"
        onClick={() => {
          setAdding(side);
          setQuery('');
        }}
        className="mt-2 min-h-11 w-full rounded-xl border border-dashed border-primary/40 text-[13px] font-semibold text-primary transition-colors duration-200 ease-ios hover:bg-primary/5"
      >
        {label}
      </button>
    );

  return (
    <div className="animate-fade-in-up">
      <button type="button" onClick={onBack} className="-ml-1 flex h-9 items-center gap-1 rounded-lg px-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back
      </button>

      <div className={cn('mt-2 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed', why.conflict ? 'bg-bad-soft text-bad' : 'bg-muted/60')}>
        {why.text}
        {chip && <span className={cn('ml-2 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold', chip.tone)}>{chip.text}</span>}
        {contractGap !== 0 && (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {Math.abs(contractGap)} {Math.abs(contractGap) === 1 ? 'day' : 'days'} {contractGap > 0 ? 'later' : 'earlier'} than contract
          </p>
        )}
      </div>

      <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Waits for</p>
      {list('waits')}
      {addButton('waits', '+ Add what it waits for')}
      {row.links === null &&
        offered.map((id) => (
          <div key={id} className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="text-[11px] font-semibold">Suggested</span>
            <span className="min-w-0 flex-1 truncate text-foreground">{names.get(id) ?? id}</span>
            <button
              type="button"
              onClick={() => setWaits([...waits, { id, type: 'FS', wait: 0 }])}
              className="min-h-9 rounded-full bg-primary/10 px-3 text-[12px] font-semibold text-primary"
            >
              Use
            </button>
          </div>
        ))}

      <p className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Holds up</p>
      {list('holds')}
      {addButton('holds', '+ Add what waits for this')}

      {error && <p className="mt-3 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onBack} className="min-h-11 rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted">
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="min-h-11 rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
