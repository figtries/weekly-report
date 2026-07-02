'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RollupNode } from '@/lib/rollup';

interface EditState {
  cumProgressPct?: number;
  planPct?: number;
}

function planPctOf(node: RollupNode): number {
  return node.bobot > 0 ? (node.targetWF / node.bobot) * 100 : 0;
}

/** Round to at most 2 decimals for display (percentages never need more). */
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Milestone rows ("Project Award", "SPK-002 Completed", …) carry no weight — they can't affect any total. */
function isMilestone(node: RollupNode): boolean {
  return node.children.length === 0 && node.bobot === 0;
}

function flattenVisible(roots: RollupNode[], expanded: Set<string>, showMilestones: boolean): RollupNode[] {
  const out: RollupNode[] = [];
  const visit = (node: RollupNode) => {
    if (!showMilestones && isMilestone(node)) return;
    out.push(node);
    if (node.children.length && expanded.has(node.id)) {
      node.children.forEach(visit);
    }
  };
  roots.forEach(visit);
  return out;
}

function flattenAll(roots: RollupNode[]): RollupNode[] {
  const out: RollupNode[] = [];
  const visit = (node: RollupNode) => {
    out.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

export default function WbsTreeTable({
  roots,
  week,
  readOnly = false,
  compact = false,
  title = 'Detail Progress (WBS)',
  subtitle = 'Edit cumulative progress & target on leaf items — parent rollups recompute on save',
}: {
  roots: RollupNode[];
  week: number;
  readOnly?: boolean;
  compact?: boolean;
  title?: string;
  subtitle?: string;
}) {
  const router = useRouter();
  // Default to fully expanded so every activity (and its editable inputs) is visible.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(flattenAll(roots).filter((n) => n.children.length).map((n) => n.id))
  );
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [saving, setSaving] = useState(false);
  const [showMilestones, setShowMilestones] = useState(false);

  const visible = useMemo(() => flattenVisible(roots, expanded, showMilestones), [roots, expanded, showMilestones]);
  const visibleAll = useMemo(() => flattenAll(roots), [roots]);
  const milestoneCount = useMemo(() => visibleAll.filter(isMilestone).length, [visibleAll]);
  const dirtyCount = Object.keys(edits).length;

  function toggle(id: string) {
    setExpanded((prev) => {
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
  }

  function setEdit(id: string, patch: EditState) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function save() {
    if (!dirtyCount) return;
    setSaving(true);
    try {
      // The store keeps plan as a weighted-factor (targetWF); the UI edits it as a
      // percentage, so convert planPct -> targetWF (bobot × planPct / 100) here.
      const nodeById = new Map(visibleAll.map((n) => [n.id, n]));
      const updates: Record<string, { cumProgressPct?: number; targetWF?: number }> = {};
      for (const [id, patch] of Object.entries(edits)) {
        const node = nodeById.get(id);
        updates[id] = {};
        if (patch.cumProgressPct !== undefined) updates[id].cumProgressPct = patch.cumProgressPct;
        if (patch.planPct !== undefined && node) updates[id].targetWF = (node.bobot * patch.planPct) / 100;
      }
      const res = await fetch(`/api/weeks/${week}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const body = await res.json();
        alert(body.error ?? 'Failed to save changes');
        return;
      }
      setEdits({});
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={expandAll} className="text-sm text-gray-500 transition-colors duration-200 ease-ios hover:text-gray-900 active:scale-[0.97]">
            Expand all
          </button>
          <span className="text-gray-300">|</span>
          <button onClick={collapseAll} className="text-sm text-gray-500 transition-colors duration-200 ease-ios hover:text-gray-900 active:scale-[0.97]">
            Collapse all
          </button>
          {milestoneCount > 0 && (
            <>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setShowMilestones((v) => !v)}
                className="text-sm text-gray-500 transition-colors duration-200 ease-ios hover:text-gray-900 active:scale-[0.97]"
              >
                {showMilestones ? 'Hide milestones' : `Show milestones (${milestoneCount})`}
              </button>
            </>
          )}
          {!readOnly && (
            <button
              onClick={save}
              disabled={!dirtyCount || saving}
              className="ml-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all duration-300 ease-ios hover:bg-blue-700 hover:shadow-md active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40"
            >
              {saving ? 'Saving…' : dirtyCount ? `Save ${dirtyCount} change${dirtyCount > 1 ? 's' : ''}` : 'Saved'}
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-20 bg-gray-50">
            <tr className="border-b border-gray-200">
              <th
                className={`${compact ? 'min-w-[240px]' : 'min-w-[380px]'} sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-semibold text-gray-700`}
              >
                WBS / Deskripsi
              </th>
              <th className="px-3 py-2 text-right font-semibold text-gray-700">Bobot (%)</th>
              {!compact && <th className="px-3 py-2 text-right font-semibold text-gray-700">Vol</th>}
              {!compact && <th className="bg-blue-50 px-3 py-2 text-right font-semibold text-gray-700">Prev (%)</th>}
              {!compact && <th className="px-3 py-2 text-right font-semibold text-gray-700">This Week (%)</th>}
              <th className="bg-purple-50 px-3 py-2 text-right font-semibold text-gray-700">Actual (%)</th>
              {!compact && <th className="px-3 py-2 text-right font-semibold text-gray-700">Actual WF (%)</th>}
              <th className="bg-green-50 px-3 py-2 text-right font-semibold text-gray-700">Plan (%)</th>
              {!compact && <th className="px-3 py-2 text-right font-semibold text-gray-700">Target WF (%)</th>}
              <th className="px-3 py-2 text-right font-semibold text-gray-700">Variance (%)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((node) => {
              const isLeaf = node.children.length === 0;
              const milestone = isMilestone(node);
              const editable = isLeaf && !readOnly && !milestone;
              const cum = edits[node.id]?.cumProgressPct ?? round2(node.curProgressPct);
              const planPct = edits[node.id]?.planPct ?? round2(planPctOf(node));
              const curWF = (node.bobot * cum) / 100;
              const targetWF = (node.bobot * planPct) / 100;
              const variance = curWF - targetWF;
              const thisWeek = cum - node.prevProgressPct;
              const isDirty = !!edits[node.id];

              return (
                <tr
                  key={node.id}
                  className={`border-b border-gray-100 transition-colors ${
                    isDirty
                      ? 'bg-amber-50'
                      : node.depth === 0
                        ? 'bg-gray-50 font-semibold hover:bg-gray-100'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <td
                    className={`sticky left-0 z-10 px-3 py-2 ${
                      isDirty
                        ? 'bg-amber-50'
                        : node.depth === 0
                          ? 'bg-gray-50'
                          : 'bg-white'
                    }`}
                  >
                    <div className="flex items-center" style={{ paddingLeft: node.depth * 18 }}>
                      {!isLeaf ? (
                        <button
                          onClick={() => toggle(node.id)}
                          className="mr-1.5 flex h-4 w-4 items-center justify-center text-[10px] text-gray-400 transition-all duration-300 ease-spring hover:text-gray-700"
                          style={{ transform: expanded.has(node.id) ? 'rotate(90deg)' : 'rotate(0deg)' }}
                        >
                          ▶
                        </button>
                      ) : (
                        <span className="mr-1.5 inline-block h-4 w-4" />
                      )}
                      <span className={milestone ? 'italic text-gray-400' : isLeaf ? 'text-gray-700' : 'text-gray-900'}>
                        {node.deskripsi}
                      </span>
                      {milestone && (
                        <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                          Milestone
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{milestone ? '—' : node.bobot.toFixed(2)}</td>
                  {!compact && (
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">
                      {node.vol && node.satuan ? `${node.vol} ${node.satuan}` : ''}
                    </td>
                  )}
                  {!compact && (
                    <td className="bg-blue-50/40 px-3 py-2 text-right text-gray-500">
                      {milestone ? '—' : node.prevProgressPct.toFixed(2)}
                    </td>
                  )}
                  {!compact && (
                    <td
                      className={`px-3 py-2 text-right ${
                        thisWeek < -0.001 ? 'text-red-500' : thisWeek > 0.001 ? 'text-emerald-600' : 'text-gray-400'
                      }`}
                    >
                      {milestone ? '—' : `${thisWeek > 0 ? '+' : ''}${thisWeek.toFixed(2)}`}
                    </td>
                  )}
                  <td className="bg-purple-50/40 px-3 py-2 text-right">
                    {editable ? (
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        value={cum}
                        onChange={(e) => setEdit(node.id, { cumProgressPct: parseFloat(e.target.value) || 0 })}
                        className="w-20 rounded-md border border-blue-300 bg-white px-2 py-1 text-right text-gray-900 shadow-sm transition-all duration-200 ease-ios hover:border-blue-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    ) : (
                      <span className="text-gray-700">{milestone ? '—' : cum.toFixed(2)}</span>
                    )}
                  </td>
                  {!compact && (
                    <td className="px-3 py-2 text-right text-gray-700">{milestone ? '—' : curWF.toFixed(2)}</td>
                  )}
                  <td className="bg-green-50/40 px-3 py-2 text-right">
                    {editable ? (
                      <input
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        value={planPct}
                        onChange={(e) => setEdit(node.id, { planPct: parseFloat(e.target.value) || 0 })}
                        className="w-20 rounded-md border border-blue-300 bg-white px-2 py-1 text-right text-gray-900 shadow-sm transition-all duration-200 ease-ios hover:border-blue-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    ) : (
                      <span className="text-gray-700">{milestone ? '—' : planPct.toFixed(2)}</span>
                    )}
                  </td>
                  {!compact && (
                    <td className="px-3 py-2 text-right text-gray-700">{milestone ? '—' : targetWF.toFixed(2)}</td>
                  )}
                  <td
                    className={`px-3 py-2 text-right font-medium ${
                      milestone ? 'text-gray-400' : variance < 0 ? 'text-red-600' : 'text-green-600'
                    }`}
                  >
                    {milestone ? '—' : variance.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
