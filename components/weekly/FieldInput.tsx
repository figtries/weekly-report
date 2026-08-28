'use client';

import { useMemo, useState, useTransition } from 'react';
import { saveFieldProgressAction, setProgressMethodAction } from '@/lib/actions';
import { fmtNum, fmtPct, formatRupiah } from '@/lib/analysis';
import { hasRealQuantity, methodOf, progressEvidence, totalQty } from '@/lib/progress';
import type { LeafSnapshot, ProgressMethod, WbsItem } from '@/lib/types';
import { Button } from '@/components/ui/button';

/**
 * Field entry — the substitution the whole product rests on.
 *
 * The old question, "what percent is this?", needs judgement nobody new has,
 * and the seeded project shows what it produces: 96% of its values are
 * multiples of five. This screen asks "how much did you finish?" instead, and
 * shows the working underneath every number so anyone can check it against the
 * site.
 *
 * Deliberately native inputs throughout. This list runs to hundreds of rows and
 * a Radix control per row is what makes a page like this stutter on a phone —
 * see AGENTS.md, "Radix per screen, never per row".
 */

export interface FieldRow {
  item: WbsItem;
  snap: LeafSnapshot | null;
  ancestors: string;
  planPct: number;
}

type Draft = { qtyDone?: number; milestonesDone?: string[] };

const METHOD_LABEL: Record<ProgressMethod, string> = {
  qty: 'Kuantitas',
  milestone: 'Milestone',
  lumpsum: 'Ketik persen',
};

export default function FieldInput({
  week,
  rows,
  contractValue,
  editable,
}: {
  week: number;
  rows: FieldRow[];
  contractValue: number | null;
  editable: boolean;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'measurable' | 'guessed'>('all');
  const [pending, startTransition] = useTransition();
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [askQty, setAskQty] = useState<{ item: WbsItem; total: string; unit: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.item.wbsCode} ${r.item.deskripsi}`.toLowerCase().includes(q)) return false;
      const m = methodOf(r.item);
      if (filter === 'measurable') return m !== 'lumpsum';
      if (filter === 'guessed') return m === 'lumpsum';
      return true;
    });
  }, [rows, query, filter]);

  const guessedCount = useMemo(
    () => rows.filter((r) => methodOf(r.item) === 'lumpsum').length,
    [rows]
  );

  const dirtyIds = Object.keys(drafts);

  function liveProgress(r: FieldRow): number {
    const d = drafts[r.item.id];
    const m = methodOf(r.item);
    if (m === 'qty') {
      const done = d?.qtyDone ?? r.snap?.qtyDone ?? 0;
      return Math.min(100, (done / totalQty(r.item)) * 100);
    }
    if (m === 'milestone') {
      const done = d?.milestonesDone ?? r.snap?.milestonesDone ?? [];
      const ms = r.item.milestones ?? [];
      const total = ms.reduce((s, x) => s + x.weight, 0);
      if (!total) return 0;
      return (ms.filter((x) => done.includes(x.id)).reduce((s, x) => s + x.weight, 0) / total) * 100;
    }
    return r.snap?.cumProgressPct ?? 0;
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveFieldProgressAction(
        week,
        dirtyIds.map((id) => ({ leafId: id, ...drafts[id] }))
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDrafts({});
      setSavedAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }));
    });
  }

  function switchMethod(item: WbsItem, method: ProgressMethod) {
    setError(null);
    // Quantity mode needs a real total. Inventing one (the old code defaulted to
    // 100 units) makes the number look measured when nobody measured anything —
    // and a lumpsum item stored as "1 Ls" passes any naive `vol > 0` check.
    if (method === 'qty' && !hasRealQuantity(item)) {
      setAskQty({ item, total: '', unit: '' });
      return;
    }
    startTransition(async () => {
      const res = await setProgressMethodAction(item.id, method);
      if (!res.ok) setError(res.error);
    });
  }

  function confirmQty() {
    if (!askQty) return;
    const total = Number(askQty.total.replace(',', '.'));
    if (!Number.isFinite(total) || total <= 0 || !askQty.unit.trim()) return;
    const item = askQty.item;
    setAskQty(null);
    setError(null);
    startTransition(async () => {
      const res = await setProgressMethodAction(item.id, 'qty', {
        vol: total,
        satuan: askQty.unit.trim(),
      });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items…"
          className="h-9 min-w-48 flex-1 rounded-md border bg-background px-3 text-sm outline-none transition-colors duration-150 ease-ios focus:border-primary/60"
        />
        <div className="flex overflow-hidden rounded-md border">
          {(
            [
              ['all', `All ${rows.length}`],
              ['measurable', `Measured ${rows.length - guessedCount}`],
              ['guessed', `Estimated ${guessedCount}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 ease-ios ${
                filter === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {guessedCount > 0 && filter !== 'guessed' && (
        <p className="rounded-md border border-dashed border-amber-500/50 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {guessedCount} items are still filled in by typing a percentage. Switch them to Quantity
          or Milestone from the last column — the figure then becomes checkable on site.
        </p>
      )}

      {askQty && (
        <div className="animate-fade-in-up rounded-lg border border-primary/40 bg-primary/5 p-3.5">
          <div className="text-sm font-medium">
            What is the total quantity for “{askQty.item.deskripsi}”?
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This item is recorded as lumpsum, so it has no quantity to count. Give it a total and
            a unit — the progress already reported is carried across into the new unit, not lost.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <input
              autoFocus
              inputMode="decimal"
              value={askQty.total}
              onChange={(e) => setAskQty({ ...askQty, total: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && confirmQty()}
              placeholder="340"
              className="h-8 w-28 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none transition-colors duration-150 ease-ios focus:border-primary/60"
            />
            <input
              value={askQty.unit}
              onChange={(e) => setAskQty({ ...askQty, unit: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && confirmQty()}
              placeholder="m, m3, kg, points…"
              className="h-8 w-36 rounded-md border bg-background px-2 text-sm outline-none transition-colors duration-150 ease-ios focus:border-primary/60"
            />
            <Button
              size="sm"
              onClick={confirmQty}
              disabled={pending || !askQty.total.trim() || !askQty.unit.trim()}
            >
              Switch to quantity
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAskQty(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left font-medium">Item</th>
              <th className="px-3 py-2 text-left font-medium">What was completed</th>
              <th className="px-3 py-2 text-right font-medium">Progress</th>
              <th className="px-3 py-2 text-right font-medium">Plan</th>
              <th className="px-3 py-2 text-left font-medium">Evidence</th>
              <th className="px-3 py-2 text-right font-medium">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing matches.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const m = methodOf(r.item);
              const pct = liveProgress(r);
              const dirty = !!drafts[r.item.id];
              const behind = pct < r.planPct - 0.01;
              return (
                <tr
                  key={r.item.id}
                  className={`transition-colors duration-150 ease-ios ${
                    dirty ? 'bg-primary/5' : 'hover:bg-muted/30'
                  }`}
                >
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium leading-snug">{r.item.deskripsi}</div>
                    <div className="text-[11px] text-muted-foreground">
                      <span className="tabular-nums">{r.item.wbsCode}</span>
                      {r.ancestors && <span> · {r.ancestors}</span>}
                      <span> · weight {fmtPct(r.item.bobot, 3)}</span>
                    </div>
                  </td>

                  <td className="px-3 py-2 align-top">
                    {m === 'qty' && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min={0}
                          max={totalQty(r.item)}
                          step="any"
                          disabled={!editable}
                          value={drafts[r.item.id]?.qtyDone ?? r.snap?.qtyDone ?? 0}
                          onChange={(e) =>
                            setDrafts((p) => ({
                              ...p,
                              [r.item.id]: { ...p[r.item.id], qtyDone: Number(e.target.value) || 0 },
                            }))
                          }
                          className="h-8 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums outline-none transition-colors duration-150 ease-ios focus:border-primary/60 disabled:opacity-50"
                        />
                        <span className="whitespace-nowrap text-xs text-muted-foreground">
                          of {fmtNum(totalQty(r.item))} {r.item.satuan ?? ''}
                        </span>
                      </div>
                    )}

                    {m === 'milestone' && (
                      <div className="flex flex-wrap gap-1">
                        {(r.item.milestones ?? []).map((ms) => {
                          const done = drafts[r.item.id]?.milestonesDone ??
                            r.snap?.milestonesDone ?? [];
                          const on = done.includes(ms.id);
                          return (
                            <button
                              key={ms.id}
                              disabled={!editable}
                              onClick={() =>
                                setDrafts((p) => ({
                                  ...p,
                                  [r.item.id]: {
                                    ...p[r.item.id],
                                    milestonesDone: on
                                      ? done.filter((x) => x !== ms.id)
                                      : [...done, ms.id],
                                  },
                                }))
                              }
                              className={`rounded-md border px-2 py-1 text-xs transition-colors duration-150 ease-ios disabled:opacity-50 ${
                                on
                                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                  : 'hover:bg-muted'
                              }`}
                              title={`${ms.label} · ${ms.weight}%`}
                            >
                              {ms.label.split('—')[0].trim()}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {m === 'lumpsum' && (
                      <span className="text-xs italic text-muted-foreground">
                        Entered in Data Overall — no evidence
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right align-top">
                    <div
                      className={`font-semibold tabular-nums ${behind ? 'text-destructive' : ''}`}
                    >
                      {fmtPct(pct)}
                    </div>
                    {contractValue !== null && (
                      <div className="text-[11px] tabular-nums text-muted-foreground">
                        {formatRupiah((contractValue * r.item.bobot * pct) / 10000)}
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2 text-right align-top tabular-nums text-muted-foreground">
                    {fmtPct(r.planPct)}
                  </td>

                  <td className="px-3 py-2 align-top">
                    <span
                      className={`text-xs ${
                        m === 'lumpsum' ? 'text-destructive' : 'text-muted-foreground'
                      }`}
                    >
                      {progressEvidence(r.item, {
                        cumProgressPct: pct,
                        targetWF: 0,
                        qtyDone: drafts[r.item.id]?.qtyDone ?? r.snap?.qtyDone,
                        milestonesDone:
                          drafts[r.item.id]?.milestonesDone ?? r.snap?.milestonesDone,
                      })}
                    </span>
                  </td>

                  <td className="px-3 py-2 text-right align-top">
                    <select
                      value={m}
                      disabled={!editable || pending}
                      onChange={(e) => switchMethod(r.item, e.target.value as ProgressMethod)}
                      className="h-8 rounded-md border bg-background px-1.5 text-xs outline-none transition-colors duration-150 ease-ios focus:border-primary/60 disabled:opacity-50"
                    >
                      {(Object.keys(METHOD_LABEL) as ProgressMethod[]).map((k) => (
                        <option key={k} value={k}>
                          {METHOD_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* The save bar only exists while there is something to save — a
          permanently docked bar eats thumb space on a phone for nothing. */}
      {dirtyIds.length > 0 && (
        <div className="animate-save-bar-in sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-lg border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <span className="text-sm">
            <strong className="tabular-nums">{dirtyIds.length}</strong> item diubah
          </span>
          <Button size="sm" onClick={save} disabled={pending} className="ml-auto">
            {pending ? 'Saving…' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDrafts({})} disabled={pending}>
            Cancel
          </Button>
        </div>
      )}

      {savedAt && dirtyIds.length === 0 && (
        <p className="text-xs text-muted-foreground">Tersimpan {savedAt}.</p>
      )}
    </div>
  );
}
