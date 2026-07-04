'use client';

import { useMemo, useState } from 'react';
import type { RollupNode } from '@/lib/rollup';

type StatusKey = 'done' | 'ontrack' | 'behind';

function planPctOf(node: RollupNode): number {
  return node.bobot > 0 ? (node.targetWF / node.bobot) * 100 : 0;
}

function isMilestone(node: RollupNode): boolean {
  return node.children.length === 0 && node.bobot === 0;
}

function statusOf(node: RollupNode): StatusKey {
  if (node.curProgressPct >= 99.995) return 'done';
  if (node.curWF - node.targetWF >= -0.005) return 'ontrack';
  return 'behind';
}

/** toFixed(2) without the "-0.00" artifact on near-zero negatives. */
function fmt(v: number): string {
  const r = Math.abs(v) < 0.005 ? 0 : v;
  return r.toFixed(2);
}

function leafCountOf(node: RollupNode): number {
  if (node.children.length === 0) return isMilestone(node) ? 0 : 1;
  return node.children.reduce((sum, c) => sum + leafCountOf(c), 0);
}

const FILTERS: { key: 'all' | StatusKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'behind', label: 'Behind' },
  { key: 'ontrack', label: 'On Track' },
  { key: 'done', label: 'Done' },
];

const STATUS_META: Record<StatusKey, { dot: string; bar: string; chip: string; label: string }> = {
  done: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', label: 'Done' },
  ontrack: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700', label: 'On Track' },
  behind: { dot: 'bg-red-500', bar: 'bg-red-400', chip: 'bg-red-100 text-red-700', label: 'Behind' },
};

function StatusChip({ node }: { node: RollupNode }) {
  const status = statusOf(node);
  const meta = STATUS_META[status];
  const label =
    status === 'behind' ? `Behind ${fmt(Math.abs(node.curWF - node.targetWF))}%` : meta.label;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${meta.chip}`}>
      {status === 'done' && (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {label}
    </span>
  );
}

function SlimBar({ node, className = '' }: { node: RollupNode; className?: string }) {
  const status = statusOf(node);
  const actual = Math.min(100, Math.max(0, node.curProgressPct));
  const plan = Math.min(100, Math.max(0, planPctOf(node)));
  return (
    <div
      className={`relative h-1.5 rounded-full bg-gray-100 ${className}`}
      title={`Actual ${fmt(actual)}% · Plan ${fmt(plan)}%`}
    >
      <div className={`h-full rounded-full ${STATUS_META[status].bar}`} style={{ width: `${actual}%` }} />
      {status !== 'done' && (
        <div className="absolute -top-[3px] h-3 w-0.5 rounded-full bg-gray-500/70" style={{ left: `calc(${plan}% - 1px)` }} />
      )}
    </div>
  );
}

/** "100%" instead of "100.00%" — whole numbers don't need decimals, and the
    shorter string always fits inside the ring. */
function ringLabel(v: number): string {
  const near = Math.round(v);
  return Math.abs(v - near) < 0.005 ? `${near}%` : `${fmt(v)}%`;
}

/** Circular progress — colored arc = actual, faint gray arc = plan. */
function ProgressRing({ node }: { node: RollupNode }) {
  const status = statusOf(node);
  const r = 40;
  const c = 2 * Math.PI * r;
  const actual = Math.min(100, Math.max(0, node.curProgressPct));
  const plan = Math.min(100, Math.max(0, planPctOf(node)));
  const color = status === 'behind' ? '#ef4444' : '#10b981';
  const label = ringLabel(actual);
  return (
    <div className="shrink-0">
      <div className="relative h-28 w-28">
        <svg viewBox="0 0 112 112" className="h-28 w-28 -rotate-90">
          <circle cx="56" cy="56" r={r} fill="none" stroke="#f3f4f6" strokeWidth="9" />
          {status !== 'done' && (
            <circle
              cx="56" cy="56" r={r} fill="none" stroke="#d1d5db" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${(plan / 100) * c} ${c}`}
            />
          )}
          <circle
            cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={`${(actual / 100) * c} ${c}`}
            className="transition-[stroke-dasharray] duration-700 ease-out-expo"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-semibold tabular-nums text-gray-900 ${label.length > 5 ? 'text-base' : 'text-xl'}`}>
            {label}
          </span>
          <span className="text-[9px] font-medium uppercase tracking-wide text-gray-400">actual</span>
        </div>
      </div>
      {status !== 'done' && (
        <p className="mt-1 text-center text-[10px] tabular-nums text-gray-400">plan {ringLabel(plan)}</p>
      )}
    </div>
  );
}

function Stat({ label, value, tone = 'text-gray-900', sub }: { label: string; value: string; tone?: string; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

/** The click-to-open panel — big numbers grouped by meaning, no table in sight. */
function LeafDetail({ node }: { node: RollupNode }) {
  const status = statusOf(node);
  const thisWeek = node.curProgressPct - node.prevProgressPct;
  const plan = planPctOf(node);
  const gap = node.curProgressPct - plan;
  const wfVariance = node.curWF - node.targetWF;
  const sentence =
    status === 'done'
      ? 'This activity is fully completed.'
      : status === 'ontrack'
        ? 'Progress is at or ahead of the plan — no action needed.'
        : `Progress is ${fmt(Math.abs(gap))}% below where the plan says it should be.`;

  return (
    <div className="animate-scale-in mx-1 mb-2 mt-1 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50/80 to-white p-4 sm:p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusChip node={node} />
        <p className="text-xs text-gray-500">{sentence}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
        <ProgressRing node={node} />
        <div className="grid min-w-[240px] flex-1 grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <Stat
            label="This Week"
            value={thisWeek > 0.001 ? `+${fmt(thisWeek)}%` : '—'}
            tone={thisWeek > 0.001 ? 'text-blue-600' : 'text-gray-300'}
            sub={<>was <span className="font-medium tabular-nums text-gray-700">{fmt(node.prevProgressPct)}%</span> last week</>}
          />
          <Stat
            label="Plan Target"
            value={`${fmt(plan)}%`}
            sub={
              gap < -0.005 ? (
                <span className="font-medium tabular-nums text-red-600">{fmt(gap)}% gap</span>
              ) : (
                <span className="font-medium text-emerald-600">target reached</span>
              )
            }
          />
          <Stat
            label="Project Contribution"
            value={`${fmt(node.curWF)}%`}
            sub={
              <>
                of <span className="font-medium tabular-nums text-gray-700">{fmt(node.targetWF)}%</span> target{' '}
                <span className={`font-semibold tabular-nums ${wfVariance < -0.005 ? 'text-red-600' : 'text-emerald-600'}`}>
                  ({wfVariance >= 0.005 ? '+' : ''}{fmt(wfVariance)})
                </span>
              </>
            }
          />
          {node.vol != null && node.satuan ? (
            <Stat label="Volume" value={`${node.vol} ${node.satuan}`} sub={<>weight {fmt(node.bobot)}% of project</>} />
          ) : (
            <Stat label="Weight" value={`${fmt(node.bobot)}%`} sub="share of the whole project" />
          )}
        </div>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16" fill="none"
      className={`h-3.5 w-3.5 shrink-0 text-gray-300 transition-transform duration-300 ease-spring ${open ? 'rotate-90' : ''}`}
    >
      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function WbsTreeVisual({ roots }: { roots: RollupNode[] }) {
  // "Big picture first": SPK cards open with their top-level phases visible,
  // everything deeper collapsed until the user drills in.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const visit = (n: RollupNode) => {
      if (n.children.length && n.depth <= 1) initial.add(n.id);
      n.children.forEach(visit);
    };
    roots.forEach(visit);
    return initial;
  });
  const [openDetail, setOpenDetail] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | StatusKey>('all');
  const [query, setQuery] = useState('');

  const counts = useMemo(() => {
    const c = { behind: 0, ontrack: 0, done: 0 };
    const visit = (n: RollupNode) => {
      if (n.children.length === 0) {
        if (!isMilestone(n)) c[statusOf(n)]++;
      } else {
        n.children.forEach(visit);
      }
    };
    roots.forEach(visit);
    return c;
  }, [roots]);

  const filtering = filter !== 'all' || query.trim().length > 0;

  // When a filter or search is active the expand state is ignored: every leaf
  // that matches is shown along with its ancestors as context.
  const visibleIds = useMemo(() => {
    if (!filtering) return null;
    const q = query.trim().toLowerCase();
    const set = new Set<string>();
    const visit = (n: RollupNode): boolean => {
      if (isMilestone(n)) return false;
      if (n.children.length === 0) {
        const ok =
          (filter === 'all' || statusOf(n) === filter) && (q === '' || n.deskripsi.toLowerCase().includes(q));
        if (ok) set.add(n.id);
        return ok;
      }
      const any = n.children.map(visit).some(Boolean);
      if (any) set.add(n.id);
      return any;
    };
    roots.forEach(visit);
    return set;
  }, [roots, filter, query, filtering]);

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleDetail(id: string) {
    setOpenDetail((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    const visit = (n: RollupNode) => {
      if (n.children.length) {
        all.add(n.id);
        n.children.forEach(visit);
      }
    };
    roots.forEach(visit);
    setExpanded(all);
  }

  function collapseAll() {
    setExpanded(new Set());
    setOpenDetail(new Set());
  }

  function renderLeaf(node: RollupNode) {
    const thisWeek = node.curProgressPct - node.prevProgressPct;
    const detailOpen = openDetail.has(node.id);
    return (
      <div key={node.id}>
        <button
          onClick={() => toggleDetail(node.id)}
          className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-200 ease-ios ${
            detailOpen ? 'bg-blue-50/60' : 'hover:bg-gray-50'
          }`}
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[statusOf(node)].dot}`} />
          <span className="min-w-0 flex-1 truncate text-sm text-gray-700" title={node.deskripsi}>
            {node.deskripsi}
          </span>
          {thisWeek > 0.001 && (
            <span className="shrink-0 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-600 max-sm:hidden">
              +{fmt(thisWeek)}
            </span>
          )}
          <SlimBar node={node} className="w-24 shrink-0 max-sm:hidden" />
          <span className="w-14 shrink-0 text-right text-sm font-medium tabular-nums text-gray-900">
            {fmt(node.curProgressPct)}%
          </span>
          <Chevron open={detailOpen} />
        </button>
        {detailOpen && <LeafDetail node={node} />}
      </div>
    );
  }

  function renderGroup(node: RollupNode) {
    const isOpen = filtering || expanded.has(node.id);
    const children = node.children.filter((c) => !isMilestone(c) && (!visibleIds || visibleIds.has(c.id)));
    return (
      <div key={node.id}>
        <button
          onClick={() => !filtering && toggleExpand(node.id)}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-200 ease-ios hover:bg-gray-50"
        >
          <Chevron open={isOpen} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800" title={node.deskripsi}>
            {node.deskripsi}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-gray-400 max-sm:hidden">
            {leafCountOf(node)} items
          </span>
          <SlimBar node={node} className="w-24 shrink-0 max-sm:hidden" />
          <span className="w-14 shrink-0 text-right text-sm font-medium tabular-nums text-gray-700">
            {fmt(node.curProgressPct)}%
          </span>
          <span className="w-3.5 shrink-0" />
        </button>
        {isOpen && children.length > 0 && (
          <div className="ml-[15px] border-l border-gray-100 pl-3">
            {children.map((c) => (c.children.length === 0 ? renderLeaf(c) : renderGroup(c)))}
          </div>
        )}
      </div>
    );
  }

  const visibleRoots = roots.filter((r) => !visibleIds || visibleIds.has(r.id));

  return (
    <div className="space-y-5">
      {/* Toolbar: status filters + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const count = f.key === 'all' ? null : counts[f.key];
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-all duration-200 ease-ios active:scale-[0.96] ${
                  active
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900'
                }`}
              >
                {f.label}
                {count !== null && (
                  <span
                    className={`ml-1 tabular-nums ${
                      active ? 'text-gray-300' : f.key === 'behind' && count > 0 ? 'font-semibold text-red-600' : 'text-gray-400'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activity…"
            className="min-w-0 flex-1 sm:flex-none sm:w-44 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-900 transition-all duration-200 ease-ios placeholder:text-gray-400 hover:border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <button
            onClick={expandAll}
            className="shrink-0 text-xs text-gray-500 transition-colors duration-200 ease-ios hover:text-gray-900"
          >
            Expand all
          </button>
          <span className="text-gray-200">·</span>
          <button
            onClick={collapseAll}
            className="shrink-0 text-xs text-gray-500 transition-colors duration-200 ease-ios hover:text-gray-900"
          >
            Collapse all
          </button>
        </div>
      </div>

      {visibleRoots.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white py-14 text-center shadow-sm">
          <p className="text-sm text-gray-400">No activities match this filter.</p>
        </div>
      )}

      {/* One card per SPK contract — the header is a permanent title, not a toggle */}
      {visibleRoots.map((root, idx) => {
        const children = root.children.filter((c) => !isMilestone(c) && (!visibleIds || visibleIds.has(c.id)));
        return (
          <div
            key={root.id}
            className="animate-fade-in-up overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm"
            style={{ animationDelay: `${idx * 70}ms` }}
          >
            <div className="px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900" title={root.deskripsi}>
                    {root.deskripsi}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {leafCountOf(root)} activities · weight{' '}
                    <span className="font-medium tabular-nums">{fmt(root.bobot)}%</span> of project
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusChip node={root} />
                  <span className="text-2xl font-semibold tabular-nums text-gray-900">
                    {fmt(root.curProgressPct)}%
                  </span>
                </div>
              </div>
              <SlimBar node={root} className="!h-2" />
            </div>
            {children.length > 0 && (
              <div className="border-t border-gray-100 px-2 py-2 sm:px-3">
                {children.map((c) => (c.children.length === 0 ? renderLeaf(c) : renderGroup(c)))}
              </div>
            )}
          </div>
        );
      })}

      <p className="px-1 text-[11px] text-gray-400">
        Bar = actual progress · small gray mark = where the plan says it should be · click an activity for the full
        story
      </p>
    </div>
  );
}
