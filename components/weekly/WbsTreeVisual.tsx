'use client';

import { useEffect, useMemo, useState } from 'react';
import type { RollupNode } from '@/lib/rollup';
import { computeGrandTotal } from '@/lib/rollup';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import TruncatedName from '@/components/ui/TruncatedName';
import PlanBar from '@/components/weekly/PlanBar';
import CodeChip, { splitCode } from '@/components/ui/CodeChip';
import { Swap } from '@/components/motion/Swap';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

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

/**
 * The entrance delay for the nth card in a list — CAPPED, and the cap is the
 * point.
 *
 * A plain `index * 40ms` is pleasant for the four contracts on the home screen
 * and ruinous one level down, because a folder here holds up to 89 activities:
 * the last card used to begin animating 3.56 SECONDS after the first. That is
 * the very tail the `Level` docblock below describes as removed — the wrapper
 * was added, the per-card delays were not taken out with it.
 *
 * The cap, not the step, is what fixed that. So the step stays unhurried — a
 * row of cards dealt out one after another is most of what makes this screen
 * feel considered rather than assembled — while the cap holds the whole
 * cascade to under half a second no matter how long the list is. Nothing past
 * the ninth card is on screen when a level opens anyway.
 */
const cascade = (index: number) => `${Math.min(index, 8) * 55}ms`;

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
  if (Math.abs(gap) < 0.05) return { text: 'on plan', cls: 'text-muted-foreground' };
  if (gap >= -1 && gap < 0) return { text: 'nearly on plan', cls: 'text-muted-foreground' };
  if (gap < 0) return { text: `${Math.abs(gap).toFixed(1)}% behind`, cls: 'text-bad' };
  return { text: `${gap.toFixed(1)}% ahead`, cls: 'text-ok' };
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
  if (gap >= 0) return `Ahead of plan, all good.${moved}`;
  if (gap >= -1) return `Almost at plan.${moved}`;
  if (gap >= -7.5) return `${Math.abs(gap).toFixed(1)}% behind plan, needs a push.${moved}`;
  return `${Math.abs(gap).toFixed(1)}% behind plan, needs attention.${moved}`;
}

function shortName(s: string): string {
  return s.length > 30 ? s.slice(0, 28).trimEnd() + '…' : s;
}

/* THE FIVE STATUS COLOURS STAY RAW ON PURPOSE, and `statusOf` above with
   them. This is a five-way scale — done / on track / slightly behind / warning
   / not started — and the token palette has no five-way equivalent; `--ok`,
   `--warn` and `--bad` are a three-way verdict. More to the point, the
   overview hero's ACTIVITY STATUS meter and its legend are drawn from exactly
   this map, so splitting it would make the legend at the top of the page
   disagree with the chips on the cards below it. The cards render it through
   shadcn's `Badge`; only the ink is local. */
const STATUS_ORDER = ['done', 'ontrack', 'slight', 'behind', 'idle'] as const;
const STATUS_LEGEND: Record<string, { label: string; bar: string; dot: string; text: string; chip: string }> = {
  done: { label: 'Done', bar: 'bg-emerald-500', dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-700' },
  ontrack: { label: 'On track', bar: 'bg-blue-500', dot: 'bg-blue-500', text: 'text-blue-700', chip: 'bg-blue-50 text-blue-700' },
  slight: { label: 'Slightly behind', bar: 'bg-amber-400', dot: 'bg-amber-400', text: 'text-amber-700', chip: 'bg-amber-50 text-amber-700' },
  behind: { label: 'Warning', bar: 'bg-red-400', dot: 'bg-red-500', text: 'text-red-600', chip: 'bg-red-50 text-red-600' },
  idle: { label: 'Not started', bar: 'bg-gray-300', dot: 'bg-gray-300', text: 'text-gray-500', chip: 'bg-gray-100 text-gray-500' },
};

/**
 * One drill level, sliding in from the side it came from — and the level it
 * replaces now sliding out.
 *
 * The whole level animates as a SINGLE motion instance. It used to be one CSS
 * `animate-fade-in-up` per card with a computed `animationDelay`, and a folder
 * here can hold 89 activities — eighty-nine staggered elements, the last of
 * them arriving three and a half seconds in. One block is both cheaper and
 * quicker to read.
 *
 * IT WAS A CSS KEYFRAME, and the objection that made it one is now answered
 * rather than worked around. The reason written here was that `motion.div`
 * puts its `initial` style into the server HTML, so the whole level shipped at
 * `opacity: 0` and stayed invisible until hydration finished. `Swap` wraps its
 * `AnimatePresence` in `initial={false}`, which writes nothing at all: the
 * first level is in the first paint, unanimated, exactly as the keyframe left
 * it. Every level after that is a click on a live page.
 *
 * What the trade buys is the half CSS could never reach. A keyframe cannot
 * animate the OUTGOING level, because React removes it before any keyframe can
 * run — so drilling in used to be one level vanishing and another appearing.
 * Now they travel together.
 */
function Level({
  levelKey,
  direction,
  children,
}: {
  levelKey: number;
  direction: 'fwd' | 'back';
  children: React.ReactNode;
}) {
  return (
    <Swap levelKey={levelKey} direction={direction}>
      {children}
    </Swap>
  );
}

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
      {/* Search. One shadcn Input for the whole screen — the icon and the
          clear button are positioned over it rather than wrapped around it, so
          the field keeps its own focus ring instead of the container faking
          one. */}
      <div className="relative">
        <svg
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search an activity…"
          className="h-12 rounded-xl pr-11 pl-11 text-[14px]"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        )}
      </div>

      {searchResults ? (
        /* Search replaces the browser */
        <Level levelKey={levelKey} direction="fwd">
          <div className="mb-2.5 px-1 text-[13px] text-muted-foreground">
            {searchResults.length === 0 ? 'No matching activities.' : `${searchResults.length} ${searchResults.length === 1 ? 'activity' : 'activities'} found`}
          </div>
          <div className="space-y-2.5">
          {searchResults.map((leaf, idx) => (
            <div key={leaf.id} className="animate-fade-in-up" style={{ animationDelay: cascade(idx) }}>
              <button
                onClick={() => jumpToLeaf(leaf)}
                className="mb-1 flex items-center gap-1.5 px-1 text-[12px] text-muted-foreground transition-colors hover:text-chart-1"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                {ancestorsOf(leaf.id).map((a) => shortName(a.deskripsi)).join(' › ') || 'Top level'}
                <span className="text-chart-1">· open location</span>
              </button>
              <LeafCard node={leaf} open={detailOpen.has(leaf.id)} onToggle={() => toggleDetail(leaf.id)} />
            </div>
          ))}
          </div>
        </Level>
      ) : currentPath.length === 0 ? (
        /* HOME — big-picture overview + contract folders */
        <>
          <OverviewHero grand={grand} dist={dist} />
          <Level levelKey={levelKey} direction={direction}>
            <p className="mb-2.5 px-1 text-[13px] font-medium text-muted-foreground">
              {/* "click to explore" was an instruction attached to a line that
                  is not the thing you click. Each card below already carries a
                  chevron, and a card with a chevron is not a control anybody
                  needs told about. */}
              {homeNodes.length} {homeNodes.length === 1 ? 'contract' : 'contracts'}
            </p>
            <div className="space-y-2.5">
              {homeNodes.map((node, idx) => (
                <FolderCard key={node.id} node={node} index={idx} onOpen={() => navigateInto(node)} />
              ))}
            </div>
          </Level>
        </>
      ) : (
        /* DRILLED IN — breadcrumb + current folder header + children */
        <>
          <Card className="py-0">
            <CardContent className="px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <Button
                variant="ghost"
                size="sm"
                onClick={goBack}
                className="-ml-2 font-medium text-muted-foreground hover:text-chart-1"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </Button>
              <span className="mx-1 text-border">|</span>
              <button onClick={() => goToLevel(-1)} className="text-muted-foreground transition-colors hover:text-chart-1">
                All contracts
              </button>
              {currentPath.map((p, i) => (
                <span key={p.id} className="flex items-center gap-2">
                  <span className="text-border">›</span>
                  {i === currentPath.length - 1 ? (
                    <span className="font-semibold text-foreground">{shortName(p.deskripsi)}</span>
                  ) : (
                    <button onClick={() => goToLevel(i)} className="text-muted-foreground transition-colors hover:text-chart-1">
                      {shortName(p.deskripsi)}
                    </button>
                  )}
                </span>
              ))}
            </div>
            {currentNode && (
              <div className="mt-3">
                <FolderFace node={currentNode} />
              </div>
            )}
            </CardContent>
          </Card>

          <Level levelKey={levelKey} direction={direction}>
            <div className="space-y-2.5">
              {currentNodes.map((node, idx) =>
                node.children.length > 0 ? (
                  <FolderCard key={node.id} node={node} index={idx} onOpen={() => navigateInto(node)} />
                ) : (
                  <div
                    key={node.id}
                    className="animate-fade-in-up"
                    style={{ animationDelay: cascade(idx) }}
                  >
                    <LeafCard
                      node={node}
                      open={detailOpen.has(node.id)}
                      onToggle={() => toggleDetail(node.id)}
                    />
                  </div>
                )
              )}
              {currentNodes.length === 0 && (
                <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                  No activities at this level.
                </div>
              )}
            </div>
          </Level>
        </>
      )}

      {/* `Fill in` is BOLD, not blue. Blue is what everything clickable in this
          app is, and this is the name of another screen written inside a
          sentence: styling it like a link offered a press that does nothing. */}
      <p className="px-1 text-[11px] text-muted-foreground">
        This page is read-only. Change the numbers in{' '}
        <span className="font-semibold text-foreground">Fill in</span> and they appear here
        automatically.
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
    <section className="animate-rise-in overflow-hidden rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-gray-50/60 p-5 shadow-sm sm:p-6">
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
            {/* The track is gray-100 — the SAME grey the gauge draws its own
                under-circle in, not a new colour. The meter had none, so while
                it filled the segments floated on the card with nothing holding
                them, and a half-drawn meter looked broken rather than busy. At
                rest it shows only in the 2px seams. */}
            <div className="flex h-8 w-full gap-[2px] overflow-hidden rounded-[10px] bg-gray-100 sm:h-9">
              {legendKeys.map((k, i) => (
                <div
                  key={k}
                  className={`${STATUS_LEGEND[k].bar} animate-bar-grow h-full`}
                  style={{
                    width: `${Math.max(0.8, (dist.counts[k] / dist.total) * 100)}%`,
                    animationDelay: `${180 + i * 100}ms`,
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
                  style={{ animationDelay: `${420 + i * 80}ms` }}
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
 *  the target, so actual-vs-plan is visible as a shortfall in the sweep.
 *
 *  THE ARC IS DRAWN IN THE SERVER HTML, and the sweep is a CSS keyframe over
 *  the top of it. It used to be a `drawn` useState flipped in a useEffect, so
 *  the markup shipped `stroke-dasharray="0 361.28"` and the ring stayed empty
 *  until hydration had finished — 6.6s to domInteractive at 4x CPU on a 390px
 *  viewport: four and a half seconds of a "70.1%" label inside an empty ring,
 *  then a lurch. That is the same bug Reveal.tsx was written to kill, rebuilt
 *  by hand out of React state instead of framer-motion. The keyframe is in the
 *  first paint and needs no JavaScript; if the bundle never lands the ring is
 *  still correct. */
function HeroGauge({ actual, plan, color, textColor }: { actual: number; plan: number; color: string; textColor: string }) {
  const size = 128;
  const stroke = 11;
  const r = size / 2 - stroke / 2 - 1;
  const c = 2 * Math.PI * r;
  const arc = (v: number) => `${(clamp(v) / 100) * c} ${c}`;
  const done = actual >= 99.95;
  // `--arc-c` is what the keyframe counts up from; see `arc-draw` in globals.css.
  const sweep = { '--arc-c': `${c}` } as React.CSSProperties;
  return (
    <div className="relative h-28 w-28 shrink-0 sm:h-32 sm:w-32">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f3f4f6" strokeWidth={stroke} />
        {/* THE PLAN ARC DOES NOT ANIMATE, and that is the better story as well
            as the cheaper one. It is #d1d5db drawn on a #f3f4f6 track, so
            sweeping it was nearly invisible while costing half of this SVG's
            repaints. Standing still it states the target first, and the actual
            then runs at it and stops short — the shortfall is something you
            watch happen instead of a gap you find afterwards. */}
        {!done && plan > 0.5 && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#d1d5db" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={arc(plan)}
          />
        )}
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={arc(actual)}
          className="animate-arc-draw"
          // The actual trails the plan by a beat, so the shortfall between the
          // two arcs is something you watch open up rather than simply find.
          style={{ ...sweep, animationDelay: '0.22s' }}
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

/**
 * One contract, laid out so it can be RANKED against the others.
 *
 * It used to open with a ring gauge and a meta line reading "89 activities ·
 * Plan 100.0% · 6.8% BEHIND". Two things were missing and one was doubled.
 *
 * WEIGHT WAS MISSING, and it is the number that decides which row matters.
 * SPK-003 is 47.65% of this project and SPK-007 is 14.24% — being 6.8% behind
 * on the first is worth roughly three of being 6.4% behind on the second, and
 * the old rows gave the reader nothing to tell them apart. It is now the first
 * thing on the meta line, in the body colour, ahead of the activity count.
 *
 * THE GAP WAS MISSING. A ring drew the actual and nothing else, so the one
 * comparison the page exists to make had to be reconstructed from two numbers
 * in a sentence. The ring is gone and `PlanBar` takes its place: blue fill for
 * actual, red tick for plan — the same picture the Overall Summary draws, so
 * the two screens teach one thing instead of two.
 *
 * AND THE VERDICT WAS DOUBLED — "6.8% BEHIND" in red beside a chip reading
 * "Slightly behind". They stay both, because they answer different questions
 * (how far, and which band), but the chip now sits with the title where it
 * reads as a label on the contract rather than as a second opinion.
 *
 * The percentage is blue because it is the actual — rule 1 of lib/design.ts.
 * The chip beside it is where the verdict lives.
 */
function FolderCard({ node, index, onOpen }: { node: RollupNode; index: number; onOpen: () => void }) {
  return (
    <Card
      className="group animate-fade-in-up py-0 transition-shadow duration-300 ease-ios hover:shadow-md"
      style={{ animationDelay: cascade(index) }}
    >
      <button
        onClick={onOpen}
        className="w-full px-4 py-4 text-left transition-transform duration-300 ease-ios active:scale-[0.99] sm:px-5"
      >
        <FolderFace node={node} chevron />
      </button>
    </Card>
  );
}

/**
 * The face itself — ONE COMPONENT, TWO PLACES, which is the whole point of it.
 *
 * A contract is drawn twice: as a row in the list, and again as the header of
 * the level you open it into. Those had drifted into two different pictures.
 * The row had been rebuilt around the layout described above; the header still
 * carried the ring gauge that rebuild removed, ordered its meta line the other
 * way round ("34 activities · Weight 7.07%"), kept the SPK tag buried at the end
 * of the title, and had neither the verdict chip nor a plan mark — so tapping a
 * row changed how the same four numbers looked. They render the same markup
 * now; the row adds a button and a chevron around it, and nothing else.
 */
function FolderFace({ node, chevron = false }: { node: RollupNode; chevron?: boolean }) {
  const cum = round2(node.curProgressPct);
  const plan = round2(planPctOf(node));
  const st = statusOf(cum, plan);
  const { tag, name } = splitCode(node.deskripsi);
  return (
    <div className="flex w-full flex-col gap-2.5">
      <div className="flex w-full items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* min-w-0 on the name: a flex item defaults to min-width:auto, so
              without it TruncatedName refuses to shrink below the full WBS
              description, `truncate` never engages, and at 390px the title
              ran straight under the percentage on its right. */}
          <div className="flex items-center gap-x-2">
            {tag && <CodeChip>{tag}</CodeChip>}
            <TruncatedName
              text={name}
              className="min-w-0 flex-1 text-[15px] font-semibold text-foreground"
              accent={st.ring}
            />
            {/* Hidden below sm: the gap line under the bar already states the
                verdict on a phone, and on a 390px row this badge was the
                difference between "Pekerjaan Instalasi 2 unit…" and
                "Pekerjaan Inst…". */}
            <Badge className={cn('hidden shrink-0 text-[11px] font-semibold sm:inline-flex', st.chip)}>
              {st.label}
            </Badge>
          </div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{node.bobot.toFixed(2)}%</span> of the
            project · {leafCount(node)} activities · Plan {plan.toFixed(1)}%
            <GapInline cum={cum} plan={plan} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xl font-semibold tabular-nums text-chart-1 sm:text-2xl">{pct(cum)}</span>
          {chevron && (
            <svg
              className="h-5 w-5 shrink-0 text-muted-foreground/50 transition-transform duration-300 ease-ios group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          )}
        </div>
      </div>

      <PlanBar actual={cum} plan={plan} />
      <GapBottomRow cum={cum} plan={plan} className="mt-0" />
    </div>
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
    <Card className="py-0">
      <CardContent className="px-5 py-4">
      {/* Title + big actual number — the same three slots a folder shows, in
          the same order and the same colours: name and verdict chip on the
          left, the actual on the right, blue because it is a measurement and
          not a verdict (rule 1 of lib/design.ts). It used to tint that number
          by status and caption it "Actual", so a leaf that had fallen behind
          printed a red figure directly under a blue one on the folder header
          above it — the same quantity, two colours, one screen. The chip and
          the sentence carry the verdict, which is where a verdict belongs. */}
      <div className="flex w-full items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-x-2">
            <span className="min-w-0 flex-1 text-[14px] leading-snug font-semibold text-foreground">{node.deskripsi}</span>
            {isDone && (
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-ok" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {/* Hidden below sm for the same reason as the folder card: the gap
                line under the bar already states the verdict on a phone, and a
                110px chip on a 390px row leaves the name nowhere to wrap. */}
            <Badge className={cn('hidden shrink-0 text-[11px] font-semibold sm:inline-flex', st.chip)}>
              {st.label}
            </Badge>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{storyOf(cum, plan, thisWeek)}</p>
        </div>
        <span className="shrink-0 text-xl font-semibold tabular-nums text-chart-1 sm:text-2xl">{pct(cum)}</span>
      </div>

      {/* Progress bar with target tick */}
      {!isDone && (
        <>
          <PlanBar actual={cum} plan={plan} className="mt-3.5 h-2.5" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            <span>
              Last week <span className="font-medium text-foreground">{node.prevProgressPct.toFixed(1)}%</span>
              {thisWeek !== 0 && (
                <span className={thisWeek > 0 ? 'text-ok' : 'text-bad'}>
                  {' '}({thisWeek > 0 ? '+' : ''}{thisWeek.toFixed(1)}%)
                </span>
              )}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              Plan <span className="font-medium text-foreground">{plan.toFixed(1)}%</span>
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
          <div className="mt-3.5 grid grid-cols-2 gap-x-5 gap-y-3 rounded-lg bg-muted p-4 sm:grid-cols-3">
            <Field label="WBS Code" value={node.wbsCode} />
            <Field label="Weight" value={`${node.bobot.toFixed(3)}%`} sub="of the whole project" />
            <Field label="Contribution to total" value={`${curWF.toFixed(3)}%`} sub={`${cum.toFixed(1)}% × ${node.bobot.toFixed(2)}%`} />
            <Field label="Volume" value={node.vol && node.satuan ? `${node.vol} ${node.satuan}` : '—'} />
            <Field label="Last week" value={`${node.prevProgressPct.toFixed(2)}%`} />
            <Field
              label="Deviation vs plan"
              value={`${variance >= 0 ? '+' : ''}${variance.toFixed(3)}%`}
              sub={variance < 0 ? 'below plan' : 'on / above plan'}
              valueCls={variance < -0.005 ? 'text-bad' : 'text-ok'}
            />
          </div>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}

function DetailToggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick} className="text-[12px] font-medium text-muted-foreground">
      Details
      <svg className="h-3.5 w-3.5 transition-transform duration-300" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    </Button>
  );
}

function Field({ label, value, sub, valueCls = 'text-foreground' }: { label: string; value: string; sub?: string; valueCls?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-[13px] font-semibold tabular-nums', valueCls)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
