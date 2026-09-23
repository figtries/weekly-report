'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { ChevronDown, Layers, Lock } from 'lucide-react';

import { restoreLeafWeeksAction, saveLeafWeeksAction } from '@/lib/actions';
import type { MapNode } from '@/lib/overall-map';
import type { LeafWeekBefore } from '@/lib/progress-sqlite';
import {
  cascade,
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
 * that changes that week.
 *
 * TWO WAYS IN, EACH WITH ONE JOB. A week's figure opens an editor IN ITS ROW
 * for that one week: on a phone the top of the panel has scrolled away by the
 * time somebody presses week 50, and an edit made where the thumb is not is
 * an edit made blind. Several weeks at once is a button at the TOP of the log,
 * always visible — it used to live inside the row editor, and on the activity
 * it was tested on it could not be found at all ("mana itu g ada").
 *
 * A LOCK NEVER HIDES A FIGURE. The first cut blanked every locked week's bar
 * and number, so a 100% recorded in week 36 read as 0% all the way down on a
 * project pinned to week 23. A lock stops an edit; what was recorded stays on
 * screen.
 *
 * Rows are native buttons with no animation of their own — a long activity
 * runs sixty weeks, and AGENTS.md keeps per-row cost off anything that long.
 * The arithmetic is `lib/week-log.ts`, shared with the server: what the preview
 * promises ("W45 will also move to 35.0%") is what the save writes.
 */

const fmt1 = (v: number) => v.toFixed(1);
const round2 = (v: number) => Math.round(v * 100) / 100;
const clampPct = (v: number) => Math.max(0, Math.min(100, v));

/** Rows shown before "Show all", and the length past which the list folds at all. */
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* ---------------------------------------------------------------- loading */

/**
 * Logs this tab has already read, keyed by project and activity, so opening
 * an activity again draws its weeks at once. The fetch still runs behind it
 * and replaces what is shown, so a week saved elsewhere arrives a moment later
 * rather than never.
 */
const logCache = new Map<string, LeafWeekLog | null>();
const cacheKey = (projectId: string | null, nodeId: string) => `${projectId ?? ''}:${nodeId}`;

/** Drop one activity's cached log — its figures just changed outside the log. */
export function forgetLeafLog(projectId: string | null, nodeId: string) {
  logCache.delete(cacheKey(projectId, nodeId));
}

/**
 * The log, over a plain GET — see `lib/week-log-read.ts` for why it is not a
 * server action any more. Three tries, each with its own time limit, because
 * the failure this replaces was a request that simply never answered.
 */
async function loadLog(projectId: string | null, nodeId: string, outer: AbortSignal) {
  const qs = new URLSearchParams({ node: nodeId });
  if (projectId) qs.set('project', projectId);
  let last: unknown = null;
  for (const wait of [0, 700, 1800]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (outer.aborted) throw new DOMException('Aborted', 'AbortError');
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 10_000);
    const stop = () => ctl.abort();
    outer.addEventListener('abort', stop);
    try {
      const res = await fetch(`/api/leaf-weeks?${qs}`, { cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { log: LeafWeekLog | null };
      return body.log ?? null;
    } catch (err) {
      last = err;
    } finally {
      window.clearTimeout(timer);
      outer.removeEventListener('abort', stop);
    }
  }
  throw last;
}

type FillMode = 'range' | 'done';
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
  const key = cacheKey(projectId, node.id);
  const [log, setLogState] = useState<LeafWeekLog | null | undefined>(() =>
    logCache.has(key) ? logCache.get(key) : undefined
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const setLog = (next: LeafWeekLog | null) => {
    logCache.set(key, next);
    setLogState(next);
  };
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [fill, setFill] = useState<FillMode | null>(null);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [amount, setAmount] = useState('5');
  const [spread, setSpread] = useState<RepeatMode>('each');
  const [asking, setAsking] = useState<Asking | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [opened, setOpened] = useState<Set<number>>(() => new Set());
  const [signedOk, setSignedOk] = useState<Set<number>>(() => new Set());
  const [draft, setDraft] = useState<Draft>({ qtyDone: 0, milestonesDone: [], pct: 0, note: '' });
  const [typing, setTyping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: LeafWeekBefore[] } | null>(null);
  const [saving, startSaving] = useTransition();
  const toastTimer = useRef<number | null>(null);

  // Loaded when the panel opens, for this one activity: the map's own payload
  // never carries every week of every leaf. A cached log is already on screen
  // by now; this refreshes it, and a refresh that fails leaves it standing.
  useEffect(() => {
    const ctl = new AbortController();
    loadLog(projectId, node.id, ctl.signal).then(
      (fresh) => {
        logCache.set(key, fresh);
        setLogState(fresh);
        setLoadFailed(false);
      },
      () => {
        if (!ctl.signal.aborted) setLoadFailed(true);
      }
    );
    return () => ctl.abort();
  }, [key, projectId, node.id, attempt]);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    []
  );

  const item: LogItem = useMemo(
    () => ({
      progressMethod: node.method ?? 'lumpsum',
      vol: node.qtyTotal ?? null,
      milestones: (node.milestones ?? []).map(({ id, label, weight }) => ({ id, label, weight })),
    }),
    [node.method, node.qtyTotal, node.milestones]
  );
  const shape = deriveShape(node);
  const byQty = item.progressMethod === 'qty';
  const rows = useMemo(() => log?.rows ?? [], [log]);
  const recorded = useMemo(() => recordedOf(rows), [rows]);
  const lastWeek = log?.lastWeek ?? week;
  const today = log?.todayWeek ?? week;

  /* ------------------------------------------------------------- preview */

  const pctOfDraft = (d: Draft): number => {
    if (item.progressMethod === 'qty') {
      const total = node.qtyTotal && node.qtyTotal > 0 ? node.qtyTotal : 1;
      return clampPct(round2((d.qtyDone / total) * 100));
    }
    if (item.progressMethod === 'milestone') {
      return round2(figureOf(item, { cumProgressPct: 0, milestonesDone: d.milestonesDone }));
    }
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
    if (fill) {
      const count = fill === 'done' ? lastWeek - from + 1 : to - from + 1;
      const r = repeatFill(item, evidenceAt(rows, from - 1), {
        from,
        count,
        amount: Number(amount.replace(/,/g, '.')),
        mode: fill === 'done' ? 'each' : spread,
        lastWeek,
      });
      if (!r.ok) return { edits: new Map<number, WeekEvidence>(), fill: null, error: r.error, writes: new Map<number, WeekEvidence>(), moved: [] as { week: number; pct: number }[] };
      return { edits: r.edits, fill: r, error: null as string | null, ...cascade(item, recorded, r.edits) };
    }
    if (editing !== null) {
      const edits = new Map([[editing, evidenceOfDraft(draft)]]);
      return { edits, fill: null, error: null as string | null, ...cascade(item, recorded, edits) };
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill, from, to, amount, spread, editing, draft, item, recorded, rows, lastWeek]);

  /** What each row shows while something is being previewed. */
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

  /**
   * Whether the one-week editor holds anything new. A week with no row of its
   * own can always be saved as it stands — that is "checked it, nothing
   * moved", itself a record — but re-saving a recorded week unchanged would
   * only stamp a new time on it.
   */
  const editedRow = editing !== null ? rows.find((r) => r.week === editing) : undefined;
  const changed =
    fill || !editedRow || !editedRow.recorded
      ? true
      : Math.abs(pctOfDraft(draft) - editedRow.pct) > 0.004 ||
        draft.qtyDone !== (editedRow.evidence.qtyDone ?? 0) ||
        [...draft.milestonesDone].sort().join() !== [...(editedRow.evidence.milestonesDone ?? [])].sort().join() ||
        draft.note !== (editedRow.evidence.note ?? '');

  /* ------------------------------------------------------------- actions */

  function resetEditors() {
    setEditing(null);
    setFill(null);
    setAsking(null);
    setConfirm(null);
    setError(null);
  }

  function seed(row: LogRow) {
    setDraft({
      pct: row.pct,
      qtyDone: row.evidence.qtyDone ?? 0,
      milestonesDone: row.evidence.milestonesDone ?? [],
      note: row.evidence.note ?? '',
    });
    setTyping(null);
  }

  function openRow(row: LogRow) {
    seed(row);
    setFill(null);
    setConfirm(null);
    setError(null);
    setEditing(row.week);
  }

  function press(row: LogRow) {
    if (!log?.editable || saving) return;
    if (row.week === week) {
      resetEditors();
      onFocusHeadline();
      return;
    }
    if (editing === row.week) {
      resetEditors();
      return;
    }
    const ahead = row.week > today && !opened.has(row.week);
    const signed = row.signed && !signedOk.has(row.week);
    if (ahead || signed) {
      resetEditors();
      setAsking(asking?.week === row.week ? null : { week: row.week, kind: ahead ? 'future' : 'signed' });
      return;
    }
    setAsking(null);
    openRow(row);
  }

  function answerAsk(yes: boolean) {
    if (!asking) return;
    const row = rows.find((r) => r.week === asking.week);
    if (yes && row) {
      if (asking.kind === 'future') setOpened((s) => new Set(s).add(row.week));
      else setSignedOk((s) => new Set(s).add(row.week));
      openRow(row);
    }
    setAsking(null);
  }

  /**
   * "Fill several weeks" opens on the weeks nobody has filled yet: from the
   * week after the last one recorded, to this week — the usual reason to open
   * it is a run of weeks that were missed.
   */
  function toggleFill() {
    if (fill) {
      resetEditors();
      return;
    }
    const lastRecorded = [...recorded.keys()].sort((a, b) => a - b).pop();
    const start = log?.range?.from ?? rows[0]?.week ?? 1;
    const first = Math.min(lastWeek, Math.max(start, lastRecorded !== undefined ? lastRecorded + 1 : start));
    resetEditors();
    setFrom(first);
    setTo(Math.min(lastWeek, Math.max(first, today)));
    setFill('range');
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
    if (!plan || plan.error) return;
    const edits = [...plan.edits].map(([w, evidence]) => ({ week: w, evidence }));
    const label = fill ? `Filled ${weekList(edits.map((e) => e.week))}` : `Saved W${editing}`;
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
      resetEditors();
      showToast(label, res.undo);
      const after = openWeekPct(res.log);
      if (after !== null && before !== after) onOpenWeekChanged(after);
    });
  }

  function save() {
    if (!plan || plan.error || !plan.writes.size) return;
    const touched = [...plan.writes.keys()];
    const signed = touched.filter((w) => rows.find((r) => r.week === w)?.signed && !signedOk.has(w));
    const ahead = [...plan.edits.keys()].filter((w) => w > today && !opened.has(w));
    const lines: string[] = [];
    if (ahead.length) lines.push(`${weekList(ahead)} ${ahead.length === 1 ? "hasn't" : "haven't"} started yet.`);
    if (signed.length) lines.push(`${weekList(signed)} ${signed.length === 1 ? 'is' : 'are'} signed.`);
    if (lines.length) {
      setConfirm({
        message: `${lines.join(' ')} ${fill ? 'Fill' : 'Change'} ${ahead.length + signed.length === 1 ? 'it' : 'them'} anyway?`,
        yes: fill ? 'Fill them too' : 'Change anyway',
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
    // NEVER A SILENT BLANK. The failure this replaces left grey bars on screen
    // forever; now a failed load says so and offers the way back.
    return loadFailed ? (
      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-bad-soft px-3.5 py-2.5">
        <p className="text-[13px] font-medium text-bad">Couldn&apos;t load the weeks.</p>
        <button
          type="button"
          onClick={() => {
            setLoadFailed(false);
            setAttempt((n) => n + 1);
          }}
          className="min-h-11 shrink-0 rounded-full border border-bad/25 bg-card px-4 text-[13px] font-semibold text-bad transition-colors duration-200 ease-ios hover:bg-bad/10"
        >
          Try again
        </button>
      </div>
    ) : (
      <div className="mt-5 space-y-2" aria-hidden="true">
        <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-11 animate-pulse rounded-xl bg-muted/60" />
        ))}
      </div>
    );
  }
  if (!log || !log.range || rows.length === 0) return null;

  const range = log.range;
  const finish = log.finishWeek;
  const isLate = (r: LogRow) => finish !== null && r.week > finish && r.week <= today && r.pct < COMPLETE_PCT;
  const written = plan?.writes ?? new Map<number, WeekEvidence>();

  // The shown range, plus any week a fill is about to write outside it; then,
  // on a long activity, a window a few weeks either side of today and whatever
  // is being edited — folding never hides the thing somebody is working on.
  // Late weeks fold like any other: forcing them all open turned an activity
  // 22 weeks late into a wall of 34 yellow rows, and the notice above the log
  // already says how late it is.
  const inRange = rows.filter((r) => (r.week >= range.from && r.week <= range.to) || written.has(r.week));
  const anchor = Math.min(Math.max(today, range.from), range.to);
  const folds = inRange.length > FOLD_OVER;
  const visible =
    !folds || showAll
      ? inRange
      : inRange.filter(
          (r) =>
            (r.week > anchor - (WINDOW - 2) && r.week <= anchor + 2) ||
            r.week === editing ||
            written.has(r.week)
        );

  const unit = byQty ? ` ${node.unit ?? 'units'}` : '%';
  const moved = plan?.moved ?? [];
  const nWrites = plan?.edits.size ?? 0;
  const aheadInFill = fill ? [...(plan?.edits.keys() ?? [])].filter((w) => w > today && !opened.has(w)) : [];
  const weekOptions = rows.map((r) => r.week);

  const warning =
    moved.length > 0 && !plan?.error
      ? moved.every((m) => m.pct === moved[0].pct)
        ? `${weekList(moved.map((m) => m.week))} will also move to ${fmt1(moved[0].pct)}%`
        : `${weekList(moved.map((m) => m.week))} will also move, so the line never drops`
      : null;

  /** Save / confirm row, shared by the fill and the one-week editor. */
  const actions = (primary: string) =>
    confirm ? (
      <div className="mt-3 rounded-xl border border-warn/25 bg-warn-soft p-3">
        <p className="text-center text-[13px] font-medium text-warn">{confirm.message}</p>
        <div className="mt-3 flex gap-2">
          <SecondaryButton onClick={() => setConfirm(null)}>Cancel</SecondaryButton>
          <PrimaryButton onClick={confirm.run} disabled={saving}>
            {confirm.yes}
          </PrimaryButton>
        </div>
      </div>
    ) : (
      <div className="mt-4 flex gap-2">
        <SecondaryButton onClick={resetEditors}>Cancel</SecondaryButton>
        <PrimaryButton onClick={save} disabled={saving || Boolean(plan?.error) || nWrites === 0 || !changed}>
          {saving ? 'Saving…' : primary}
        </PrimaryButton>
      </div>
    );

  const notes = (
    <>
      {warning && <Notice>{warning}</Notice>}
      {(plan?.error || error) && (
        <p className="mt-3 text-center text-[13px] font-medium text-bad">{plan?.error ?? error}</p>
      )}
    </>
  );

  return (
    <section className="mt-6" aria-label="Week by week">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-foreground">Week by week</h3>
          <p className="text-[11.5px] text-muted-foreground">
            {log.editable ? "Tap a week's figure to change it" : 'Read only on this project'}
          </p>
        </div>
        {log.editable && (
          <button
            type="button"
            onClick={toggleFill}
            aria-expanded={Boolean(fill)}
            className={cn(
              'flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-200 ease-ios',
              fill
                ? 'bg-primary text-primary-foreground'
                : 'bg-primary/6 text-primary hover:bg-primary hover:text-primary-foreground'
            )}
          >
            <Layers className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
            Fill several weeks
          </button>
        )}
      </div>

      <Expand open={Boolean(fill)}>
        {fill && (
          <div className="mt-3 rounded-2xl bg-muted/40 p-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-foreground/[0.06] p-1" role="tablist">
              {(['range', 'done'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={fill === m}
                  onClick={() => {
                    setConfirm(null);
                    setFill(m);
                  }}
                  className={cn(
                    'min-h-10 rounded-lg text-[13px] font-medium transition-colors duration-200 ease-ios',
                    fill === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m === 'range' ? 'Up to a week' : 'Until 100%'}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-2.5 text-[15px] text-foreground">
              <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                <span>Add</span>
                <AmountInput value={amount} onChange={setAmount} unit={unit} />
                {fill === 'range' ? (
                  <button
                    type="button"
                    onClick={() => setSpread((v) => (v === 'each' ? 'total' : 'each'))}
                    className="inline-flex min-h-9 items-center rounded-full bg-primary/6 px-3 text-[14px] font-medium text-primary transition-colors duration-200 ease-ios hover:bg-primary hover:text-primary-foreground"
                  >
                    {spread === 'each' ? 'each week' : 'in total'}
                  </button>
                ) : (
                  <span>each week</span>
                )}
              </p>
              <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
                <span>from</span>
                <WeekSelect
                  label="First week"
                  value={from}
                  weeks={weekOptions}
                  onChange={(w) => {
                    setFrom(w);
                    if (to < w) setTo(w);
                  }}
                />
                {fill === 'range' ? (
                  <>
                    <span>to</span>
                    <WeekSelect label="Last week" value={to} weeks={weekOptions.filter((w) => w >= from)} onChange={setTo} />
                  </>
                ) : (
                  <span>until it is done</span>
                )}
              </p>
            </div>

            {plan?.fill && (
              <div className="mt-4 border-t border-border/60 pt-3 text-center">
                <p className="text-[13px] font-semibold tabular-nums text-chart-1">
                  W{plan.fill.from} → W{plan.fill.last} · {plural(plan.fill.last - plan.fill.from + 1, 'week', 'weeks')} ·
                  ends at {fmt1(plan.fill.endPct)}%
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {plan.fill.reached !== null
                    ? `Reaches 100% in W${plan.fill.reached}, and the weeks after it stay there`
                    : fill === 'done'
                      ? `Only reaches ${fmt1(plan.fill.endPct)}% by W${plan.fill.last}, the end of the plan`
                      : `${byQty ? `${plan.fill.perWeek}${unit}` : `${fmt1(plan.fill.perWeek)}%`} added each week`}
                </p>
              </div>
            )}
            {aheadInFill.length > 0 && !plan?.error && (
              <Notice>
                {weekList(aheadInFill)} {aheadInFill.length === 1 ? "hasn't" : "haven't"} started yet. Apply will ask
                first.
              </Notice>
            )}
            {notes}
            {actions(`Apply to ${plural(nWrites, 'week', 'weeks')}`)}
          </div>
        )}
      </Expand>

      <ul className="mt-2">
        {visible.map((r) => {
          const late = isLate(r);
          const locked = r.week > today && !opened.has(r.week);
          const signedLock = r.signed && !signedOk.has(r.week);
          const preview = shown?.get(r.week);
          const moves = preview !== undefined && Math.abs(preview - r.pct) > 0.004;
          // Dashed means "this week will be WRITTEN". A week after the change
          // that only carries it shows the figure it will stand on, in the
          // carried style.
          const writes = written.has(r.week);
          const pct = moves ? preview! : r.pct;
          const active = editing === r.week;
          const fillColor = moves ? 'bg-chart-1/50' : r.recorded ? 'bg-chart-1' : 'bg-chart-1/30';

          return (
            <li key={r.week}>
              {/* A late week says so in its label, in the warn colour, and
                  nothing more: a tinted band on every late row stacked into a
                  wall of yellow on anything more than a few weeks behind. */}
              <div className="grid min-h-12 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold tabular-nums text-foreground">
                    {r.week === today && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="This week" />
                    )}
                    W{r.week}
                  </p>
                  <p className={cn('text-[11px] leading-tight', late ? 'font-semibold text-warn' : 'text-muted-foreground')}>
                    {late ? 'Late' : r.week === finish ? 'Plan ends' : fmtEnd(r.endDate)}
                  </p>
                </div>

                <span className="relative block h-1.5">
                  <span className="absolute inset-0 overflow-hidden rounded-full bg-foreground/8">
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 block w-full origin-left rounded-full transition-transform duration-300 ease-ios',
                        fillColor
                      )}
                      style={{ transform: `scaleX(${clampPct(pct) / 100})` }}
                    />
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
                    aria-label={`Week ${r.week}, ${fmt1(pct)} percent${locked ? ', not started yet' : signedLock ? ', signed' : ''}. Change it`}
                    className="group flex min-h-11 items-center justify-end"
                  >
                    <span
                      className={cn(
                        'inline-flex h-8 min-w-[4.75rem] items-center justify-center gap-1 rounded-full px-3 text-[13px] font-medium tabular-nums transition-colors duration-200 ease-ios',
                        active
                          ? 'bg-primary text-primary-foreground'
                          : writes && moves
                            ? 'border border-dashed border-chart-1/60 bg-card text-chart-1'
                            : locked || signedLock
                              ? 'bg-muted text-muted-foreground group-hover:bg-foreground/10'
                              : r.recorded
                                ? 'bg-primary/6 text-primary group-hover:bg-primary group-hover:text-primary-foreground'
                                : 'text-muted-foreground group-hover:bg-muted'
                      )}
                    >
                      {(locked || signedLock) && !writes && (
                        <Lock className="h-3 w-3 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                      )}
                      {fmt1(pct)}%
                    </span>
                  </button>
                ) : (
                  <span className="min-w-[4.75rem] text-right text-[13px] font-medium tabular-nums text-foreground">
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
                    <SecondaryButton onClick={() => answerAsk(false)}>
                      {asking?.kind === 'signed' ? 'Keep it' : 'Keep locked'}
                    </SecondaryButton>
                    <PrimaryButton onClick={() => answerAsk(true)}>
                      {asking?.kind === 'signed' ? `Change W${r.week}` : `Open W${r.week}`}
                    </PrimaryButton>
                  </div>
                </div>
              </Expand>

              <Expand open={active}>
                {active && (
                  <div className="mb-2 mt-1 rounded-2xl bg-muted/40 p-4">
                    {item.progressMethod === 'lumpsum' ? (
                      <div className="flex items-center justify-center gap-2">
                        <StepPct
                          label="Less"
                          onClick={() => {
                            setTyping(null);
                            setDraft((d) => ({ ...d, pct: clampPct(round2(d.pct - 1)) }));
                          }}
                        >
                          −
                        </StepPct>
                        <div className="group min-w-0">
                          <div className="flex items-baseline justify-center">
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Percent complete in week ${r.week}`}
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
                        <StepPct
                          label="More"
                          onClick={() => {
                            setTyping(null);
                            setDraft((d) => ({ ...d, pct: clampPct(round2(d.pct + 1)) }));
                          }}
                        >
                          +
                        </StepPct>
                      </div>
                    ) : (
                      <>
                        <ProgressEntry
                          node={{
                            ...node,
                            qtyDone: draft.qtyDone,
                            milestones: (node.milestones ?? []).map((m) => ({
                              ...m,
                              done: draft.milestonesDone.includes(m.id),
                            })),
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
                      Plan W{r.week} · {fmt1(r.planPct)}%
                    </p>
                    {notes}
                    {actions(`Save W${r.week}`)}
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
          {showAll ? 'Show fewer weeks' : `Show all ${inRange.length} weeks`}
        </button>
      )}

      {editing === null && !fill && error && (
        <p className="mt-2 text-center text-[13px] font-medium text-bad">{error}</p>
      )}

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

/* ------------------------------------------------------------------ parts */

function PrimaryButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="btn-primary min-h-11 flex-1 rounded-xl px-3 text-sm font-medium disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 flex-1 rounded-xl border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors duration-200 ease-ios hover:bg-muted/60"
    >
      {children}
    </button>
  );
}

/** A warn-coloured line: something else will happen too, said before it does. */
function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-center text-[12.5px] font-medium text-warn">{children}</p>
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

/**
 * The amount inside the sentence: an underline rather than a box, sized to its
 * digits, with its unit sitting against it so "8 %" never wraps apart.
 */
function AmountInput({ value, onChange, unit }: { value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <span className="inline-flex items-baseline">
      <input
        type="text"
        inputMode="decimal"
        aria-label="Amount each week"
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value.replace(/,/g, '.').replace(/[^0-9.]/g, '').slice(0, 6))}
        style={{ width: `${Math.max(value.length, 1) + 0.9}ch` }}
        className="h-9 border-0 border-b-2 border-border bg-transparent px-1 text-center text-[17px] font-semibold tabular-nums text-primary outline-none transition-colors duration-200 ease-ios focus:border-chart-1"
      />
      <span className="text-[15px] font-medium text-primary">{unit.trim()}</span>
    </span>
  );
}

/**
 * A week, chosen from the project's own weeks. Native, so a phone gets its own
 * wheel rather than a popover nobody can hit, and dressed as the pill every
 * other choice in this sentence is.
 */
function WeekSelect({
  value,
  weeks,
  onChange,
  label,
}: {
  value: number;
  weeks: number[];
  onChange: (w: number) => void;
  label: string;
}) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-h-9 cursor-pointer appearance-none rounded-full bg-primary/6 py-1 pl-3.5 pr-8 text-[14px] font-medium tabular-nums text-primary outline-none transition-colors duration-200 ease-ios hover:bg-primary/12 focus-visible:ring-2 focus-visible:ring-chart-1"
      >
        {weeks.map((w) => (
          <option key={w} value={w}>
            W{w}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-primary"
        strokeWidth={2.25}
        aria-hidden="true"
      />
    </span>
  );
}
