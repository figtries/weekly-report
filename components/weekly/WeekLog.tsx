'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Lock } from 'lucide-react';

import {
  getLeafWeeksAction,
  restoreLeafWeeksAction,
  saveLeafWeeksAction,
} from '@/lib/actions';
import type { MapNode } from '@/lib/overall-map';
import type { LeafWeekBefore } from '@/lib/progress-sqlite';
import {
  cascade,
  canRepeat,
  COMPLETE_PCT,
  evidenceAt,
  figureOf,
  recordedOf,
  repeatFill,
  type LeafWeekLog,
  type LogItem,
  type LogRow,
  type RepeatMode,
  type WeekEvidence,
} from '@/lib/week-log';
import { Expand } from '@/components/motion/Expand';
import { cn } from '@/lib/utils';
import ProgressEntry, { deriveShape } from './ProgressEntry';
import type { Draft } from './ActivityPanel';

/**
 * One activity, week by week, inside its panel.
 *
 * The brief (23 Sep 2026): people should not have to change the week in the
 * week bar, open the activity, save, close and change the week again for every
 * week they missed. So the panel carries the activity's own weeks — from the
 * plan's start, or earlier if work began earlier, to the plan's finish, or on
 * to this week while it is still short — and each week's figure is the button
 * that changes it.
 *
 * THE EDITOR OPENS IN THE ROW THAT WAS PRESSED, not in the form at the top of
 * the panel. On a phone the top of the panel has scrolled away by the time
 * somebody presses week 50, and an edit that happens somewhere the thumb is
 * not is an edit made blind. ONE editor at a time, and the open week's own row
 * does not get one at all: it hands focus to the big figure above, so a week
 * never has two places to be edited that could disagree.
 *
 * Rows are native buttons with no animation of their own — a long activity
 * runs sixty weeks, and AGENTS.md keeps per-row cost off anything that long.
 * The arithmetic is `lib/week-log.ts`, shared with the server: what the preview
 * promises ("W45 will also move to 35.0%") is what the save writes.
 */

const fmt1 = (v: number) => v.toFixed(1);
const round2 = (v: number) => Math.round(v * 100) / 100;
const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/** Rows shown before "Show all", and the point past which the list folds at all. */
const WINDOW = 8;
const FOLD_OVER = 10;

function fmtEnd(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function weekList(weeks: number[]) {
  const sorted = [...weeks].sort((a, b) => a - b);
  const contiguous = sorted.every((w, i) => i === 0 || w === sorted[i - 1] + 1);
  if (sorted.length > 2 && contiguous) return `W${sorted[0]}–W${sorted.at(-1)}`;
  const names = sorted.map((w) => `W${w}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

type Editing = { week: number; mode: 'week' | 'repeat' };
type Asking = { week: number; kind: 'future' | 'signed' };
type Confirm = { message: string; yes: string; run: () => void };

export default function WeekLog({
  node,
  week,
  projectId,
  onFocusHeadline,
  onOpenWeekChanged,
}: {
  node: MapNode;
  /** The week the page is showing. Its row hands focus to the figure above. */
  week: number;
  projectId: string | null;
  onFocusHeadline: () => void;
  /** The open week's figure moved as a side effect of a save here. */
  onOpenWeekChanged: (pct: number) => void;
}) {
  const [log, setLog] = useState<LeafWeekLog | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const [signedOk, setSignedOk] = useState<Set<number>>(() => new Set());
  const [draft, setDraft] = useState<Draft>({ qtyDone: 0, milestonesDone: [], pct: 0, note: '' });
  const [typing, setTyping] = useState<string | null>(null);
  const [amount, setAmount] = useState('8');
  const [count, setCount] = useState('4');
  const [mode, setMode] = useState<RepeatMode>('each');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: LeafWeekBefore[] } | null>(null);
  const [saving, startSaving] = useTransition();
  const toastTimer = useRef<number | null>(null);

  // Loaded when the panel opens, for this one activity: the map's own payload
  // never carries sixty weeks of every leaf.
  useEffect(() => {
    let live = true;
    getLeafWeeksAction(node.id, projectId).then((res) => {
      if (!live) return;
      if (res.ok) setLog(res.log);
      else setLoadError(res.error);
    });
    return () => {
      live = false;
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, [node.id, projectId]);

  const item: LogItem = useMemo(
    () => ({
      progressMethod: node.method ?? 'lumpsum',
      vol: node.qtyTotal ?? null,
      milestones: (node.milestones ?? []).map(({ id, label, weight }) => ({ id, label, weight })),
    }),
    [node.method, node.qtyTotal, node.milestones]
  );
  const shape = deriveShape(node);
  const byPercent = item.progressMethod === 'lumpsum';
  const rows = useMemo(() => log?.rows ?? [], [log]);
  const recorded = useMemo(() => recordedOf(rows), [rows]);
  const lastWeek = rows.length ? rows[rows.length - 1].week : week;
  const current = log?.currentWeek ?? week;

  /* ------------------------------------------------------------- preview */

  const pctOfDraft = (d: Draft): number => {
    if (item.progressMethod === 'qty') {
      const total = node.qtyTotal && node.qtyTotal > 0 ? node.qtyTotal : 1;
      return clampPct(round2((d.qtyDone / total) * 100));
    }
    if (item.progressMethod === 'milestone') return round2(figureOf(item, { cumProgressPct: 0, milestonesDone: d.milestonesDone }));
    return clampPct(round2(d.pct));
  };

  const evidenceOfDraft = (d: Draft): WeekEvidence => {
    const pct = pctOfDraft(d);
    const note = d.note ? { note: d.note } : {};
    if (item.progressMethod === 'qty') return { cumProgressPct: pct, qtyDone: d.qtyDone, source: 'qty', ...note };
    if (item.progressMethod === 'milestone') {
      return { cumProgressPct: pct, milestonesDone: d.milestonesDone, source: shape === 'gate' ? 'gate' : 'steps', ...note };
    }
    return { cumProgressPct: pct, source: 'manual', ...note };
  };

  const plan = useMemo(() => {
    if (!editing) return null;
    if (editing.mode === 'week') {
      const edits = new Map([[editing.week, evidenceOfDraft(draft)]]);
      return { edits, fill: null, error: null as string | null, ...cascade(item, recorded, edits) };
    }
    const n = Number(count);
    const r = repeatFill(item, evidenceAt(rows, editing.week - 1), {
      from: editing.week,
      count: Number.isFinite(n) ? Math.floor(n) : 0,
      amount: Number(amount.replace(/,/g, '.')),
      mode,
      lastWeek: log?.lastWeek ?? lastWeek,
    });
    if (!r.ok) return { edits: new Map(), fill: null, error: r.error, writes: new Map(), moved: [] };
    return { edits: r.edits, fill: r, error: null, ...cascade(item, recorded, r.edits) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, draft, amount, count, mode, item, recorded, rows, lastWeek, log]);

  /**
   * Whether the one-week editor holds anything new. A week that has no row of
   * its own can always be saved as it stands — that is "checked it, nothing
   * moved", which is itself a record — but re-saving a recorded week unchanged
   * would only stamp a new time on it.
   */
  const editedRow = editing ? rows.find((r) => r.week === editing.week) : undefined;
  const changed =
    !editing || editing.mode === 'repeat' || !editedRow || !editedRow.recorded
      ? true
      : Math.abs(pctOfDraft(draft) - editedRow.pct) > 0.004 ||
        draft.qtyDone !== (editedRow.evidence.qtyDone ?? 0) ||
        [...draft.milestonesDone].sort().join() !== [...(editedRow.evidence.milestonesDone ?? [])].sort().join() ||
        draft.note !== (editedRow.evidence.note ?? '');

  /** What each row shows: the stored figure, or the preview's while an editor is open. */
  const shown = useMemo(() => {
    if (!plan || !plan.writes.size) return null;
    const merged = new Map(recorded);
    plan.writes.forEach((ev, w) => merged.set(w, ev));
    const out = new Map<number, number>();
    let standing: WeekEvidence | null = null;
    for (const r of rows) {
      if (merged.has(r.week)) standing = merged.get(r.week)!;
      out.set(r.week, round2(figureOf(item, standing)));
    }
    return out;
  }, [plan, recorded, rows, item]);

  /* ------------------------------------------------------------- actions */

  function seed(row: LogRow) {
    setDraft({
      pct: row.pct,
      qtyDone: row.evidence.qtyDone ?? 0,
      milestonesDone: row.evidence.milestonesDone ?? [],
      note: row.evidence.note ?? '',
    });
    setTyping(null);
  }

  function press(row: LogRow) {
    if (!log?.editable || saving) return;
    setConfirm(null);
    setError(null);
    if (row.week === week) {
      setEditing(null);
      setAsking(null);
      onFocusHeadline();
      return;
    }
    if (row.week > current && !opened.has(row.week)) {
      setEditing(null);
      setAsking(asking?.week === row.week ? null : { week: row.week, kind: 'future' });
      return;
    }
    if (row.signed && !signedOk.has(row.week)) {
      setEditing(null);
      setAsking(asking?.week === row.week ? null : { week: row.week, kind: 'signed' });
      return;
    }
    setAsking(null);
    if (editing?.week === row.week) {
      setEditing(null);
      return;
    }
    seed(row);
    setEditing({ week: row.week, mode: 'week' });
  }

  function answerAsk(yes: boolean) {
    if (!asking) return;
    const row = rows.find((r) => r.week === asking.week);
    if (yes && row) {
      if (asking.kind === 'future') setOpened((s) => new Set(s).add(row.week));
      else setSignedOk((s) => new Set(s).add(row.week));
      seed(row);
      setEditing({ week: row.week, mode: 'week' });
    }
    setAsking(null);
  }

  function openWeekPct(next: LeafWeekLog | null): number | null {
    if (!next) return null;
    return round2(figureOf(item, evidenceAt(next.rows, week)));
  }

  function showToast(text: string, undo: LeafWeekBefore[]) {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast({ text, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), 7000);
  }

  function send(allowSigned: boolean) {
    if (!plan || !editing || plan.error) return;
    const edits = [...plan.edits].map(([w, evidence]) => ({ week: w, evidence }));
    const weeks = edits.map((e) => e.week);
    const label =
      editing.mode === 'week' ? `Saved W${editing.week}` : `Filled ${weekList(weeks)}`;
    setConfirm(null);
    setError(null);
    startSaving(async () => {
      const res = await saveLeafWeeksAction(node.id, edits, { allowSigned }, projectId);
      if (!res.ok) {
        if (res.signed?.length) {
          const signed = res.signed;
          setConfirm({
            message: `${weekList(signed)} ${signed.length === 1 ? 'is' : 'are'} signed. Change ${signed.length === 1 ? 'it' : 'them'} anyway?`,
            yes: `Change ${weekList(signed)}`,
            run: () => send(true),
          });
          return;
        }
        setError(res.error);
        return;
      }
      const before = openWeekPct(log ?? null);
      setLog(res.log);
      setEditing(null);
      showToast(label, res.undo);
      const after = openWeekPct(res.log);
      if (after !== null && before !== after) onOpenWeekChanged(after);
    });
  }

  function save() {
    if (!plan || !editing || plan.error || !plan.writes.size) return;
    const touched = [...plan.writes.keys()];
    const signed = touched.filter((w) => rows.find((r) => r.week === w)?.signed && !signedOk.has(w));
    const ahead = [...plan.edits.keys()].filter((w) => w > current && !opened.has(w));
    const lines: string[] = [];
    if (ahead.length) lines.push(`${weekList(ahead)} ${ahead.length === 1 ? "hasn't" : "haven't"} started yet.`);
    if (signed.length) lines.push(`${weekList(signed)} ${signed.length === 1 ? 'is' : 'are'} signed.`);
    if (lines.length) {
      setConfirm({
        message: `${lines.join(' ')} ${editing.mode === 'repeat' ? 'Fill' : 'Change'} ${ahead.length + signed.length === 1 ? 'it' : 'them'} anyway?`,
        yes: editing.mode === 'repeat' ? 'Fill them too' : 'Change anyway',
        run: () => {
          setOpened((s) => new Set([...s, ...ahead]));
          setSignedOk((s) => new Set([...s, ...signed]));
          send(signed.length > 0);
        },
      });
      return;
    }
    send(false);
  }

  function undo() {
    if (!toast || saving) return;
    const before = openWeekPct(log ?? null);
    const rowsBefore = toast.undo;
    setToast(null);
    startSaving(async () => {
      const res = await restoreLeafWeeksAction(node.id, rowsBefore, projectId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setLog(res.log);
      const after = openWeekPct(res.log);
      if (after !== null && before !== after) onOpenWeekChanged(after);
    });
  }

  /* -------------------------------------------------------------- render */

  if (log === undefined) {
    return loadError ? (
      <p className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">{loadError}</p>
    ) : (
      <div className="mt-5 space-y-2" aria-hidden="true">
        <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
    );
  }
  if (!log || rows.length === 0) return null;

  const finish = log.finishWeek;
  const isLate = (r: LogRow) =>
    finish !== null && r.week > finish && r.week <= current && r.pct < COMPLETE_PCT;

  // The window: a few weeks either side of now, every late week, and the
  // row being edited, so folding never hides the thing somebody is working on.
  const anchor = Math.min(Math.max(current, rows[0].week), lastWeek);
  const folds = rows.length > FOLD_OVER;
  const visible =
    !folds || showAll
      ? rows
      : rows.filter(
          (r) =>
            (r.week > anchor - (WINDOW - 2) && r.week <= anchor + 2) ||
            isLate(r) ||
            r.week === editing?.week
        );

  const unit = byPercent ? '%' : ` ${node.unit ?? 'units'}`;
  const moved = plan?.moved ?? [];
  const nWrites = plan?.edits.size ?? 0;

  return (
    <section className="mt-5" aria-label="Week by week">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-foreground">Week by week</h3>
        <span className="text-[11.5px] text-muted-foreground">
          {log.editable ? 'Tap a figure to change it' : 'Read only on this project'}
        </span>
      </div>

      <ul>
        {visible.map((r) => {
          const late = isLate(r);
          const locked = r.week > current && !opened.has(r.week);
          const signedLock = r.signed && !signedOk.has(r.week);
          const preview = shown?.get(r.week);
          const moves = preview !== undefined && Math.abs(preview - r.pct) > 0.004;
          // Dashed means "this week will be WRITTEN". A week after the change
          // that only carries it shows the figure it will stand on, in the
          // carried style, and a locked one stays locked.
          const written = Boolean(plan?.writes.has(r.week));
          const inPreview = written && moves;
          const pct = moves ? preview : r.pct;
          const active = editing?.week === r.week;
          const blank = locked && !written;
          const fill = moves ? 'bg-chart-1/50' : r.recorded ? 'bg-chart-1' : 'bg-chart-1/30';

          return (
            <li key={r.week}>
              <div
                className={cn(
                  'grid min-h-12 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60',
                  late && '-mx-2 rounded-lg border-transparent bg-warn-soft px-2'
                )}
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-foreground">
                    {r.week === current && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="This week" />
                    )}
                    W{r.week}
                  </p>
                  <p
                    className={cn(
                      'text-[11px] leading-tight',
                      late ? 'font-semibold text-warn' : 'text-muted-foreground'
                    )}
                  >
                    {late ? 'Late' : r.week === finish ? 'Plan ends' : fmtEnd(r.endDate)}
                  </p>
                </div>

                <span className="relative block h-1.5">
                  <span className="absolute inset-0 overflow-hidden rounded-full bg-foreground/8">
                    {!blank && (
                      <span
                        className={cn(
                          'absolute inset-y-0 left-0 block w-full origin-left rounded-full transition-transform duration-300 ease-ios',
                          fill
                        )}
                        style={{ transform: `scaleX(${clampPct(pct) / 100})` }}
                      />
                    )}
                  </span>
                  {r.planPct > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute -top-[3px] h-3 w-[2px] rounded-full bg-chart-2"
                      style={{ left: `calc(${Math.min(99.5, r.planPct)}% - 1px)` }}
                    />
                  )}
                </span>

                {log.editable ? (
                  <button
                    type="button"
                    onClick={() => press(r)}
                    aria-expanded={active}
                    aria-label={
                      blank
                        ? `Week ${r.week} has not started. Open it`
                        : `Week ${r.week}, ${fmt1(pct)} percent. Change it`
                    }
                    className="group flex min-h-11 items-center justify-end"
                  >
                    <span
                      className={cn(
                        'inline-flex h-8 min-w-[4.5rem] items-center justify-center gap-1 rounded-full px-3 text-[13px] font-medium tabular-nums transition-colors duration-200 ease-ios',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : inPreview
                            ? 'border border-dashed border-chart-1/60 bg-card text-chart-1'
                            : blank || signedLock
                              ? 'bg-muted text-muted-foreground group-hover:bg-foreground/10'
                              : r.recorded
                                ? 'bg-primary/6 text-primary group-hover:bg-primary group-hover:text-primary-foreground'
                                : 'text-muted-foreground group-hover:bg-muted'
                      )}
                    >
                      {(blank || signedLock) && <Lock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
                      {!blank && `${fmt1(pct)}%`}
                    </span>
                  </button>
                ) : (
                  <span className="min-w-[4.5rem] text-right text-[13px] font-medium tabular-nums text-foreground">
                    {fmt1(pct)}%
                  </span>
                )}
              </div>

              <Expand open={asking?.week === r.week}>
                <div className="mb-2 mt-1 rounded-2xl border border-warn/25 bg-warn-soft p-3">
                  <p className="text-center text-[13px] font-medium text-warn">
                    {asking?.kind === 'signed'
                      ? `W${r.week} is signed. Change it anyway?`
                      : `W${r.week} hasn't started yet. Open it anyway?`}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => answerAsk(false)}
                      className="min-h-11 flex-1 rounded-xl border border-input bg-card text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60"
                    >
                      {asking?.kind === 'signed' ? 'Keep it' : 'Keep locked'}
                    </button>
                    <button
                      type="button"
                      onClick={() => answerAsk(true)}
                      className="btn-primary min-h-11 flex-1 rounded-xl text-sm font-medium"
                    >
                      {asking?.kind === 'signed' ? `Change W${r.week}` : `Open W${r.week}`}
                    </button>
                  </div>
                </div>
              </Expand>

              <Expand open={active}>
                {active && editing && (
                  <div className="mb-2 mt-1 rounded-2xl bg-muted/50 p-3">
                    {canRepeat(item) && (
                      <div className="flex rounded-full bg-foreground/[0.06] p-1" role="tablist">
                        {(['week', 'repeat'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            role="tab"
                            aria-selected={editing.mode === m}
                            onClick={() => {
                              setError(null);
                              setConfirm(null);
                              setEditing({ week: editing.week, mode: m });
                            }}
                            className={cn(
                              'min-h-10 flex-1 rounded-full text-[13px] font-medium transition-colors duration-200 ease-ios',
                              editing.mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            {m === 'week' ? 'This week' : 'Repeat weekly'}
                          </button>
                        ))}
                      </div>
                    )}

                    {editing.mode === 'week' ? (
                      <div className="mt-3">
                        {byPercent ? (
                          <div className="flex items-center justify-center gap-2">
                            <StepPct label="Less" onClick={() => { setTyping(null); setDraft((d) => ({ ...d, pct: clampPct(round2(d.pct - 1)) })); }}>−</StepPct>
                            <div className="group min-w-0">
                              <div className="flex items-baseline justify-center">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  aria-label={`Percent complete in week ${editing.week}`}
                                  value={typing ?? fmt1(draft.pct)}
                                  // The headline's own measure: a digit is 1ch under
                                  // tabular-nums, a dot about half of one.
                                  style={{
                                    width: `${Math.max(
                                      (typing ?? fmt1(draft.pct)).length -
                                        ((typing ?? fmt1(draft.pct)).split('.').length - 1) * 0.55,
                                      1
                                    )}ch`,
                                  }}
                                  onFocus={(e) => e.currentTarget.select()}
                                  onBlur={() => setTyping(null)}
                                  onChange={(e) => {
                                    const cleaned = e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '');
                                    const parts = cleaned.split('.');
                                    const raw = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : cleaned;
                                    setTyping(raw);
                                    const n = Number(raw);
                                    if (raw !== '' && Number.isFinite(n)) setDraft((d) => ({ ...d, pct: clampPct(round2(n)) }));
                                  }}
                                  className="appearance-none border-0 bg-transparent p-0 text-center text-[30px] font-semibold leading-tight tabular-nums tracking-tight text-chart-1 outline-none"
                                />
                                <span className="text-[30px] font-semibold leading-tight tracking-tight text-chart-1">%</span>
                              </div>
                              <div className="mt-1 h-[2px] w-full rounded-full bg-border transition-colors duration-200 ease-ios group-focus-within:bg-chart-1" />
                            </div>
                            <StepPct label="More" onClick={() => { setTyping(null); setDraft((d) => ({ ...d, pct: clampPct(round2(d.pct + 1)) })); }}>+</StepPct>
                          </div>
                        ) : (
                          <>
                            <ProgressEntry
                              node={{
                                ...node,
                                qtyDone: draft.qtyDone,
                                milestones: (node.milestones ?? []).map((m) => ({ ...m, done: draft.milestonesDone.includes(m.id) })),
                              }}
                              draft={draft}
                              setDraft={(fn) => setDraft((d) => fn(d))}
                              shape={shape}
                              onManualOff={() => {}}
                            />
                            <p className="mt-2 text-center text-[13px] font-semibold tabular-nums text-chart-1">
                              {fmt1(pctOfDraft(draft))}%
                            </p>
                          </>
                        )}
                        <p className="mt-1.5 text-center text-[12px] tabular-nums text-muted-foreground">
                          Plan W{editing.week} · {fmt1(r.planPct)}%
                        </p>
                      </div>
                    ) : (
                      <div className="mt-3 text-center">
                        <p className="text-[15px] leading-[2.6] text-foreground">
                          Add{' '}
                          <SentenceInput
                            label="Amount each time"
                            value={amount}
                            onChange={setAmount}
                            decimal
                          />
                          {unit}{' '}
                          <button
                            type="button"
                            onClick={() => setMode((v) => (v === 'each' ? 'total' : 'each'))}
                            className="inline-flex min-h-9 items-center rounded-full bg-primary/6 px-3 align-middle text-[14px] font-medium text-primary transition-colors duration-200 ease-ios hover:bg-primary hover:text-primary-foreground"
                          >
                            {mode === 'each' ? 'each week' : 'in total'}
                          </button>
                          <br />
                          for{' '}
                          <SentenceInput label="Number of weeks" value={count} onChange={setCount} />{' '}
                          {Number(count) === 1 ? 'week' : 'weeks'} from W{editing.week}
                        </p>
                        {plan?.fill && (
                          <p className="text-[13px] font-medium tabular-nums text-chart-1">
                            W{plan.fill.from} → W{plan.fill.last} · ends at {fmt1(plan.fill.endPct)}%
                            {plan.fill.reached !== null && plan.fill.reached < plan.fill.from + Number(count) - 1 && (
                              <span className="block font-normal text-muted-foreground">
                                Reaches 100% in W{plan.fill.reached}
                              </span>
                            )}
                          </p>
                        )}
                        {plan?.fill && [...plan.edits.keys()].some((w) => w > current && !opened.has(w)) && (
                          <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-[12.5px] font-medium text-warn">
                            {weekList([...plan.edits.keys()].filter((w) => w > current && !opened.has(w)))}{' '}
                            {[...plan.edits.keys()].filter((w) => w > current && !opened.has(w)).length === 1
                              ? "hasn't"
                              : "haven't"}{' '}
                            started yet. Apply will ask to open {[...plan.edits.keys()].filter((w) => w > current && !opened.has(w)).length === 1 ? 'it' : 'them'}.
                          </p>
                        )}
                      </div>
                    )}

                    {moved.length > 0 && !plan?.error && (
                      <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-center text-[12.5px] font-medium text-warn">
                        {moved.every((m) => m.pct === moved[0].pct)
                          ? `${weekList(moved.map((m) => m.week))} will also move to ${fmt1(moved[0].pct)}%`
                          : `${weekList(moved.map((m) => m.week))} will also move to keep the line from dropping`}
                      </p>
                    )}
                    {(plan?.error || error) && (
                      <p className="mt-2 text-center text-[13px] font-medium text-bad">{plan?.error ?? error}</p>
                    )}

                    {confirm ? (
                      <div className="mt-3 rounded-xl border border-warn/25 bg-warn-soft p-3">
                        <p className="text-center text-[13px] font-medium text-warn">{confirm.message}</p>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirm(null)}
                            className="min-h-11 flex-1 rounded-xl border border-input bg-card text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={confirm.run}
                            disabled={saving}
                            className="btn-primary min-h-11 flex-1 rounded-xl text-sm font-medium disabled:opacity-40"
                          >
                            {confirm.yes}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            setError(null);
                          }}
                          className="min-h-11 flex-1 rounded-xl border border-input bg-card text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={save}
                          disabled={saving || Boolean(plan?.error) || nWrites === 0 || !changed}
                          className="btn-primary min-h-11 flex-1 rounded-xl text-sm font-medium disabled:opacity-40"
                        >
                          {saving
                            ? 'Saving…'
                            : editing.mode === 'week'
                              ? `Save W${editing.week}`
                              : `Apply to ${nWrites} ${nWrites === 1 ? 'week' : 'weeks'}`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </Expand>
            </li>
          );
        })}
      </ul>

      {folds && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-1 flex min-h-11 w-full items-center justify-center rounded-xl text-[13px] font-medium text-primary transition-colors duration-200 ease-ios hover:bg-primary/6"
        >
          {showAll ? 'Show fewer weeks' : `Show all ${rows.length} weeks`}
        </button>
      )}

      {!editing && error && <p className="mt-2 text-center text-[13px] font-medium text-bad">{error}</p>}

      {toast && (
        <div
          role="status"
          className="animate-fade-in-up sticky bottom-3 z-10 mt-3 flex items-center justify-between gap-3 rounded-full bg-foreground py-1.5 pl-4 pr-1.5 text-[13px] font-medium text-background shadow-lg"
        >
          <span className="min-w-0 truncate">{toast.text}</span>
          <button
            type="button"
            onClick={undo}
            className="min-h-10 shrink-0 rounded-full bg-background/15 px-4 font-semibold transition-colors duration-200 ease-ios hover:bg-background/25"
          >
            Undo
          </button>
        </div>
      )}
    </section>
  );
}

/** The −/+ beside the week's figure: no box, like the panel's own pair. 44px. */
function StepPct({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl font-light text-muted-foreground transition-colors duration-200 ease-ios hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {children}
    </button>
  );
}

/** A number inside a sentence: an underline rather than a box, sized to its digits. */
function SentenceInput({
  value,
  onChange,
  label,
  decimal,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  decimal?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      aria-label={label}
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/,/g, '.').replace(decimal ? /[^0-9.]/g : /[^0-9]/g, '');
        onChange(cleaned.slice(0, 6));
      }}
      style={{ width: `${Math.max(value.length, 1) + 1.5}ch` }}
      className="h-9 border-0 border-b-2 border-border bg-transparent px-1 text-center align-middle text-[16px] font-semibold tabular-nums text-primary outline-none transition-colors duration-200 ease-ios focus:border-chart-1"
    />
  );
}
