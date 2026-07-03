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

const FILTERS: { key: 'all' | StatusKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'behind', label: 'Behind' },
  { key: 'ontrack', label: 'On Track' },
  { key: 'done', label: 'Done' },
];

function StatusBadge({ node }: { node: RollupNode }) {
  const status = statusOf(node);
  const variance = node.curWF - node.targetWF;
  if (status === 'done') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Done
      </span>
    );
  }
  if (status === 'ontrack') {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">On Track</span>
    );
  }
  return (
    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 tabular-nums">
      {variance.toFixed(2)}
    </span>
  );
}

function Bar({ node }: { node: RollupNode }) {
  const status = statusOf(node);
  const actual = Math.min(100, Math.max(0, node.curProgressPct));
  const plan = Math.min(100, Math.max(0, planPctOf(node)));
  return (
    <div className="relative h-2 rounded-full bg-gray-100" title={`Actual ${actual.toFixed(2)}% · Plan ${plan.toFixed(2)}%`}>
      <div
        className={`h-full rounded-full ${status === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
        style={{ width: `${actual}%` }}
      />
      {status !== 'done' && (
        <div className="absolute -top-1 h-4 w-0.5 rounded-full bg-gray-500" style={{ left: `calc(${plan}% - 1px)` }} />
      )}
    </div>
  );
}

/** toFixed(2) without the "-0.00" artifact on near-zero negatives. */
function fmt(v: number): string {
  const r = Math.abs(v) < 0.005 ? 0 : v;
  return r.toFixed(2);
}

function DetailGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-blue-400">{label}</p>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">{children}</div>
    </div>
  );
}

export default function WbsTreeVisual({ roots }: { roots: RollupNode[] }) {
  // "Big picture first": open with project root + SPK levels expanded (shows SPKs
  // and their phases), everything deeper collapsed until the user drills in.
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
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: RollupNode[] = [];
    if (!filtering) {
      const visit = (n: RollupNode) => {
        if (isMilestone(n)) return;
        out.push(n);
        if (n.children.length && expanded.has(n.id)) n.children.forEach(visit);
      };
      roots.forEach(visit);
      return out;
    }
    const matches = (n: RollupNode) =>
      (filter === 'all' || statusOf(n) === filter) && (q === '' || n.deskripsi.toLowerCase().includes(q));
    const visit = (n: RollupNode): boolean => {
      if (isMilestone(n)) return false;
      if (n.children.length === 0) {
        if (matches(n)) {
          out.push(n);
          return true;
        }
        return false;
      }
      const mark = out.length;
      out.push(n);
      const anyChild = n.children.map(visit).some(Boolean);
      if (!anyChild) out.splice(mark, out.length - mark);
      return anyChild;
    };
    roots.forEach(visit);
    return out;
  }, [roots, expanded, filter, query, filtering]);

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

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Toolbar: status filters + search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
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
                    : 'border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900'
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
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activity…"
            className="w-44 rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-900 transition-all duration-200 ease-ios placeholder:text-gray-400 hover:border-gray-300 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
          <button
            onClick={expandAll}
            className="text-xs text-gray-500 transition-colors duration-200 ease-ios hover:text-gray-900"
          >
            Expand all
          </button>
        </div>
      </div>

      {/* Column header */}
      <div className="grid grid-cols-[minmax(0,1fr)_150px_170px_80px] items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 max-lg:grid-cols-[minmax(0,1fr)_120px_80px]">
        <span>WBS / Activity</span>
        <span className="max-lg:hidden">Weight · This Week</span>
        <span>Progress vs Plan ( | )</span>
        <span className="text-right">Status</span>
      </div>

      <div className="max-h-[70vh] overflow-y-auto">
        {visible.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-gray-400">No activities match this filter.</p>
        )}
        {visible.map((node) => {
          const isLeaf = node.children.length === 0;
          const thisWeek = node.curProgressPct - node.prevProgressPct;
          const detailOpen = openDetail.has(node.id);
          const isRoot = node.depth === 0;
          return (
            <div key={node.id} className="border-b border-gray-100 last:border-b-0">
              <div
                onClick={() => (isLeaf ? toggleDetail(node.id) : !filtering && toggleExpand(node.id))}
                className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_150px_170px_80px] items-center gap-3 px-4 py-2 transition-colors max-lg:grid-cols-[minmax(0,1fr)_120px_80px] ${
                  detailOpen ? 'bg-blue-50/60 hover:bg-blue-50' : isRoot ? 'bg-gray-50/70 hover:bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex min-w-0 items-center" style={{ paddingLeft: node.depth * 16 }}>
                  {!isLeaf ? (
                    <span
                      className="mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center text-[9px] text-gray-400 transition-transform duration-300 ease-spring"
                      style={{ transform: expanded.has(node.id) || filtering ? 'rotate(90deg)' : 'rotate(0deg)' }}
                    >
                      ▶
                    </span>
                  ) : (
                    <span
                      className={`mr-1.5 h-4 w-4 shrink-0 text-center text-[9px] leading-4 text-gray-300 transition-transform duration-300 ease-spring ${
                        detailOpen ? 'rotate-90' : ''
                      }`}
                    >
                      ›
                    </span>
                  )}
                  <span
                    className={`truncate text-sm ${
                      isRoot ? 'font-semibold text-gray-900' : isLeaf ? 'text-gray-600' : 'font-medium text-gray-800'
                    }`}
                    title={node.deskripsi}
                  >
                    {node.deskripsi}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs tabular-nums text-gray-500 max-lg:hidden">
                  <span className="w-12 text-right">{node.bobot.toFixed(2)}</span>
                  {thisWeek > 0.001 ? (
                    <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600">
                      +{thisWeek.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-300">—</span>
                  )}
                </div>
                <Bar node={node} />
                <div className="text-right">
                  <StatusBadge node={node} />
                </div>
              </div>

              {/* Click-to-open numeric detail — same numbers the old table showed,
                  grouped by meaning instead of dumped as a flat row */}
              {isLeaf && detailOpen && (
                <div className="animate-fade-in bg-blue-50/60 px-4 pb-3">
                  <div
                    className="border-l-2 border-blue-400 bg-white py-3.5 pl-5 pr-5 shadow-sm"
                    style={{ marginLeft: 22 + node.depth * 16 }}
                  >
                    <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-wider text-blue-500">
                      Detail · {node.deskripsi}
                    </p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-4">
                    <DetailGroup label="Actual Progress">
                      <span className="text-base font-semibold tabular-nums text-gray-900">
                        {fmt(node.curProgressPct)}%
                      </span>
                      <span className="text-xs tabular-nums text-gray-400">was {fmt(node.prevProgressPct)}%</span>
                      {thisWeek > 0.001 && (
                        <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-blue-600">
                          +{fmt(thisWeek)} this week
                        </span>
                      )}
                    </DetailGroup>
                    <DetailGroup label="Plan">
                      <span className="text-base font-semibold tabular-nums text-gray-900">
                        {fmt(planPctOf(node))}%
                      </span>
                      {node.curProgressPct - planPctOf(node) < -0.005 ? (
                        <span className="text-xs font-medium tabular-nums text-red-600">
                          {fmt(node.curProgressPct - planPctOf(node))}% gap
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-emerald-600">reached</span>
                      )}
                    </DetailGroup>
                    <DetailGroup label="Weight Factor · Actual / Target">
                      <span className="text-base font-semibold tabular-nums text-gray-900">
                        {fmt(node.curWF)}%
                      </span>
                      <span className="text-xs tabular-nums text-gray-400">/ {fmt(node.targetWF)}%</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                          node.curWF - node.targetWF < -0.005
                            ? 'bg-red-50 text-red-600'
                            : 'bg-emerald-50 text-emerald-600'
                        }`}
                      >
                        {node.curWF - node.targetWF >= 0.005 ? '+' : ''}
                        {fmt(node.curWF - node.targetWF)}
                      </span>
                    </DetailGroup>
                    {node.vol != null && node.satuan && (
                      <DetailGroup label="Volume">
                        <span className="text-base font-semibold tabular-nums text-gray-900">
                          {node.vol} {node.satuan}
                        </span>
                      </DetailGroup>
                    )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
        Bar = actual progress · vertical mark = where the plan says it should be · click an activity row for full
        numbers
      </div>
    </div>
  );
}
