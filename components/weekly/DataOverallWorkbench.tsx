'use client';

import { memo, useEffect, useMemo, useState, useTransition } from 'react';
import { saveWeekUpdatesAction } from '@/lib/actions';
import type { RollupNode } from '@/lib/rollup';
import type { ChangeLogEntry } from '@/lib/types';

interface EditState {
  cumProgressPct?: number;
  planPct?: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number) => Math.max(0, Math.min(100, v));

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

function visibleChildren(n: RollupNode): RollupNode[] {
  return n.children.filter((c) => !isMilestone(c));
}

function leafCount(n: RollupNode): number {
  return flattenAll([n]).filter((x) => x.children.length === 0 && !isMilestone(x)).length;
}

/** "+5" adds, "-3" subtracts, "62.5" sets. Comma decimals accepted. */
function parseInput(raw: string, current: number): number | null {
  const s = raw.trim().replace(',', '.');
  if (s === '') return 0;
  if (s.startsWith('+') || s.startsWith('-')) {
    const delta = parseFloat(s);
    if (Number.isNaN(delta)) return null;
    return clamp(round2(current + delta));
  }
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  return clamp(round2(n));
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

// Self-contained ticker — only this tiny span re-renders every minute,
// not the entire Workbench.
function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <span suppressHydrationWarning className={className}>
      {timeAgo(iso)}
    </span>
  );
}

/**
 * Human status — words first, numbers second. Every colour (ring, chip, bar)
 * comes from this one place so they can never drift out of sync:
 *   100%            → hijau  (Selesai)
 *   di/atas target  → biru   (On track)
 *   telat ≤ 7.5%    → kuning (Sedikit telat)
 *   telat > 7.5%    → merah  (Perlu perhatian)
 *   belum mulai     → abu    (Belum mulai)
 */
function statusOf(cum: number, plan: number) {
  if (cum >= 99.95)
    return { label: 'Done', chip: 'bg-emerald-50 text-emerald-700', ring: '#10b981', ringText: '#047857', bar: 'bg-emerald-500' };
  if (cum <= 0.05 && plan <= 0.05)
    return { label: 'Not started', chip: 'bg-gray-100 text-gray-500', ring: '#d1d5db', ringText: '#6b7280', bar: 'bg-gray-300' };
  const gap = cum - plan;
  if (gap >= -1)
    return { label: 'On track', chip: 'bg-blue-50 text-blue-700', ring: '#3b82f6', ringText: '#1d4ed8', bar: 'bg-blue-500' };
  if (gap >= -7.5)
    return { label: 'Slightly behind', chip: 'bg-amber-50 text-amber-700', ring: '#f59e0b', ringText: '#b45309', bar: 'bg-amber-400' };
  return { label: 'Needs attention', chip: 'bg-red-50 text-red-600', ring: '#ef4444', ringText: '#b91c1c', bar: 'bg-red-400' };
}

function gapText(cum: number, plan: number): { text: string; cls: string } {
  const gap = round2(cum - plan);
  if (Math.abs(gap) < 0.05) return { text: 'on target', cls: 'text-gray-500' };
  if (gap >= -1 && gap < 0) return { text: 'nearly on target', cls: 'text-gray-500' };
  if (gap < 0) return { text: `${Math.abs(gap).toFixed(1)}% behind`, cls: 'text-red-500' };
  return { text: `${gap.toFixed(1)}% ahead`, cls: 'text-emerald-600' };
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
  const flatAll = useMemo(() => flattenAll(roots), [roots]);
  // With a single umbrella root, the SPK contracts underneath are the real
  // top-level "folders" users think in.
  const homeNodes = useMemo(
    () => (roots.length === 1 ? visibleChildren(roots[0]) : roots.filter((r) => !isMilestone(r))),
    [roots]
  );
  const pathBase = roots.length === 1 ? 1 : 0;

  const [path, setPath] = useState<RollupNode[]>([]);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const [levelKey, setLevelKey] = useState(0);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [rawInputs, setRawInputs] = useState<Record<string, { cum?: string; plan?: string }>>({});
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());
  const [saving, startSaveTransition] = useTransition();
  const [justSaved, setJustSaved] = useState(false);
  const [barLeaving, setBarLeaving] = useState(false);
  const [query, setQuery] = useState('');
  const [showLog, setShowLog] = useState(false);

  // Re-resolve path nodes after router.refresh() delivers fresh rollups —
  // stale node objects would otherwise keep showing pre-save numbers. Each
  // entry must be a child of the previous one; anything else (e.g. the same
  // node pushed twice by a double-click) is dropped.
  const currentPath = useMemo(() => {
    const resolved: RollupNode[] = [];
    let container = homeNodes;
    for (const p of path) {
      const fresh = container.find((n) => n.id === p.id);
      if (!fresh) continue;
      resolved.push(fresh);
      container = fresh.children;
    }
    return resolved;
  }, [path, homeNodes]);

  const currentNode = currentPath.length ? currentPath[currentPath.length - 1] : null;
  const currentNodes = currentNode ? visibleChildren(currentNode) : homeNodes;
  const dirtyCount = Object.keys(edits).length;

  function navigateInto(node: RollupNode) {
    setDirection('fwd');
    setPath((prev) => (prev[prev.length - 1]?.id === node.id ? prev : [...prev, node]));
    setLevelKey((k) => k + 1);
  }

  function goBack() {
    setDirection('back');
    setPath((prev) => prev.slice(0, -1));
    setLevelKey((k) => k + 1);
  }

  function goToLevel(index: number) {
    // index = -1 means home
    setDirection('back');
    setPath((prev) => prev.slice(0, index + 1));
    setLevelKey((k) => k + 1);
  }

  function jumpToLeaf(leaf: RollupNode) {
    const byChild = new Map<string, RollupNode>();
    flatAll.forEach((p) => p.children.forEach((c) => byChild.set(c.id, p)));
    const chain: RollupNode[] = [];
    let cur = byChild.get(leaf.id);
    while (cur) {
      chain.unshift(cur);
      cur = byChild.get(cur.id);
    }
    setDirection('fwd');
    setPath(chain.slice(pathBase));
    setQuery('');
    setLevelKey((k) => k + 1);
  }

  // Escape = back one level (matches the "folder" mental model).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && path.length && !query) goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [path.length, query]);

  const todayStart = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }, []);

  const sortedLog = useMemo(
    () => [...recentChanges].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()),
    [recentChanges]
  );

  // Single source of truth for "today": the update pill, the New badges and
  // the history divider all read from this one filtered list, so the pill
  // number always matches the entries shown in the Change history panel.
  const todayLog = useMemo(
    () => sortedLog.filter((c) => new Date(c.at).getTime() >= todayStart),
    [sortedLog, todayStart]
  );
  const todayCount = todayLog.length;

  const recentIds = useMemo(() => new Set(todayLog.map((c) => c.leafId)), [todayLog]);

  function currentCum(node: RollupNode): number {
    return round2(edits[node.id]?.cumProgressPct ?? node.curProgressPct);
  }
  function currentPlan(node: RollupNode): number {
    return round2(edits[node.id]?.planPct ?? planPctOf(node));
  }

  function setEdit(id: string, patch: EditState) {
    if (justSaved && !saving) {
      setJustSaved(false);
      setBarLeaving(false);
    }

    setEdits((prev) => {
      const merged = { ...prev[id], ...patch };
      const node = flatAll.find((n) => n.id === id);
      if (node) {
        const cumSame =
          merged.cumProgressPct === undefined || round2(merged.cumProgressPct) === round2(node.curProgressPct);
        const planSame = merged.planPct === undefined || round2(merged.planPct) === round2(planPctOf(node));
        if (cumSame && planSame) {
          const next = { ...prev };
          delete next[id];
          return next;
        }
      }
      return { ...prev, [id]: merged };
    });
  }

  function adjustCum(node: RollupNode, delta: number) {
    const next = clamp(round2(currentCum(node) + delta));
    setEdit(node.id, { cumProgressPct: next });
    setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], cum: String(next) } }));
  }

  function discardAll() {
    setEdits({});
    setRawInputs({});
  }

  function save() {
    if (!dirtyCount || saving) return;
    setJustSaved(false);
    setBarLeaving(false);
    startSaveTransition(async () => {
      const updates: Record<string, { cumProgressPct?: number; targetWF?: number }> = {};
      for (const [id, patch] of Object.entries(edits)) {
        const node = flatAll.find((n) => n.id === id);
        if (!node) continue;
        updates[id] = {};
        if (patch.cumProgressPct !== undefined) updates[id].cumProgressPct = patch.cumProgressPct;
        if (patch.planPct !== undefined) updates[id].targetWF = (node.bobot * patch.planPct) / 100;
      }
      const res = await saveWeekUpdatesAction(week, updates);
      if (!res.ok) {
        alert(res.error);
        return;
      }
      // Drop the transient typing buffer, but KEEP `edits` in place as an
      // optimistic overlay. The reconcile effect below removes each edit once
      // the action's refresh delivers matching server data — so the number
      // never flickers back to its pre-save value ("kesave lalu balik lagi").
      setRawInputs({});
      setJustSaved(true);
    });
  }

  // "Tersimpan ✓" toast timeline: hold the green confirmation briefly, then
  // play the slide-out before unmounting — so the bar never blinks away.
  useEffect(() => {
    if (!justSaved) return;
    const leave = setTimeout(() => setBarLeaving(true), 1400);
    const done = setTimeout(() => {
      setJustSaved(false);
      setBarLeaving(false);
    }, 1700);
    return () => {
      clearTimeout(leave);
      clearTimeout(done);
    };
  }, [justSaved]);

  // A fresh edit made while the "saved" toast is still up brings the
  // unsaved-changes bar straight back.
  useEffect(() => {
    if (dirtyCount > 0 && justSaved && !saving) {
      setJustSaved(false);
      setBarLeaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyCount]);

  // After router.refresh() lands fresh rollups, clear any pending edit that now
  // matches the server. This is what actually ends the "belum disimpan" state —
  // doing it here (instead of immediately in save()) keeps the displayed value
  // steady across the save round-trip.
  useEffect(() => {
    setEdits((prev) => {
      const ids = Object.keys(prev);
      if (ids.length === 0) return prev;
      let changed = false;
      const next: Record<string, EditState> = {};
      for (const id of ids) {
        const node = flatAll.find((n) => n.id === id);
        if (!node) {
          next[id] = prev[id];
          continue;
        }
        const e = prev[id];
        const cumSame = e.cumProgressPct === undefined || round2(e.cumProgressPct) === round2(node.curProgressPct);
        const planSame = e.planPct === undefined || round2(e.planPct) === round2(planPctOf(node));
        if (cumSame && planSame) changed = true; // matched server → drop it
        else next[id] = prev[id];
      }
      return changed ? next : prev;
    });
  }, [flatAll]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return flatAll
      .filter((n) => n.children.length === 0 && !isMilestone(n) && n.deskripsi.toLowerCase().includes(q))
      .slice(0, 20);
  }, [flatAll, query]);

  const ancestorsOf = useMemo(() => {
    const byChild = new Map<string, RollupNode>();
    flatAll.forEach((p) => p.children.forEach((c) => byChild.set(c.id, p)));
    return (id: string): RollupNode[] => {
      const chain: RollupNode[] = [];
      let cur = byChild.get(id);
      while (cur) {
        chain.unshift(cur);
        cur = byChild.get(cur.id);
      }
      return chain.slice(pathBase);
    };
  }, [flatAll, pathBase]);

  const leafProps = {
    week,
    recentIds,
    recentChanges,
    edits,
    rawInputs,
    detailOpen,
    currentCum,
    currentPlan,
    setEdit,
    setRawInputs,
    adjustCum,
    toggleDetail: (id: string) =>
      setDetailOpen((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
  };

  return (
    <div>
      {/* Top bar: search + today's changes — mirrors the 4-column stat grid
         above so the search lines up under Plan→This Week and the update pill
         sits under Deviation. */}
      <div className="grid grid-cols-1 gap-2 sm:gap-4 lg:grid-cols-4">
        <div className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-3 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-shadow focus-within:shadow-md lg:col-span-3">
          <svg className="h-[18px] w-[18px] shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search an activity…"
            className="w-full border-none bg-transparent text-[14px] text-gray-900 outline-none placeholder:text-gray-400"
          />
          {query && (
            <button onClick={() => setQuery('')} className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="Clear search">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          onClick={() => setShowLog((v) => !v)}
          disabled={recentChanges.length === 0}
          className={`flex w-full items-center gap-2.5 rounded-2xl border bg-white px-3 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-all lg:col-span-1 ${
            recentChanges.length > 0
              ? 'cursor-pointer hover:border-gray-300 hover:shadow-md active:scale-[0.98]'
              : 'cursor-default'
          } ${showLog ? 'border-blue-300 ring-2 ring-blue-100' : 'border-gray-200'}`}
        >
          {/* Dot sits in an 18px slot so its text starts at the exact same x as
             the search input's text (which leads with an 18px magnifier). */}
          <span className="flex w-[18px] shrink-0 items-center justify-center">
            <span suppressHydrationWarning className={`h-2 w-2 rounded-full ${todayCount > 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} />
          </span>
          {/* "Today" is the viewer's local midnight, which the server can't
             know — suppress the one-off SSR/client text mismatch. */}
          <span suppressHydrationWarning className="flex-1 text-left text-[14px] text-gray-600">
            {todayCount > 0 ? (
              <><span className="font-semibold text-gray-900">{todayCount} {todayCount === 1 ? 'update' : 'updates'}</span> today</>
            ) : (
              'No updates today yet'
            )}
          </span>
          {recentChanges.length > 0 && (
            <span className="ml-auto text-[12px] text-gray-400 sm:hidden">View</span>
          )}
          {recentChanges.length > 0 && (
            <svg
              className="h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300"
              style={{ transform: showLog ? 'rotate(180deg)' : 'rotate(0deg)' }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          )}
        </button>
      </div>

      {/* Change log panel */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${showLog ? 'mt-3' : 'mt-0'}`}
        style={{ gridTemplateRows: showLog ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-col gap-1 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3.5">
              <div className="text-[14px] font-semibold text-gray-900">Change history · Week {week}</div>
              <div suppressHydrationWarning className="text-[12px] text-gray-500">
                {todayCount > 0 && <span className="font-medium text-emerald-600">{todayCount} today · </span>}
                {sortedLog.length} {sortedLog.length === 1 ? 'update' : 'updates'} recorded
              </div>
            </div>
            <div className="max-h-[70vh] sm:max-h-96 overflow-y-auto overscroll-contain divide-y divide-gray-100">
              {sortedLog.map((c, i) => {
                const leaf = flatAll.find((n) => n.id === c.leafId);
                const delta = round2(c.newValue - c.oldValue);
                const isToday = new Date(c.at).getTime() >= todayStart;
                const showDivider = i > 0 && isTodayAt(sortedLog[i - 1].at, todayStart) && !isToday;
                return (
                  <div key={c.id}>
                    {showDivider && (
                      <div className="bg-gray-50/80 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                        Earlier
                      </div>
                    )}
                    <button
                      onClick={() => {
                        if (leaf) {
                          jumpToLeaf(leaf);
                          setShowLog(false);
                        }
                      }}
                      disabled={!leaf}
                      className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-blue-50/40 disabled:pointer-events-none"
                    >
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
                          delta > 0 ? 'bg-emerald-50 text-emerald-600' : delta < 0 ? 'bg-red-50 text-red-500' : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {delta > 0 ? '↑' : delta < 0 ? '↓' : '·'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-medium text-gray-900">
                            {leaf?.deskripsi ?? 'Activity not found'}
                          </span>
                          <span suppressHydrationWarning className="shrink-0 text-[11px] text-gray-400">{timeAgo(c.at)}</span>
                        </span>
                        <span className="mt-1 flex items-center gap-1.5 text-[12px] text-gray-500">
                          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                            c.field === 'cumProgressPct' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'
                          }`}>
                            {c.field === 'cumProgressPct' ? 'Actual' : 'Target'}
                          </span>
                          <span className="font-medium tabular-nums text-gray-700">{c.oldValue.toFixed(1)}%</span>
                          <span className="text-gray-400">→</span>
                          <span className="font-medium tabular-nums text-gray-700">{c.newValue.toFixed(1)}%</span>
                          <span className={`font-semibold tabular-nums ${delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                            ({delta > 0 ? '+' : ''}{delta.toFixed(1)}%)
                          </span>
                        </span>
                      </span>
                      {leaf && (
                        <svg className="mt-1 h-4 w-4 shrink-0 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
              {sortedLog.length === 0 && (
                <div className="px-5 py-8 text-center text-[13px] text-gray-500">No updates recorded this week yet.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Search results replace the browser */}
      {searchResults ? (
        <div className="mt-3 space-y-2.5 animate-fade-in">
          <div className="px-1 text-[13px] text-gray-500">
            {searchResults.length === 0
              ? 'No matching activities.'
              : `${searchResults.length} ${searchResults.length === 1 ? 'activity' : 'activities'} found`}
          </div>
          {searchResults.map((leaf) => (
            <div key={leaf.id} className="animate-fade-in-up">
              <button
                onClick={() => jumpToLeaf(leaf)}
                className="mb-1 flex items-center gap-1.5 px-1 text-[12px] text-gray-500 hover:text-blue-600"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                {ancestorsOf(leaf.id).map((a) => shortName(a.deskripsi)).join(' › ') || 'Top level'}
                <span className="text-blue-500">· open folder</span>
              </button>
              <LeafCard node={leaf} {...leafProps} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Breadcrumb + level header */}
          {currentPath.length > 0 && (
            <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm animate-fade-in">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <button
                  onClick={goBack}
                  className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-medium text-gray-600 transition-all hover:text-blue-600 active:scale-[0.96]"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
                <span className="mx-1 text-gray-300">|</span>
                <button onClick={() => goToLevel(-1)} className="text-gray-500 transition-colors hover:text-blue-600">
                  All contracts
                </button>
                {currentPath.map((p, i) => (
                  <span key={p.id} className="flex items-center gap-2">
                    <span className="text-gray-300">›</span>
                    {i === currentPath.length - 1 ? (
                      <span className="font-semibold text-gray-900">{shortName(p.deskripsi)}</span>
                    ) : (
                      <button onClick={() => goToLevel(i)} className="text-gray-500 transition-colors hover:text-blue-600">
                        {shortName(p.deskripsi)}
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {currentNode && (
                <div className="mt-3 flex items-center gap-4">
                  <Ring
                    pct={currentCumOf(currentNode, edits)}
                    color={statusOf(currentCumOf(currentNode, edits), round2(planPctOf(currentNode))).ring}
                    textColor={statusOf(currentCumOf(currentNode, edits), round2(planPctOf(currentNode))).ringText}
                    size={48}
                  />
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-lg font-semibold text-gray-900">{currentNode.deskripsi}</h2>
                    <p className="mt-0.5 text-[13px] text-gray-500">
                      {leafCount(currentNode)} activities · Weight {currentNode.bobot.toFixed(2)}% ·{' '}
                      Target {round2(planPctOf(currentNode)).toFixed(1)}% ·{' '}
                      <span className={gapText(round2(currentNode.curProgressPct), round2(planPctOf(currentNode))).cls}>
                        {gapText(round2(currentNode.curProgressPct), round2(planPctOf(currentNode))).text}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Level cards — keyed so each navigation replays the slide animation */}
          <div key={levelKey} className={`mt-3 ${direction === 'fwd' ? 'animate-level-fwd' : 'animate-level-back'}`}>
            <div className="space-y-2.5">
              {currentNodes.map((node, idx) =>
                node.children.length > 0 ? (
                  <FolderCard
                    key={node.id}
                    node={node}
                    index={idx}
                    onOpen={() => navigateInto(node)}
                    cum={round2(node.curProgressPct)}
                    plan={round2(planPctOf(node))}
                  />
                ) : (
                  <div key={node.id} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(idx, 8) * 30}ms` }}>
                    <LeafCard node={node} {...leafProps} />
                  </div>
                )
              )}
              {currentNodes.length === 0 && (
                <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 py-10 text-center text-sm text-gray-500">
                  No activities at this level.
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Floating save bar — morphs through belum disimpan → menyimpan → tersimpan */}
      {(dirtyCount > 0 || justSaved) && (
        <div
          className={`sticky bottom-3 z-30 px-1 sm:bottom-4 sm:px-0 ${
            barLeaving ? 'animate-save-out' : 'animate-fade-in-up'
          }`}
        >
          <div
            className={`mx-auto flex max-w-xl flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur transition-colors duration-300 sm:px-5 sm:py-3.5 ${
              justSaved ? 'border-emerald-200 bg-emerald-50/95' : 'border-gray-200 bg-white/95'
            }`}
          >
            {justSaved ? (
              <div className="flex items-center gap-2.5 text-[14px] font-semibold text-emerald-700">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white animate-pop-in">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path className="animate-check-draw" strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                Changes saved
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2.5 text-[14px] text-gray-700">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-[12px] font-bold text-amber-800">
                    {dirtyCount}
                  </span>
                  {dirtyCount === 1 ? 'unsaved change' : 'unsaved changes'}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={discardAll}
                    disabled={saving}
                    className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={save}
                    disabled={saving}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-[13px] font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md active:scale-[0.97] disabled:pointer-events-none disabled:opacity-70"
                  >
                    {saving && (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function currentCumOf(node: RollupNode, edits: Record<string, EditState>): number {
  return round2(edits[node.id]?.cumProgressPct ?? node.curProgressPct);
}

/** Trim long WBS descriptions for breadcrumbs. */
function shortName(s: string): string {
  return s.length > 28 ? s.slice(0, 26).trimEnd() + '…' : s;
}

function isTodayAt(iso: string, todayStart: number): boolean {
  return new Date(iso).getTime() >= todayStart;
}

// ============================================================================

function Ring({ pct, color, textColor, size = 56 }: { pct: number; color: string; textColor: string; size?: number }) {
  const stroke = size >= 56 ? 6 : 5;
  const r = size / 2 - stroke - 1;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp(pct) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F3F4F6" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.4s' }}
      />
      <text
        x={size / 2}
        y={size / 2 + 4.5}
        textAnchor="middle"
        fontSize={size >= 56 ? 13 : 12}
        fontWeight={600}
        fill={textColor}
      >
        {Math.round(pct)}
      </text>
    </svg>
  );
}

const FolderCard = memo(function FolderCard({
  node, index, onOpen, cum, plan,
}: {
  node: RollupNode;
  index: number;
  onOpen: () => void;
  cum: number;
  plan: number;
}) {
  const st = statusOf(cum, plan);
  const gap = gapText(cum, plan);
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition-all duration-300 ease-ios hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md active:scale-[0.99] animate-fade-in-up"
      style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }}
    >
      <Ring pct={cum} color={st.ring} textColor={st.ringText} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-gray-900">{node.deskripsi}</div>
        <div className="mt-1 text-[13px] text-gray-500">
          {leafCount(node)} activities · Target {plan.toFixed(1)}% ·{' '}
          <span className={gap.cls}>{gap.text}</span>
        </div>
      </div>
      <span className={`hidden shrink-0 rounded-full px-3 py-1 text-[12px] font-medium sm:inline ${st.chip}`}>
        {st.label}
      </span>
      <svg
        className="h-5 w-5 shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-blue-500"
        fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
});

// ============================================================================

interface LeafCardProps {
  node: RollupNode;
  week: number;
  recentIds: Set<string>;
  recentChanges: ChangeLogEntry[];
  edits: Record<string, EditState>;
  rawInputs: Record<string, { cum?: string; plan?: string }>;
  detailOpen: Set<string>;
  currentCum: (n: RollupNode) => number;
  currentPlan: (n: RollupNode) => number;
  setEdit: (id: string, patch: EditState) => void;
  setRawInputs: React.Dispatch<React.SetStateAction<Record<string, { cum?: string; plan?: string }>>>;
  adjustCum: (n: RollupNode, delta: number) => void;
  toggleDetail: (id: string) => void;
}

const LeafCard = memo(function LeafCard({
  node, week, recentIds, recentChanges, edits, rawInputs, detailOpen,
  currentCum, currentPlan, setEdit, setRawInputs, adjustCum, toggleDetail,
}: LeafCardProps) {
  const cum = currentCum(node);
  const plan = currentPlan(node);
  const isDirty = !!edits[node.id];
  const isRecent = recentIds.has(node.id);
  const isDone = cum >= 99.95 && !isDirty;
  const showDetail = detailOpen.has(node.id);
  const gap = gapText(cum, plan);
  const st = statusOf(cum, plan);
  const thisWeek = round2(cum - node.prevProgressPct);

  const history = useMemo(
    () =>
      recentChanges
        .filter((c) => c.leafId === node.id)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
        .slice(0, 4),
    [recentChanges, node.id]
  );

  // Colour is centralised in statusOf so the bar always matches the ring/chip.
  const barColor = st.bar;

  return (
    <div
      className={`rounded-2xl border bg-white px-5 py-4 shadow-sm transition-all duration-300 ${
        isDirty ? 'border-amber-300 ring-2 ring-amber-100' : 'border-gray-200'
      } ${isDone ? 'opacity-70 hover:opacity-100' : ''}`}
    >
      {/* Title row — stepper wraps below the name on narrow screens */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[55%] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold leading-snug text-gray-900">{node.deskripsi}</span>
            {isDone && (
              <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {isRecent && !isDirty && (
              <span className="shrink-0 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">New</span>
            )}
            {isDirty && (
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Unsaved</span>
            )}
          </div>
        </div>

        {/* Stepper */}
        {isDone ? (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-700">100%</span>
            <button
              onClick={() => adjustCum(node, -5)}
              className="rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
              title="Correct value"
              aria-label="Correct value"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <StepBtn onClick={() => adjustCum(node, -5)} label="Decrease 5%">−</StepBtn>
            <input
              type="text"
              inputMode="decimal"
              value={rawInputs[node.id]?.cum ?? cum.toFixed(cum % 1 === 0 ? 0 : 1)}
              onChange={(e) => {
                const raw = e.target.value;
                setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], cum: raw } }));
                const parsed = parseInput(raw, round2(node.curProgressPct));
                if (parsed !== null) setEdit(node.id, { cumProgressPct: parsed });
              }}
              onBlur={() => setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], cum: undefined } }))}
              className="h-10 w-[72px] rounded-xl border border-gray-300 bg-white text-center text-[15px] font-semibold tabular-nums text-gray-900 transition-all focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-100"
            />
            <span className="text-[13px] font-medium text-gray-400">%</span>
            <StepBtn onClick={() => adjustCum(node, 5)} label="Increase 5%">+</StepBtn>
          </div>
        )}
      </div>

      {/* Bars + meta (hidden for completed to keep them calm) */}
      {!isDone && (
        <>
          {/* One clean fill in the status colour, with a tick marking the
             target — no more stacked orange layer that read as a second bar. */}
          <div className="relative mt-3.5 h-2.5 rounded-full bg-gray-100">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${clamp(cum)}%` }}
            />
            {plan > 0.5 && plan < 99.5 && (
              <div
                className="absolute -top-[3px] h-4 w-0.5 rounded-full bg-gray-600/70"
                style={{ left: `calc(${clamp(plan)}% - 1px)` }}
                title={`Target ${plan.toFixed(1)}%`}
              />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-gray-500">
            <span>
              Last week <span className="font-medium text-gray-700">{node.prevProgressPct.toFixed(1)}%</span>
              {thisWeek !== 0 && (
                <span className={thisWeek > 0 ? 'text-emerald-600' : 'text-red-500'}>
                  {' '}({thisWeek > 0 ? '+' : ''}{thisWeek.toFixed(1)}%)
                </span>
              )}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              Target <span className="font-medium text-gray-700">{plan.toFixed(1)}%</span>
              <span className={gap.cls}>· {gap.text}</span>
              <DetailToggle open={showDetail} onClick={() => toggleDetail(node.id)} />
            </span>
          </div>
        </>
      )}
      {isDone && (
        <div className="mt-1.5 flex items-center justify-end">
          <DetailToggle open={showDetail} onClick={() => toggleDetail(node.id)} />
        </div>
      )}

      {/* Expandable detail */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: showDetail ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="mt-3.5 space-y-4 rounded-xl bg-gray-50 p-4">
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-3">
              <Field label="Edit target (plan)">
                <div className="mt-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={rawInputs[node.id]?.plan ?? plan.toFixed(plan % 1 === 0 ? 0 : 1)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], plan: raw } }));
                      const parsed = parseInput(raw, round2(planPctOf(node)));
                      if (parsed !== null) setEdit(node.id, { planPct: parsed });
                    }}
                    onBlur={() => setRawInputs((prev) => ({ ...prev, [node.id]: { ...prev[node.id], plan: undefined } }))}
                    className="h-9 w-[70px] rounded-lg border border-gray-300 bg-white text-center text-[13px] font-semibold tabular-nums text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <span className="text-[12px] text-gray-400">%</span>
                </div>
              </Field>
              <Field label="WBS Code" value={node.wbsCode} />
              <Field label="Weight" value={`${node.bobot.toFixed(3)}%`} sub="of the whole project" />
              <Field label="Contribution to total" value={`${round2((node.bobot * cum) / 100).toFixed(3)}%`} sub={`${cum.toFixed(1)}% × ${node.bobot.toFixed(2)}%`} />
              <Field label="Volume" value={node.vol && node.satuan ? `${node.vol} ${node.satuan}` : '—'} />
              <Field label={`Last week (W${week - 1})`} value={`${node.prevProgressPct.toFixed(2)}%`} />
            </div>
            {history.length > 0 && (
              <div className="border-t border-gray-200 pt-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">History</div>
                <div className="space-y-1.5">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center gap-2 text-[12px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${h.field === 'cumProgressPct' ? 'bg-blue-500' : 'bg-orange-400'}`} />
                      <span className="font-medium tabular-nums text-gray-800">
                        {h.field === 'cumProgressPct' ? 'Actual' : 'Plan'} {h.oldValue.toFixed(1)}% → {h.newValue.toFixed(1)}%
                      </span>
                      <span suppressHydrationWarning className="text-gray-400">· {timeAgo(h.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function StepBtn({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-200 bg-white text-lg font-medium text-gray-600 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:scale-90"
    >
      {children}
    </button>
  );
}

function DetailToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
    >
      Details
      <svg
        className="h-3.5 w-3.5 transition-transform duration-300"
        style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
        fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function Field({ label, value, sub, children }: { label: string; value?: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      {children ?? (
        <>
          <div className="mt-0.5 text-[13px] font-semibold text-gray-900">{value}</div>
          {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
        </>
      )}
    </div>
  );
}
