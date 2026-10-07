'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { m } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';

import { pressMotion } from '@/components/motion/Press';
import WorkKindPicker, { type WorkKindPeer, type WorkKindPickerHandle } from '@/components/weekly/WorkKindPicker';
import type { Sheet, SheetRow } from '@/lib/sheet';
import type { BarFact } from '@/lib/bar-facts';
import { paintCss, paintOf, segmentsOf, type BarView } from '@/lib/bar-view';
import { reachOf } from '@/lib/kind-reach';
import { changeFor, impactOf, ladderFor } from '@/lib/work-kind-apply';
import { setKindInPlanAction } from '@/lib/kind-plan-actions';
import { BUILT_IN_KINDS, shapeOf, type Shape } from '@/lib/work-kind';
import type { Milestone } from '@/lib/types';

const fmt1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * "What kind of work is this?", asked in the plan (7 Oct 2026).
 *
 * The same picker Data Overall used to ask it with, so the answers and their
 * suggestions are the ones people already know. Under it, the bar this row
 * will get, and the one thing worth saying before Save when progress is
 * already recorded: what the figure becomes in the new kind's stages.
 */
export default function KindView({
  row,
  rows,
  facts,
  view,
  projectId,
  onBack,
  onSaved,
}: {
  row: SheetRow;
  rows: SheetRow[];
  facts: Record<string, BarFact>;
  view: BarView;
  projectId: string;
  onBack: () => void;
  onSaved: (sheet: Sheet, facts: Record<string, BarFact>) => void;
}) {
  const fact = facts[row.id];
  const picker = useRef<WorkKindPickerHandle>(null);
  const [pick, setPick] = useState<{ kindId: string; shape: Shape; steps: Milestone[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  // Every row with an answer, for the picker's "same as …" suggestion.
  const peers = useMemo<WorkKindPeer[]>(
    () =>
      rows.flatMap((r) => {
        const f = facts[r.id];
        return !r.isSummary && f?.kindId && f.shape ? [{ name: r.name, kindId: f.kindId, shape: f.shape }] : [];
      }),
    [rows, facts]
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // On a heading, the rows the answer would reach, by the same walk the write uses.
  const reach = useMemo(() => {
    if (!row.isSummary) return null;
    const kids = new Map<string, { id: string; kind: string | null }[]>();
    for (const r of rows) {
      if (!r.parentId) continue;
      const entry = { id: r.id, kind: facts[r.id]?.kindId ?? null };
      const list = kids.get(r.parentId);
      if (list) list.push(entry);
      else kids.set(r.parentId, [entry]);
    }
    const heading = { id: row.id, kind: facts[row.id]?.kindId ?? null };
    // Before an answer is picked, count what a NEW kind would reach.
    return reachOf(heading, pick?.kindId ?? '\u0000', kids).filter((id) => !byId.get(id)?.isSummary);
  }, [row, rows, facts, pick, byId]);

  // What recorded progress becomes, said BEFORE Save, in the project's own
  // points: a kind change restates each row to the last stage it has fully
  // reached, and how far that moves the project is the person's call to make.
  // Construction has no stages until Data Overall gives the part, so nothing
  // recorded moves.
  let impact: string | null = null;
  if (pick && pick.shape !== 'qty' && pick.kindId !== 'construction') {
    const kind = BUILT_IN_KINDS.find((k) => k.id === pick.kindId);
    // The same ladder each row will get from the server (lib/kind-plan.ts).
    const changes = (row.isSummary ? reach ?? [] : [row.id]).flatMap((id) => {
      const r = byId.get(id);
      const pct = facts[id]?.donePct ?? 0;
      if (!r || r.isSummary || pct <= 0 || !kind) return [];
      const steps = row.isSummary
        ? ladderFor(pick.kindId, shapeOf(r.name, kind), r.name, BUILT_IN_KINDS)
        : pick.steps;
      return steps.length ? [changeFor({ id, name: r.name, bobot: r.bobot ?? 0, pct }, steps)] : [];
    });
    const { movedRows, pointsDelta } = impactOf(changes);
    const points =
      Math.abs(pointsDelta) < 0.005
        ? 'the project figure does not move'
        : `the project moves ${pointsDelta > 0 ? '+' : ''}${pointsDelta.toFixed(2)} points`;
    if (!row.isSummary && movedRows) {
      const ch = changes[0];
      impact = `Its ${fmt1(ch.fromPct)}% becomes ${fmt1(ch.toPct)}%, the last stage it has fully reached: ${points}.`;
    } else if (row.isSummary && movedRows) {
      impact = `${movedRows} of the ${reach?.length ?? 0} rows keep only the stages they have fully reached: ${points}.`;
    }
  }

  const previewSteps = pick?.steps ?? (fact?.rungs.length ? fact.rungs : []);
  const previewColour = paintCss(paintOf(row, pick?.kindId ?? fact?.kindId ?? null, view, 'kind'));
  const parts = segmentsOf(
    previewSteps.map((s) => ({ label: s.label, weight: s.weight, done: false })),
    0
  );

  function save() {
    const c = picker.current?.choice() ?? null;
    if (!c || c === 'same') return onBack();
    setError(null);
    startSaving(async () => {
      const res = await setKindInPlanAction(projectId, row.id, c.kindId, c.shape, c.steps);
      if (!res.ok) return setError(res.error);
      onSaved(res.sheet, res.facts);
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-[13px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back
      </button>

      {reach && (
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          {reach.length
            ? `Applies to the ${reach.length} ${reach.length === 1 ? 'row' : 'rows'} under it that have no kind of their own.`
            : 'Every row under it already has a kind of its own; only the heading changes.'}
        </p>
      )}

      <div className="mt-3 rounded-2xl bg-muted/40 p-3">
        <WorkKindPicker
          ref={picker}
          node={{ id: row.id, name: row.name }}
          peers={peers}
          current={fact?.kindId ?? null}
          onPick={(kindId, shape, steps) => setPick({ kindId, shape, steps })}
          onCancel={() => setPick(null)}
        />
      </div>

      {parts.length > 0 && previewSteps.length > 0 && (
        <div className="mt-4">
          <p className="text-[12px] text-muted-foreground">On the timeline</p>
          <div className="mt-1.5 flex h-5 gap-px overflow-hidden rounded-[4px]">
            {parts.map((p, i) => (
              <span
                key={i}
                className="relative flex items-center overflow-hidden"
                style={{ flexBasis: `${(p.to - p.from) * 100}%` }}
              >
                <span className="absolute inset-0" style={{ background: previewColour, opacity: 0.28 }} />
                <span className="relative truncate px-1.5 text-[11px] font-medium text-foreground">{p.label}</span>
              </span>
            ))}
          </div>
          <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
            Each stage turns solid when it is ticked in Data Overall.
          </p>
        </div>
      )}

      {(pick?.kindId ?? fact?.kindId) === 'construction' && (
        <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
          Which part of construction it is, and its stages, are set in Data Overall.
        </p>
      )}

      {impact && <p className="mt-3 rounded-lg bg-warn/10 px-3 py-2 text-[13px] leading-snug text-warn">{impact}</p>}
      {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 rounded-lg px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <m.button
          {...pressMotion}
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary ml-auto min-h-11 rounded-lg px-5 text-[13px] font-semibold disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save'}
        </m.button>
      </div>
    </div>
  );
}
