'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RollupNode } from '@/lib/rollup';
import type { ChangeLogEntry } from '@/lib/types';

interface EditState {
  cumProgressPct?: number;
  planPct?: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function isMilestone(n: RollupNode): boolean {
  return n.children.length === 0 && n.bobot === 0;
}

function planPctOf(n: RollupNode): number {
  return n.bobot > 0 ? (n.targetWF / n.bobot) * 100 : 0;
}

function flattenAll(roots: RollupNode[]): RollupNode[] {
  const out: RollupNode[] = [];
  const visit = (n: RollupNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

function findAncestors(all: RollupNode[], id: string): RollupNode[] {
  const byChild = new Map<string, RollupNode>();
  all.forEach((p) => p.children.forEach((c) => byChild.set(c.id, p)));
  const chain: RollupNode[] = [];
  let cur = byChild.get(id);
  while (cur) {
    chain.unshift(cur);
    cur = byChild.get(cur.id);
  }
  return chain;
}

function parseInput(raw: string, current: number): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return 0;
  if (s.startsWith('+') || s.startsWith('-')) {
    const delta = parseFloat(s);
    if (Number.isNaN(delta)) return null;
    return Math.max(0, Math.min(100, current + delta));
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  return `${d} hari lalu`;
}

export default function DataOverallWorkbench({
  roots,
  week,
  recentChanges,
}: {
  roots: RollupNode[];
  week: number;
  recentChanges: ChangeLogEntry[];
}) {
  const router = useRouter();

  const flatAll = useMemo(() => flattenAll(roots), [roots]);
  const editables = useMemo(
    () => flatAll.filter((n) => n.children.length === 0 && !isMilestone(n)),
    [flatAll]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(roots.map((r) => r.id))
  );
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, { cum?: string; plan?: string }>>({});
  const [showDetail, setShowDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');

  const selected = selectedId ? flatAll.find((n) => n.id === selectedId) ?? null : null;
  const dirtyCount = Object.keys(edits).length;

  // Close drawer on Escape.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  const recentIds = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const ids = new Set<string>();
    recentChanges.forEach((c) => {
      if (new Date(c.at).getTime() >= cutoff) ids.add(c.leafId);
    });
    return ids;
  }, [recentChanges]);

  const todayCount = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const leaves = new Set<string>();
    recentChanges.forEach((c) => {
      if (new Date(c.at).getTime() >= start.getTime()) leaves.add(c.leafId);
    });
    return leaves.size;
  }, [recentChanges]);

  const historyForSelected = useMemo(() => {
    if (!selectedId) return [];
    return recentChanges
      .filter((c) => c.leafId === selectedId)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 5);
  }, [recentChanges, selectedId]);

  function toggleGroup(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setEdit(id: string, patch: EditState) {
    setEdits((prev) => {
      const merged = { ...prev[id], ...patch };
      const node = flatAll.find((n) => n.id === id);
      if (node) {
        const origCum = round2(node.curProgressPct);
        const origPlan = round2(planPctOf(node));
        const cumSame = merged.cumProgressPct === undefined || round2(merged.cumProgressPct) === origCum;
        const planSame = merged.planPct === undefined || round2(merged.planPct) === origPlan;
        if (cumSame && planSame) {
          const next = { ...prev };
          delete next[id];
          return next;
        }
      }
      return { ...prev, [id]: merged };
    });
  }

  function currentCum(node: RollupNode): number {
    return round2(edits[node.id]?.cumProgressPct ?? node.curProgressPct);
  }
  function currentPlan(node: RollupNode): number {
    return round2(edits[node.id]?.planPct ?? planPctOf(node));
  }

  async function save() {
    if (!dirtyCount) return;
    setSaving(true);
    try {
      const updates: Record<string, { cumProgressPct?: number; targetWF?: number }> = {};
      for (const [id, patch] of Object.entries(edits)) {
        const node = flatAll.find((n) => n.id === id);
        if (!node) continue;
        updates[id] = {};
        if (patch.cumProgressPct !== undefined) updates[id].cumProgressPct = patch.cumProgressPct;
        if (patch.planPct !== undefined) updates[id].targetWF = (node.bobot * patch.planPct) / 100;
      }
      const res = await fetch(`/api/weeks/${week}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        alert(body.error ?? 'Gagal menyimpan perubahan');
        return;
      }
      setEdits({});
      setRawInputs({});
      setSelectedId(null);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase();
    return new Set(
      editables.filter((n) => n.deskripsi.toLowerCase().includes(q)).map((n) => n.id)
    );
  }, [editables, query]);

  return (
    <div className="space-y-4">
      {/* Change tracking strip */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm animate-fade-in-up">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-50 text-purple-600">
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div className="flex-1 text-sm text-gray-700">
          {todayCount > 0 ? (
            <>
              <span className="font-semibold text-gray-900">{todayCount} aktivitas</span>
              <span className="text-gray-500"> diupdate hari ini</span>
            </>
          ) : (
            <>
              <span className="font-medium text-gray-800">Belum ada perubahan hari ini.</span>
              <span className="text-gray-500"> Pilih aktivitas untuk mulai edit.</span>
            </>
          )}
        </div>
        {dirtyCount > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
            {dirtyCount} perubahan belum disimpan
          </span>
        )}
      </div>

      {/* Full-width list */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm animate-fade-in-up">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-3.5">
          <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari aktivitas…"
            className="flex-1 border-none bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
          />
          <div className="text-xs text-gray-500">{editables.length} aktivitas</div>
        </div>

        <div className="divide-y divide-gray-100">
          {roots.map((root) => (
            <ActivityGroup
              key={root.id}
              node={root}
              depth={0}
              expanded={expanded}
              onToggle={toggleGroup}
              onSelect={setSelectedId}
              filtered={filtered}
              edits={edits}
              recentIds={recentIds}
              currentCum={currentCum}
              currentPlan={currentPlan}
            />
          ))}
        </div>
      </div>

      {/* Sticky save bar */}
      {dirtyCount > 0 && !selected && (
        <div className="sticky bottom-4 z-30 mx-auto flex max-w-lg items-center justify-between rounded-2xl border border-gray-200 bg-white px-5 py-3.5 shadow-lg animate-fade-in-up">
          <div className="text-sm text-gray-700">
            <span className="font-semibold text-gray-900">{dirtyCount}</span> perubahan siap disimpan
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setEdits({});
                setRawInputs({});
              }}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              Batal semua
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-[0.97] disabled:opacity-40"
            >
              {saving ? 'Menyimpan…' : 'Simpan semua'}
            </button>
          </div>
        </div>
      )}

      {/* Slide-in edit drawer */}
      {selected && (
        <EditDrawer
          node={selected}
          ancestors={findAncestors(flatAll, selected.id)}
          cum={currentCum(selected)}
          plan={currentPlan(selected)}
          rawCum={rawInputs[selected.id]?.cum}
          rawPlan={rawInputs[selected.id]?.plan}
          onCumChange={(raw) => {
            setRawInputs((prev) => ({ ...prev, [selected.id]: { ...prev[selected.id], cum: raw } }));
            const parsed = parseInput(raw, round2(selected.curProgressPct));
            if (parsed !== null) setEdit(selected.id, { cumProgressPct: parsed });
          }}
          onPlanChange={(raw) => {
            setRawInputs((prev) => ({ ...prev, [selected.id]: { ...prev[selected.id], plan: raw } }));
            const parsed = parseInput(raw, round2(planPctOf(selected)));
            if (parsed !== null) setEdit(selected.id, { planPct: parsed });
          }}
          onQuickAction={(action) => {
            const cur = round2(selected.curProgressPct);
            let next = cur;
            if (action === 'same-prev') next = round2(selected.prevProgressPct);
            else if (action === 'plus5') next = Math.min(100, cur + 5);
            else if (action === 'plus10') next = Math.min(100, cur + 10);
            else if (action === 'done') next = 100;
            setEdit(selected.id, { cumProgressPct: next });
            setRawInputs((prev) => ({ ...prev, [selected.id]: { ...prev[selected.id], cum: String(next) } }));
          }}
          onReset={() => {
            setEdits((prev) => {
              const next = { ...prev };
              delete next[selected.id];
              return next;
            });
            setRawInputs((prev) => {
              const next = { ...prev };
              delete next[selected.id];
              return next;
            });
          }}
          isDirty={!!edits[selected.id]}
          showDetail={showDetail}
          onToggleDetail={() => setShowDetail((v) => !v)}
          history={historyForSelected}
          week={week}
          dirtyCount={dirtyCount}
          saving={saving}
          onSave={save}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

// ============================================================================

function ActivityGroup({
  node,
  depth,
  expanded,
  onToggle,
  onSelect,
  filtered,
  edits,
  recentIds,
  currentCum,
  currentPlan,
}: {
  node: RollupNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  filtered: Set<string> | null;
  edits: Record<string, EditState>;
  recentIds: Set<string>;
  currentCum: (n: RollupNode) => number;
  currentPlan: (n: RollupNode) => number;
}) {
  if (isMilestone(node)) return null;
  const isLeaf = node.children.length === 0;

  if (filtered && isLeaf && !filtered.has(node.id)) return null;
  if (filtered && !isLeaf) {
    const anyMatch = flattenAll([node]).some((c) => filtered.has(c.id));
    if (!anyMatch) return null;
  }

  if (isLeaf) {
    return (
      <LeafRow
        node={node}
        depth={depth}
        onSelect={() => onSelect(node.id)}
        isDirty={!!edits[node.id]}
        isRecent={recentIds.has(node.id)}
        cum={currentCum(node)}
        plan={currentPlan(node)}
      />
    );
  }

  const isOpen = filtered !== null ? true : expanded.has(node.id);
  const rollupCum = round2(node.curProgressPct);
  const rollupPlan = round2(planPctOf(node));
  const rollupGap = round2(rollupCum - rollupPlan);
  const isTop = depth === 0;

  return (
    <div>
      <button
        onClick={() => onToggle(node.id)}
        className={`flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-gray-50 ${
          isTop ? 'bg-gray-50/70' : ''
        }`}
        style={{ paddingLeft: 20 + depth * 20 }}
      >
        <svg
          className="h-4 w-4 shrink-0 text-gray-500 transition-transform"
          style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <div className="min-w-0 flex-1">
          <div className={`truncate ${isTop ? 'text-sm font-semibold text-gray-900' : 'text-sm font-medium text-gray-800'}`}>
            {node.deskripsi}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
            <span>Bobot <span className="font-medium text-gray-700">{node.bobot.toFixed(2)}%</span></span>
            <span className="text-gray-300">·</span>
            <span>
              Plan <span className="font-medium text-gray-700">{rollupPlan.toFixed(1)}%</span>{' '}
              <span className={rollupGap < 0 ? 'text-red-500' : rollupGap > 0 ? 'text-emerald-600' : 'text-gray-400'}>
                ({rollupGap > 0 ? '+' : ''}{rollupGap.toFixed(1)}%)
              </span>
            </span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-semibold text-gray-900">{rollupCum.toFixed(1)}%</div>
          <div className="text-[11px] text-gray-500">actual</div>
        </div>
      </button>
      {isOpen && (
        <div className="divide-y divide-gray-50 border-t border-gray-50">
          {node.children.map((child) => (
            <ActivityGroup
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
              filtered={filtered}
              edits={edits}
              recentIds={recentIds}
              currentCum={currentCum}
              currentPlan={currentPlan}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LeafRow({
  node, depth, onSelect, isDirty, isRecent, cum, plan,
}: {
  node: RollupNode;
  depth: number;
  onSelect: () => void;
  isDirty: boolean;
  isRecent: boolean;
  cum: number;
  plan: number;
}) {
  const gap = round2(cum - plan);
  const actualColor = cum >= 100
    ? 'bg-emerald-500'
    : cum >= 60
      ? 'bg-blue-500'
      : cum > 0
        ? 'bg-amber-500'
        : 'bg-gray-300';

  return (
    <button
      onClick={onSelect}
      className={`group flex w-full items-center gap-4 px-5 py-3.5 text-left transition-colors ${
        isDirty
          ? 'bg-amber-50 hover:bg-amber-100'
          : 'hover:bg-blue-50/40'
      }`}
      style={{ paddingLeft: 20 + depth * 20 + 24 }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-sm font-medium text-gray-900">
            {node.deskripsi}
          </div>
          {isRecent && (
            <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">
              Baru
            </span>
          )}
          {isDirty && (
            <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
              Edit
            </span>
          )}
        </div>
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-gray-100">
          <div className="absolute inset-y-0 left-0 bg-orange-200" style={{ width: `${Math.min(100, plan)}%` }} />
          <div className={`absolute inset-y-0 left-0 ${actualColor}`} style={{ width: `${Math.min(100, cum)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-gray-500">
          <span>Actual <span className="font-medium text-gray-700">{cum.toFixed(1)}%</span></span>
          <span>
            Plan <span className="font-medium text-gray-700">{plan.toFixed(1)}%</span>
            {gap !== 0 && (
              <span className={gap < 0 ? ' text-red-500' : ' text-emerald-600'}>
                {' · '}{gap > 0 ? '+' : ''}{gap.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
      </div>
      <svg
        className="h-4 w-4 shrink-0 text-gray-300 transition-colors group-hover:text-blue-500"
        fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// ============================================================================

function EditDrawer({
  node, ancestors, cum, plan, rawCum, rawPlan,
  onCumChange, onPlanChange, onQuickAction, onReset,
  isDirty, showDetail, onToggleDetail, history, week,
  dirtyCount, saving, onSave, onClose,
}: {
  node: RollupNode;
  ancestors: RollupNode[];
  cum: number;
  plan: number;
  rawCum?: string;
  rawPlan?: string;
  onCumChange: (raw: string) => void;
  onPlanChange: (raw: string) => void;
  onQuickAction: (a: 'same-prev' | 'plus5' | 'plus10' | 'done') => void;
  onReset: () => void;
  isDirty: boolean;
  showDetail: boolean;
  onToggleDetail: () => void;
  history: ChangeLogEntry[];
  week: number;
  dirtyCount: number;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  const gap = round2(cum - plan);
  const thisWeek = round2(cum - node.prevProgressPct);
  const curWF = round2((node.bobot * cum) / 100);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <button
        aria-label="Tutup"
        onClick={onClose}
        className="flex-1 bg-gray-900/40 backdrop-blur-[2px] animate-fade-in"
      />
      {/* Drawer */}
      <div className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl animate-slide-in-right">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-gray-100 bg-white/95 px-7 pt-6 pb-5 backdrop-blur">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1 text-[13px] text-gray-500">
              {ancestors.length > 0 ? (
                ancestors.map((a, i) => (
                  <span key={a.id} className="flex items-center gap-1">
                    <span className="truncate max-w-[180px]">{a.deskripsi}</span>
                    {i < ancestors.length - 1 && <span className="text-gray-300">›</span>}
                  </span>
                ))
              ) : (
                <span>Aktivitas</span>
              )}
            </div>
            <h3 className="mt-1.5 text-xl font-semibold leading-snug text-gray-900">{node.deskripsi}</h3>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Tutup"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scroll body */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-8 px-7 py-7">

            {/* Big numbers */}
            <section className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-blue-50 p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-blue-700">Actual</div>
                <div className="mt-2 text-[32px] font-semibold leading-none text-blue-700 tabular-nums">{cum.toFixed(1)}<span className="text-2xl">%</span></div>
                <div className={`mt-2.5 text-[13px] font-medium ${thisWeek > 0 ? 'text-emerald-600' : thisWeek < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                  {thisWeek > 0 ? '+' : ''}{thisWeek.toFixed(1)}% minggu ini
                </div>
              </div>
              <div className="rounded-2xl bg-orange-50 p-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-orange-700">Plan</div>
                <div className="mt-2 text-[32px] font-semibold leading-none text-orange-700 tabular-nums">{plan.toFixed(1)}<span className="text-2xl">%</span></div>
                <div className={`mt-2.5 text-[13px] font-medium ${gap < 0 ? 'text-red-500' : gap > 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                  Deviasi {gap > 0 ? '+' : ''}{gap.toFixed(1)}%
                </div>
              </div>
            </section>

            {/* Update progres */}
            <section>
              <div className="mb-4 flex items-center gap-2">
                <div className="h-5 w-1 rounded-full bg-blue-500" />
                <h4 className="text-[15px] font-semibold text-gray-900">Update progres</h4>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[13px] font-medium text-gray-700">Realisasi baru</span>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rawCum ?? cum.toFixed(2)}
                      onChange={(e) => onCumChange(e.target.value)}
                      className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3.5 text-right text-base font-medium tabular-nums text-gray-900 transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                    <span className="text-sm font-medium text-gray-500">%</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[13px] font-medium text-gray-700">Target</span>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rawPlan ?? plan.toFixed(2)}
                      onChange={(e) => onPlanChange(e.target.value)}
                      className="h-11 w-full rounded-lg border border-gray-300 bg-white px-3.5 text-right text-base font-medium tabular-nums text-gray-900 transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                    <span className="text-sm font-medium text-gray-500">%</span>
                  </div>
                </label>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <QuickBtn onClick={() => onQuickAction('same-prev')}>Sama seperti minggu lalu</QuickBtn>
                <QuickBtn onClick={() => onQuickAction('plus5')}>+5%</QuickBtn>
                <QuickBtn onClick={() => onQuickAction('plus10')}>+10%</QuickBtn>
                <QuickBtn onClick={() => onQuickAction('done')}>Selesai (100%)</QuickBtn>
              </div>
              <div className="mt-3 text-[12px] leading-relaxed text-gray-500">
                Tip: ketik <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-700">+5</code> di field untuk nambah 5% dari nilai sekarang.
              </div>
            </section>

            {/* Detail lanjutan */}
            <section>
              <button
                onClick={onToggleDetail}
                className={`flex w-full items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 text-left transition-all hover:border-gray-300 hover:bg-gray-50 ${
                  showDetail ? 'bg-gray-50' : 'bg-white'
                }`}
              >
                <svg
                  className="h-4 w-4 shrink-0 text-gray-500 transition-transform duration-300"
                  style={{ transform: showDetail ? 'rotate(90deg)' : 'rotate(0deg)' }}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                <div className="flex-1 text-[14px] font-semibold text-gray-800">Detail lanjutan</div>
                <div className="text-[12px] text-gray-500">Bobot, WBS, minggu lalu</div>
              </button>
              <div
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{ gridTemplateRows: showDetail ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-4 rounded-xl bg-gray-50 p-5">
                    <Field label="Kode WBS" value={node.wbsCode} />
                    <Field label="Bobot" value={`${node.bobot.toFixed(3)}%`} sub="dari total proyek" />
                    <Field label="Kontribusi ke total" value={`${curWF.toFixed(3)}%`} sub={`${cum.toFixed(1)}% × ${node.bobot.toFixed(2)}%`} />
                    <Field label="Volume" value={node.vol && node.satuan ? `${node.vol} ${node.satuan}` : '—'} />
                    <Field label={`Minggu lalu (W${week - 1})`} value={`${node.prevProgressPct.toFixed(2)}%`} />
                    <Field label="Perubahan minggu ini" value={`${thisWeek > 0 ? '+' : ''}${thisWeek.toFixed(2)}%`} />
                  </div>
                </div>
              </div>
            </section>

            {/* Riwayat */}
            <section>
              <div className="mb-4 flex items-center gap-2">
                <div className="h-5 w-1 rounded-full bg-purple-500" />
                <h4 className="text-[15px] font-semibold text-gray-900">Riwayat update</h4>
              </div>
              {history.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 py-6 text-center text-[13px] text-gray-500">
                  Belum ada riwayat untuk aktivitas ini.
                </div>
              ) : (
                <ol className="relative space-y-4 pl-5">
                  <span className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-gray-200" aria-hidden />
                  {history.map((h) => (
                    <li key={h.id} className="relative">
                      <span className={`absolute -left-[19px] top-1.5 h-3 w-3 rounded-full ring-4 ring-white ${h.field === 'cumProgressPct' ? 'bg-blue-500' : 'bg-orange-500'}`} aria-hidden />
                      <div className="text-[14px] font-medium text-gray-900 tabular-nums">
                        {h.field === 'cumProgressPct' ? 'Actual' : 'Plan'}: {h.oldValue.toFixed(1)}% <span className="text-gray-400">→</span> {h.newValue.toFixed(1)}%
                      </div>
                      <div className="mt-0.5 text-[12px] text-gray-500">W{h.week} · {timeAgo(h.at)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {isDirty && (
              <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center gap-2 text-[13px] text-amber-800">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M4.93 19h14.14a2 2 0 001.75-2.98l-7.07-12.24a2 2 0 00-3.48 0L3.18 16.02A2 2 0 004.93 19z" />
                  </svg>
                  Ada perubahan yang belum disimpan.
                </div>
                <button onClick={onReset} className="text-[13px] font-semibold text-amber-800 hover:text-amber-900">
                  Reset
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 z-10 border-t border-gray-100 bg-white/95 px-7 py-4 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] text-gray-500">
              {dirtyCount > 0 ? (
                <><span className="font-semibold text-gray-900">{dirtyCount}</span> perubahan siap disimpan</>
              ) : (
                'Tidak ada perubahan'
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg px-4 py-2.5 text-[14px] font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                Tutup
              </button>
              <button
                onClick={onSave}
                disabled={saving || dirtyCount === 0}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-[14px] font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40"
              >
                {saving ? 'Menyimpan…' : 'Simpan semua'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:scale-[0.97]"
    >
      {children}
    </button>
  );
}

function Field({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
