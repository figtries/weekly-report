'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RollupNode } from '@/lib/rollup';
import { computeGrandTotal } from '@/lib/rollup';
import AnimatedNumber from '@/components/ui/AnimatedNumber';

/* ---------------------------------------------------------------------------
 * Detail Progress — the read-only "full story" of the data entered in Data
 * Overall. It deliberately shares Data Overall's design language (status words,
 * colours, folder drill-down, easing) so the two pages feel like one product:
 * Data Overall is where you *edit*, Detail Progress is where you *read*.
 * ------------------------------------------------------------------------- */

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

/** "100%" not "100.00%"; keep one decimal only when it carries information. */
function pct(v: number): string {
  const r = Math.abs(v) < 0.05 ? 0 : v;
  const near = Math.round(r);
  return Math.abs(r - near) < 0.05 ? `${near}%` : `${r.toFixed(1)}%`;
}

/**
 * The one source of truth for status — same thresholds & colours as Data
 * Overall, so an activity that reads "Needs attention" there reads the same
 * here. Words first, numbers second.
 */
function statusOf(cum: number, plan: number) {
  if (cum >= 99.95)
    return { key: 'done', label: 'Done', chip: 'bg-emerald-50 text-emerald-700', ring: '#10b981', ringText: '#047857', bar: 'bg-emerald-500' };
  if (cum <= 0.05 && plan <= 0.05)
    return { key: 'idle', label: 'Not started', chip: 'bg-gray-100 text-gray-500', ring: '#d1d5db', ringText: '#6b7280', bar: 'bg-gray-300' };
  const gap = cum - plan;
  if (gap >= -1)
    return { key: 'ontrack', label: 'On track', chip: 'bg-blue-50 text-blue-700', ring: '#3b82f6', ringText: '#1d4ed8', bar: 'bg-blue-500' };
  if (gap >= -7.5)
    return { key: 'slight', label: 'Slightly behind', chip: 'bg-amber-50 text-amber-700', ring: '#f59e0b', ringText: '#b45309', bar: 'bg-amber-400' };
  return { key: 'behind', label: 'Needs attention', chip: 'bg-red-50 text-red-600', ring: '#ef4444', ringText: '#b91c1c', bar: 'bg-red-400' };
}

function gapText(cum: number, plan: number): { text: string; cls: string } {
  const gap = round2(cum - plan);
  if (Math.abs(gap) < 0.05) return { text: 'on plan', cls: 'text-gray-500' };
  if (gap >= -1 && gap < 0) return { text: 'nearly on plan', cls: 'text-gray-500' };
  if (gap < 0) return { text: `${Math.abs(gap).toFixed(1)}% behind`, cls: 'text-red-500' };
  return { text: `${gap.toFixed(1)}% ahead`, cls: 'text-emerald-600' };
}

/* The behind/ahead verdict, always uppercase in its status colour. From sm up
 * it stays inline at the end of the meta line; on phones it moves to its own
 * bottom row instead of wrapping mid-sentence. */
function GapInline({ cum, plan }: { cum: number; plan: number }) {
  const gap = gapText(cum, plan);
  return <span className={`hidden font-semibold uppercase sm:inline ${gap.cls}`}> · {gap.text}</span>;
}

function GapBottomRow({ cum, plan, className = 'mt-1' }: { cum: number; plan: number; className?: string }) {
  const gap = gapText(cum, plan);
  return <div className={`text-[12px] font-bold uppercase tracking-wide sm:hidden ${gap.cls} ${className}`}>{gap.text}</div>;
}

/** One plain-language sentence describing where an activity stands. */
function storyOf(cum: number, plan: number, thisWeek: number): string {
  const st = statusOf(cum, plan);
  if (st.key === 'done') return 'This activity is fully complete.';
  if (st.key === 'idle') return 'This activity has not started yet.';
  const gap = round2(cum - plan);
  const moved = thisWeek > 0.05 ? ` Up ${thisWeek.toFixed(1)}% this week.` : ' No progress this week.';
  if (gap >= 0) return `Ahead of plan — all good.${moved}`;
  if (gap >= -1) return `Almost at plan.${moved}`;
  if (gap >= -7.5) return `${Math.abs(gap).toFixed(1)}% behind plan — needs a push.${moved}`;
  return `${Math.abs(gap).toFixed(1)}% behind plan — needs attention.${moved}`;
}

function shortName(s: string): string {
  return s.length > 30 ? s.slice(0, 28).trimEnd() + '…' : s;
}

const STATUS_ORDER = ['done', 'ontrack', 'slight', 'behind', 'idle'] as const;
const STATUS_LEGEND: Record<string, { label: string; bar: string; dot: string; text: string; chip: string }> = {
  done: { label: 'Done', bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700' },
  ontrack: { label: 'On track', bar: 'bg-blue-500', dot: 'bg-blue-500', text: 'text-blue-700', chip: 'bg-blue-50 text-blue-700' },
  slight: { label: 'Slightly behind', bar: 'bg-amber-400', dot: 'bg-amber-400', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-700' },
  behind: { label: 'Warning', bar: 'bg-red-400', dot: 'bg-red-500', text: 'text-red-600', chip: 'bg-red-50 text-red-600' },
  idle: { label: 'Not started', bar: 'bg-gray-300', dot: 'bg-gray-300', text: 'text-gray-500', chip: 'bg-gray-100 text-gray-500' },
};

// ============================================================================

export default function WbsTreeVisual({ roots }: { roots: RollupNode[] }) {
  const flatAll = useMemo(() => flattenAll(roots), [roots]);

  // With a single umbrella root the SPK contracts underneath are the folders
  // users actually think in — mirror Data Overall's home resolution exactly.
  const homeNodes = useMemo(
    () => (roots.length === 1 ? visibleChildren(roots[0]) : roots.filter((r) => !isMilestone(r))),
    [roots]
  );
  const pathBase = roots.length === 1 ? 1 : 0;
  const grand = useMemo(() => computeGrandTotal(roots), [roots]);

  const [path, setPath] = useState<RollupNode[]>([]);
  const [direction, setDirection] = useState<'fwd' | 'back'>('fwd');
  const [levelKey, setLevelKey] = useState(0);
  const [detailOpen, setDetailOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');

  // Re-resolve path against fresh roots after any router.refresh(); each entry
  // must be a child of the previous one.
  const currentPath = useMemo(() => {
    const resolved: RollupNode[] = [];
    let container = homeNodes;
    for (const p of path) {
      const fresh = container.find((n) => n.id === p.id);
      if (!fresh) break;
      resolved.push(fresh);
      container = fresh.children;
    }
    return resolved;
  }, [path, homeNodes]);

  const currentNode = currentPath.length ? currentPath[currentPath.length - 1] : null;
  const currentNodes = currentNode ? visibleChildren(currentNode) : homeNodes;

  // Status distribution across every leaf — powers the overview strip.
  const dist = useMemo(() => {
    const counts: Record<string, number> = { done: 0, ontrack: 0, slight: 0, behind: 0, idle: 0 };
    flatAll.forEach((n) => {
      if (n.children.length === 0 && !isMilestone(n)) {
        counts[statusOf(round2(n.curProgressPct), round2(planPctOf(n))).key]++;
      }
    });
    const total = STATUS_ORDER.reduce((s, k) => s + counts[k], 0);
    return { counts, total };
  }, [flatAll]);

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
    setDirection('back');
    setPath((prev) => prev.slice(0, index + 1));
    setLevelKey((k) => k + 1);
  }
  function jumpToLeaf(leaf: RollupNode) {
    const byChild = new Map<string, RollupNode>();
    flatAll.forEach((p) => p.children.forEach((c) => byChild.set(c.id, p)));
    const chain: RollupNode[] = [];
    let cur: RollupNode | undefined = byChild.get(leaf.id);
    while (cur) {
      chain.unshift(cur);
      cur = byChild.get(cur.id);
    }
    setDirection('fwd');
    setPath(chain.slice(pathBase));
    setQuery('');
    setDetailOpen((prev) => new Set(prev).add(leaf.id));
    setLevelKey((k) => k + 1);
  }

  // Escape steps back one level (the "folder" mental model).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && path.length && !query) goBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path.length, query]);

  const ancestorsOf = useMemo(() => {
    const byChild = new Map<string, RollupNode>();
    flatAll.forEach((p) => p.children.forEach((c) => byChild.set(c.id, p)));
    return (id: string): RollupNode[] => {
      const chain: RollupNode[] = [];
      let cur: RollupNode | undefined = byChild.get(id);
      while (cur) {
        chain.unshift(cur);
        cur = byChild.get(cur.id);
      }
      return chain.slice(pathBase);
    };
  }, [flatAll, pathBase]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return flatAll
      .filter((n) => n.children.length === 0 && !isMilestone(n) && n.deskripsi.toLowerCase().includes(q))
      .slice(0, 20);
  }, [flatAll, query]);

  const toggleDetail = (id: string) =>
    setDetailOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="flex items-center gap-2.5 rounded-2xl border border-gray-200 bg-white px-3 py-3 sm:px-5 sm:py-3.5 shadow-sm transition-shadow focus-within:shadow-md">
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

      {searchResults ? (
        /* Search replaces the browser */
        <div className="space-y-2.5 animate-fade-in">
          <div className="px-1 text-[13px] text-gray-500">
            {searchResults.length === 0 ? 'No matching activities.' : `${searchResults.length} ${searchResults.length === 1 ? 'activity' : 'activities'} found`}
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
                <span className="text-blue-500">· open location</span>
              </button>
              <LeafCard node={leaf} open={detailOpen.has(leaf.id)} onToggle={() => toggleDetail(leaf.id)} />
            </div>
          ))}
        </div>
      ) : currentPath.length === 0 ? (
        /* HOME — big-picture overview + contract folders */
        <>
          <OverviewHero grand={grand} dist={dist} />
          <div key={levelKey} className={direction === 'fwd' ? 'animate-level-fwd' : 'animate-level-back'}>
            <p className="mb-2.5 px-1 text-[13px] font-medium text-gray-500">
              {homeNodes.length} {homeNodes.length === 1 ? 'contract' : 'contracts'} · click to explore
            </p>
            <div className="space-y-2.5">
              {homeNodes.map((node, idx) => (
                <FolderCard key={node.id} node={node} index={idx} onOpen={() => navigateInto(node)} />
              ))}
            </div>
          </div>
        </>
      ) : (
        /* DRILLED IN — breadcrumb + current folder header + children */
        <>
          <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm animate-fade-in">
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
                  pct={round2(currentNode.curProgressPct)}
                  color={statusOf(round2(currentNode.curProgressPct), round2(planPctOf(currentNode))).ring}
                  textColor={statusOf(round2(currentNode.curProgressPct), round2(planPctOf(currentNode))).ringText}
                  size={52}
                />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold text-gray-900">{currentNode.deskripsi}</h2>
                  <p className="mt-0.5 text-[13px] text-gray-500">
                    {leafCount(currentNode)} activities · Weight {currentNode.bobot.toFixed(2)}% · Plan{' '}
                    {round2(planPctOf(currentNode)).toFixed(1)}%
                    <GapInline cum={round2(currentNode.curProgressPct)} plan={round2(planPctOf(currentNode))} />
                  </p>
                  <GapBottomRow cum={round2(currentNode.curProgressPct)} plan={round2(planPctOf(currentNode))} />
                </div>
              </div>
            )}
          </div>

          <div key={levelKey} className={direction === 'fwd' ? 'animate-level-fwd' : 'animate-level-back'}>
            <div className="space-y-2.5">
              {currentNodes.map((node, idx) =>
                node.children.length > 0 ? (
                  <FolderCard key={node.id} node={node} index={idx} onOpen={() => navigateInto(node)} />
                ) : (
                  <div key={node.id} className="animate-fade-in-up" style={{ animationDelay: `${idx * 40}ms` }}>
                    <LeafCard node={node} open={detailOpen.has(node.id)} onToggle={() => toggleDetail(node.id)} />
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

      <p className="px-1 text-[11px] text-gray-400">
        This page is read-only — change the numbers in{' '}
        <span className="font-medium text-blue-600">Data Overall</span> and they appear here automatically.
      </p>
    </div>
  );
}

// ============================================================================
// Overview hero — the "big picture first" the whole page opens on. Each figure
// is stated exactly once, and every zone of the card carries weight: a header
// line with the verdict chip, a ring gauge that owns the headline number (its
// grey under-arc marks the plan position), the status distribution as a thick
// Storage-style meter (macOS) with a plain left-aligned dot legend, and a
// divided Actual/Plan/Deviation/This week rail. On phones the gauge and rail
// pair up side by side; on desktop they bookend the meter so the card fills
// its full width.

function OverviewHero({
  grand,
  dist,
}: {
  grand: ReturnType<typeof computeGrandTotal>;
  dist: { counts: Record<string, number>; total: number };
}) {
  const actual = round2(grand.curProgressPct);
  const plan = grand.bobot > 0 ? round2((grand.targetWF / grand.bobot) * 100) : 0;
  const st = statusOf(actual, plan);
  const thisWeek = round2(grand.thisWeekProgressPct);
  const dev = round2(actual - plan);
  const devCls = Math.abs(dev) < 0.05 ? 'text-gray-700' : dev < 0 ? 'text-red-500' : 'text-emerald-600';
  const devText = Math.abs(dev) < 0.05 ? '0%' : `${dev < 0 ? '−' : '+'}${Math.abs(dev).toFixed(1)}%`;

  const legendKeys = STATUS_ORDER.filter((k) => dist.counts[k] > 0);

  return (
    <section className="animate-fade-in-up overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-5 shadow-sm sm:p-6">
      {/* Header line — what this card is, and the project's verdict */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-400">Overall project progress</p>
          <span className={`rounded-full px-3 py-1 text-[13px] font-semibold ${st.chip}`}>{st.label}</span>
        </div>
        {dist.total > 0 && (
          <p className="shrink-0 text-[12px] font-medium tabular-nums text-gray-400">{dist.total} activities</p>
        )}
      </div>

      {/* Body — gauge · distribution meter · plan rail */}
      <div className="mt-5 flex flex-col gap-6 md:flex-row md:items-center md:gap-8 lg:gap-10">
        {/* On phones the gauge and rail share a row; from tablet (md) up they
           bookend the meter — a full-width rail spreads label and value too
           far apart to scan */}
        <div className="flex items-center gap-6 md:contents">
          <HeroGauge actual={actual} plan={plan} color={st.ring} textColor={st.ringText} />

          <div className="min-w-0 flex-1 divide-y divide-gray-200 md:order-3 md:w-56 md:flex-none">
            <RailStat label="Actual" value={`${actual.toFixed(1)}%`} />
            <RailStat label="Plan" value={`${plan.toFixed(1)}%`} />
            <RailStat label="Deviation" value={devText} valueCls={devCls} />
            {thisWeek > 0.05 && <RailStat label="This week" value={`+${thisWeek.toFixed(1)}%`} valueCls="text-emerald-600" />}
          </div>
        </div>

        {dist.total > 0 && (
          <div className="min-w-0 flex-1 md:order-2">
            <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Activity status</p>
            {/* Storage-style meter: one thick clipped track, segments packed
               edge to edge with hairline seams — the container owns the
               (slightly rounder-than-macOS) corners */}
            <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-[10px] sm:h-9">
              {legendKeys.map((k, i) => (
                <div
                  key={k}
                  className={`${STATUS_LEGEND[k].bar} animate-bar-grow h-full`}
                  style={{
                    width: `${Math.max(0.8, (dist.counts[k] / dist.total) * 100)}%`,
                    animationDelay: `${200 + i * 110}ms`,
                  }}
                  title={`${STATUS_LEGEND[k].label}: ${dist.counts[k]}`}
                />
              ))}
            </div>
            {/* Legend is a fixed 2-column grid at EVERY size — flex-wrap left
               ragged rows on phones and a lone wrapped item on tablets. The
               right column is content-sized and hugs the bar's right end; its
               items spread dot+label left / count right inside it, so the dots
               stack in a straight line AND the counts stay flush with the bar.
               Items never wrap internally. */}
            <div className="mt-2.5 grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
              {legendKeys.map((k, i) => (
                <span
                  key={k}
                  className="animate-fade-in-up flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium text-gray-600 even:justify-between"
                  style={{ animationDelay: `${350 + i * 70}ms` }}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_LEGEND[k].dot}`} />
                    {STATUS_LEGEND[k].label}
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900">{dist.counts[k]}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The headline number's one home: a ring gauge whose grey under-arc ends at
 *  the target, so actual-vs-plan is visible as a shortfall in the sweep. */
function HeroGauge({ actual, plan, color, textColor }: { actual: number; plan: number; color: string; textColor: string }) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const size = 128;
  const stroke = 11;
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const arc = (v: number) => `${(clamp(v) / 100) * c} ${c}`;
  const done = actual >= 99.95;
  return (
    <div className="relative h-28 w-28 shrink-0 sm:h-32 sm:w-32">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        {!done && plan > 0.5 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#d1d5db" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={arc(drawn ? plan : 0)}
            style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
        )}
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={arc(drawn ? actual : 0)}
          style={{ transition: 'stroke-dasharray 1.1s cubic-bezier(0.16, 1, 0.3, 1) 0.15s, stroke 0.4s' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[24px] font-semibold tracking-tight tabular-nums sm:text-[26px]" style={{ color: textColor }}>
          <AnimatedNumber value={actual} decimals={1} suffix="%" />
        </span>
      </div>
    </div>
  );
}

function RailStat({ label, value, valueCls = 'text-gray-900' }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className={`text-[15px] font-semibold tabular-nums lg:text-base ${valueCls}`}>{value}</span>
    </div>
  );
}

// ============================================================================

function Ring({ pct: value, color, textColor, size = 56 }: { pct: number; color: string; textColor: string; size?: number }) {
  const stroke = size >= 56 ? 6 : 5;
  const r = size / 2 - stroke - 1;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp(value) / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#F3F4F6" strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.4s' }}
      />
      <text x={size / 2} y={size / 2 + 4.5} textAnchor="middle" fontSize={size >= 56 ? 13 : 12} fontWeight={600} fill={textColor}>
        {Math.round(value)}
      </text>
    </svg>
  );
}

function FolderCard({ node, index, onOpen }: { node: RollupNode; index: number; onOpen: () => void }) {
  const cum = round2(node.curProgressPct);
  const plan = round2(planPctOf(node));
  const st = statusOf(cum, plan);
  return (
    <button
      onClick={onOpen}
      className="group flex w-full items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition-all duration-300 ease-ios hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md active:scale-[0.99] animate-fade-in-up"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <Ring pct={cum} color={st.ring} textColor={st.ringText} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold text-gray-900">{node.deskripsi}</div>
        <div className="mt-1 text-[13px] text-gray-500">
          {leafCount(node)} activities · Plan {plan.toFixed(1)}%
          <GapInline cum={cum} plan={plan} />
        </div>
        <GapBottomRow cum={cum} plan={plan} />
      </div>
      <span className={`hidden shrink-0 rounded-full px-3 py-1 text-[12px] font-medium sm:inline ${st.chip}`}>{st.label}</span>
      <svg className="h-5 w-5 shrink-0 text-gray-300 transition-all group-hover:translate-x-0.5 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// ============================================================================

function LeafCard({ node, open, onToggle }: { node: RollupNode; open: boolean; onToggle: () => void }) {
  const cum = round2(node.curProgressPct);
  const plan = round2(planPctOf(node));
  const st = statusOf(cum, plan);
  const thisWeek = round2(cum - node.prevProgressPct);
  const isDone = cum >= 99.95;
  const curWF = round2((node.bobot * cum) / 100);
  const variance = round2(node.curWF - node.targetWF);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-sm transition-all duration-300">
      {/* Title + big actual number */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[55%] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold leading-snug text-gray-900">{node.deskripsi}</span>
            {isDone && (
              <svg className="h-4 w-4 shrink-0 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.chip}`}>{st.label}</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-gray-500">{storyOf(cum, plan, thisWeek)}</p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-semibold tabular-nums" style={{ color: st.ringText }}>{pct(cum)}</div>
          <div className="text-[11px] text-gray-400">actual</div>
        </div>
      </div>

      {/* Progress bar with target tick */}
      {!isDone && (
        <>
          <div className="relative mt-3.5 h-2.5 rounded-full bg-gray-100">
            <div className={`h-full rounded-full transition-all duration-700 ease-out ${st.bar}`} style={{ width: `${clamp(cum)}%` }} />
            {plan > 0.5 && plan < 99.5 && (
              <div className="absolute -top-[3px] h-4 w-0.5 rounded-full bg-gray-600/70" style={{ left: `calc(${clamp(plan)}% - 1px)` }} title={`Plan ${plan.toFixed(1)}%`} />
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
              Plan <span className="font-medium text-gray-700">{plan.toFixed(1)}%</span>
              <GapInline cum={cum} plan={plan} />
              <DetailToggle open={open} onClick={onToggle} />
            </span>
          </div>
          <GapBottomRow cum={cum} plan={plan} className="mt-1.5" />
        </>
      )}
      {isDone && (
        <div className="mt-1.5 flex items-center justify-end">
          <DetailToggle open={open} onClick={onToggle} />
        </div>
      )}

      {/* Full numbers on demand */}
      <div className="grid transition-[grid-template-rows] duration-300 ease-out" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <div className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl bg-gray-50 p-4 sm:grid-cols-3">
            <Field label="WBS Code" value={node.wbsCode} />
            <Field label="Weight" value={`${node.bobot.toFixed(3)}%`} sub="of the whole project" />
            <Field label="Contribution to total" value={`${curWF.toFixed(3)}%`} sub={`${cum.toFixed(1)}% × ${node.bobot.toFixed(2)}%`} />
            <Field label="Volume" value={node.vol && node.satuan ? `${node.vol} ${node.satuan}` : '—'} />
            <Field label="Last week" value={`${node.prevProgressPct.toFixed(2)}%`} />
            <Field
              label="Deviation vs plan"
              value={`${variance >= 0 ? '+' : ''}${variance.toFixed(3)}%`}
              sub={variance < 0 ? 'below plan' : 'on / above plan'}
              valueCls={variance < -0.005 ? 'text-red-600' : 'text-emerald-600'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700">
      Details
      <svg className="h-3.5 w-3.5 transition-transform duration-300" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </button>
  );
}

function Field({ label, value, sub, valueCls = 'text-gray-900' }: { label: string; value: string; sub?: string; valueCls?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-gray-500">{label}</div>
      <div className={`mt-0.5 text-[13px] font-semibold tabular-nums ${valueCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}
