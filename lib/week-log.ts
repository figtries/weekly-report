import { currentWeekOf } from './current-week';
import { methodOf, resolveLeafProgress, totalQty } from './progress';
import type { Database, LeafSnapshot, Milestone, ProgressMethod } from './types';

/**
 * One activity, week by week — the arithmetic behind the log in its panel.
 *
 * `leaf_progress` has held a row per week per leaf since the database was
 * made; what did not exist was a way to see and fill ONE activity's weeks in
 * one place. Filling three missed weeks meant changing the week in the week
 * bar, opening the activity, saving, closing, and changing the week again —
 * three times. The log puts every week of the activity in its panel.
 *
 * EVERYTHING HERE IS PURE, and that is the point of the file. The screen runs
 * it to preview a change ("W45 will also move to 35.0%") and the server runs
 * it again to decide what to write, the same pattern as `changeFor` in
 * `lib/work-kind-apply.ts`. A preview that promises something the save does
 * not do is worse than no preview.
 *
 * `lib/progress.ts` still decides every figure: what is stored is evidence
 * (a quantity, the stages reached, a typed percent declared as typed) and the
 * percentage is read off it. Nothing below computes a percent of its own.
 *
 * Full design: docs/superpowers/specs/2026-09-23-log-per-minggu-design.md
 */

/** The fields `resolveLeafProgress` reads off an item. */
export interface LogItem {
  progressMethod: ProgressMethod;
  vol: number | null;
  milestones?: Milestone[];
}

/** What a week stands on. `targetWF` is the schedule's business, never this file's. */
export type WeekEvidence = Omit<LeafSnapshot, 'targetWF'>;

export interface LogRow {
  week: number;
  /** ISO date the week ends on. */
  endDate: string;
  /** Where the plan expects the activity to be by the end of this week, in its own percent. */
  planPct: number;
  /** Where it actually stood, in its own percent. */
  pct: number;
  /**
   * The week has a row of its own. False means it stands on the last week
   * before it that does — the carry-forward every reader already applies.
   */
  recorded: boolean;
  /** An approval exists for this week. */
  signed: boolean;
  /** The evidence the week stands on, carried or its own. */
  evidence: WeekEvidence;
}

export interface LeafWeekLog {
  nodeId: string;
  /** `currentWeekOf` — the project's week, not the one the page is showing. */
  currentWeek: number;
  startWeek: number | null;
  finishWeek: number | null;
  /** The project's last week — how far "Repeat weekly" may run. */
  lastWeek: number;
  /**
   * Whether this log can be written from the panel. False for the imported
   * project, whose history agrees with its signed PDFs until board item 08
   * reconciles the two stores.
   */
  editable: boolean;
  rows: LogRow[];
}

/** Finished, to the two decimals every screen prints — see `lib/worklist.ts`. */
export const COMPLETE_PCT = 99.995;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** The single answer to "what percent does this evidence come to". */
export function figureOf(item: LogItem, ev: WeekEvidence | null | undefined): number {
  if (!ev) return 0;
  return resolveLeafProgress(item, { targetWF: 0, ...ev, cumProgressPct: ev.cumProgressPct ?? 0 });
}

/* ------------------------------------------------------------------ range */

/**
 * Which weeks the log shows.
 *
 * From the plan's start or the first week anything was recorded, whichever is
 * EARLIER — work that began before its plan is still work, and hiding the
 * weeks it was reported in would hide the reason the activity is ahead. To the
 * plan's finish, the last recorded week, or — while the activity is still short
 * of 100% — the current week, whichever is LATER, because an activity that
 * outlives its plan is exactly the one somebody needs to keep filling in.
 *
 * Null when there is nothing to anchor it: no schedule and nothing recorded.
 */
export function logRange({
  weeks,
  startWeek,
  finishWeek,
  recordedWeeks,
  currentWeek,
  complete,
}: {
  /** Every week number the project has. */
  weeks: number[];
  startWeek: number | null;
  finishWeek: number | null;
  recordedWeeks: number[];
  currentWeek: number;
  /** Whether the activity stands at 100% as of the current week. */
  complete: boolean;
}): { from: number; to: number } | null {
  if (!weeks.length) return null;
  const first = Math.min(...weeks);
  const last = Math.max(...weeks);
  const firstRecorded = recordedWeeks.length ? Math.min(...recordedWeeks) : null;
  const lastRecorded = recordedWeeks.length ? Math.max(...recordedWeeks) : null;

  const starts = [startWeek, firstRecorded].filter((w): w is number => w !== null);
  if (!starts.length) return null;
  const ends = [finishWeek, lastRecorded, complete && finishWeek !== null ? null : currentWeek].filter(
    (w): w is number => w !== null
  );

  const from = Math.max(first, Math.min(...starts));
  const to = Math.min(last, Math.max(from, ...ends));
  return { from, to };
}

/* ---------------------------------------------------------------- cascade */

/**
 * Evidence that is at least as far along as both — used to raise a later week
 * that an earlier correction has overtaken. Stages are UNITED rather than
 * copied: a later week that had reached a stage the correction did not mention
 * keeps it.
 */
function mergeUp(week: WeekEvidence, edit: WeekEvidence): WeekEvidence {
  return {
    ...week,
    cumProgressPct: Math.max(week.cumProgressPct ?? 0, edit.cumProgressPct ?? 0),
    ...(week.qtyDone !== undefined || edit.qtyDone !== undefined
      ? { qtyDone: Math.max(week.qtyDone ?? 0, edit.qtyDone ?? 0) }
      : {}),
    ...(week.milestonesDone || edit.milestonesDone
      ? { milestonesDone: [...new Set([...(week.milestonesDone ?? []), ...(edit.milestonesDone ?? [])])] }
      : {}),
    source: edit.source,
  };
}

/** The mirror of `mergeUp`: no further along than either, stages INTERSECTED. */
function mergeDown(week: WeekEvidence, edit: WeekEvidence): WeekEvidence {
  const editDone = new Set(edit.milestonesDone ?? []);
  return {
    ...week,
    cumProgressPct: Math.min(week.cumProgressPct ?? 0, edit.cumProgressPct ?? 0),
    ...(week.qtyDone !== undefined || edit.qtyDone !== undefined
      ? { qtyDone: Math.min(week.qtyDone ?? 0, edit.qtyDone ?? 0) }
      : {}),
    ...(week.milestonesDone || edit.milestonesDone
      ? { milestonesDone: (week.milestonesDone ?? []).filter((id) => editDone.has(id)) }
      : {}),
    source: edit.source,
  };
}

export interface CascadeResult {
  /** Every week to write, the edits themselves included. */
  writes: Map<number, WeekEvidence>;
  /** Recorded weeks the edits moved, with the figure each moves to. */
  moved: { week: number; pct: number }[];
}

/**
 * The actual line never goes DOWN, and nothing moves without being named.
 *
 * Progress is stored cumulative, so correcting week 44 to 60% while week 45
 * already says 50% would put a dip in the curve. The decision (23 Sep 2026)
 * was that week 45 follows the correction up — and a correction DOWN pulls the
 * weeks before it down with it — with the screen saying so before Save.
 *
 * Only weeks with a row of their OWN are touched. A week that is carrying the
 * one before it already follows by construction, and writing a row into it
 * would change what "nobody filled this week in" means for every other screen.
 */
export function cascade(
  item: LogItem,
  recorded: Map<number, WeekEvidence>,
  edits: Map<number, WeekEvidence>
): CascadeResult {
  const writes = new Map(edits);
  const moved: { week: number; pct: number }[] = [];
  const editWeeks = [...edits.keys()].sort((a, b) => a - b);
  if (!editWeeks.length) return { writes, moved };

  const others = [...recorded.keys()].filter((w) => !edits.has(w)).sort((a, b) => a - b);
  for (const w of others) {
    const before = recorded.get(w)!;
    const was = figureOf(item, before);
    let next = before;

    // The nearest edit BEHIND this week is its floor…
    const behind = editWeeks.filter((e) => e < w).pop();
    if (behind !== undefined) {
      const floor = edits.get(behind)!;
      if (figureOf(item, next) < figureOf(item, floor) - 0.004) next = mergeUp(next, floor);
    }
    // …and the nearest edit AHEAD of it is its ceiling.
    const ahead = editWeeks.find((e) => e > w);
    if (ahead !== undefined) {
      const ceil = edits.get(ahead)!;
      if (figureOf(item, next) > figureOf(item, ceil) + 0.004) next = mergeDown(next, ceil);
    }

    const now = figureOf(item, next);
    if (next !== before && Math.abs(now - was) > 0.004) {
      writes.set(w, next);
      moved.push({ week: w, pct: round2(now) });
    }
  }
  return { writes, moved };
}

/* ------------------------------------------------------------ repeat fill */

export type RepeatMode = 'each' | 'total';

export type RepeatResult =
  | {
      ok: true;
      edits: Map<number, WeekEvidence>;
      from: number;
      /** The last week written. Earlier than asked for when 100% came first. */
      last: number;
      /** The week the activity reaches 100%, if the fill gets it there. */
      reached: number | null;
      /** Where the activity ends up, in its own percent. */
      endPct: number;
      /** How much each week adds, in the unit the amount was typed in. */
      perWeek: number;
    }
  | { ok: false; error: string };

/** Whether "Repeat weekly" is offered at all. Stages are ticked, never spread. */
export function canRepeat(item: LogItem): boolean {
  return item.progressMethod === 'lumpsum' || item.progressMethod === 'qty';
}

/**
 * "Add 8% each week for 10 weeks", or "20% in total over 4 weeks".
 *
 * It starts from where the activity stood the week BEFORE `from` — the figure
 * the person is looking at in the row above — and never writes past 100%: it
 * stops on the week that gets there and says which week that was, so the
 * weeks after it simply carry 100%.
 *
 * A quantity item is filled in its own unit ("Add 5 m each week"), and what is
 * stored is the quantity, because the quantity is the evidence. A typed-percent
 * item stores a percent declared as typed (`source: 'manual'`), which is what
 * the panel's own box writes.
 */
export function repeatFill(
  item: LogItem,
  base: WeekEvidence | null,
  {
    from,
    count,
    amount,
    mode,
    lastWeek,
  }: { from: number; count: number; amount: number; mode: RepeatMode; lastWeek: number }
): RepeatResult {
  if (!canRepeat(item)) return { ok: false, error: 'Stages are ticked week by week, not spread' };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount above 0' };
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'Enter at least 1 week' };
  if (from > lastWeek) return { ok: false, error: `W${from} is past the end of the plan` };

  const perWeek = mode === 'each' ? amount : amount / count;
  const edits = new Map<number, WeekEvidence>();
  let reached: number | null = null;
  let last = from;

  if (item.progressMethod === 'qty') {
    const total = totalQty(item);
    const start = Math.max(0, base?.qtyDone ?? 0);
    for (let i = 0; i < count; i++) {
      const week = from + i;
      if (week > lastWeek) break;
      const q = Math.min(total, round2(start + perWeek * (i + 1)));
      edits.set(week, { cumProgressPct: round2((q / total) * 100), qtyDone: q, source: 'qty' });
      last = week;
      if (q >= total) {
        reached = week;
        break;
      }
    }
  } else {
    const start = figureOf(item, base);
    for (let i = 0; i < count; i++) {
      const week = from + i;
      if (week > lastWeek) break;
      const v = Math.min(100, round2(start + perWeek * (i + 1)));
      edits.set(week, { cumProgressPct: v, source: 'manual' });
      last = week;
      if (v >= COMPLETE_PCT) {
        reached = week;
        break;
      }
    }
  }

  return {
    ok: true,
    edits,
    from,
    last,
    reached,
    endPct: round2(figureOf(item, edits.get(last))),
    perWeek: round2(perWeek),
  };
}

/** The evidence a log stands on at a week, carried from the last row at or before it. */
export function evidenceAt(rows: LogRow[], week: number): WeekEvidence | null {
  let found: LogRow | null = null;
  for (const r of rows) if (r.week <= week) found = r;
  return found?.evidence ?? null;
}

/** Recorded weeks of a log, as the map `cascade` reads. */
export function recordedOf(rows: LogRow[]): Map<number, WeekEvidence> {
  const out = new Map<number, WeekEvidence>();
  for (const r of rows) if (r.recorded) out.set(r.week, r.evidence);
  return out;
}

/* ------------------------------------------------------------------- read */

/**
 * One leaf's log, read off the SAME `Database` every report is built from.
 *
 * Both stores hand over `weeks[].leafData` with the actual carried forward and
 * the plan already worked out per week (`targetWF`), so nothing here is a
 * second opinion: the percent in a row is `resolveLeafProgress` on that week's
 * snapshot, which is exactly what the rollup does, and the plan is that week's
 * `targetWF` over the leaf's weight, which is exactly what the map does.
 *
 * WHICH WEEKS ARE "RECORDED". On the SQLite side every `leaf_progress` row
 * arrives as a change-log entry, so a week is recorded when it has one. The
 * imported project's db.json stores every leaf in every week, so there the
 * honest reading is "the figure moved": a week that only repeats the one
 * before it is drawn as carried.
 */
export function buildLeafWeekLog(
  db: Database,
  nodeId: string,
  {
    signedWeeks,
    editable,
    today = new Date(),
  }: { signedWeeks: Set<number>; editable: boolean; today?: Date }
): LeafWeekLog | null {
  const item = db.wbsItems.find((w) => w.id === nodeId);
  if (!item) return null;
  const logItem: LogItem = {
    progressMethod: methodOf(item),
    vol: item.vol ?? null,
    milestones: item.milestones,
  };
  const sched = (db.schedule ?? []).find((s) => s.leafId === nodeId) ?? null;
  const weeks = [...db.weeks].sort((a, b) => a.week - b.week);
  const currentWeek = currentWeekOf(db, today);
  const logged = new Set((db.changeLog ?? []).filter((c) => c.leafId === nodeId).map((c) => c.week));

  const all = weeks.map((w, i) => {
    const snap = w.leafData?.[nodeId];
    const pct = figureOf(logItem, snap);
    const prev = i > 0 ? figureOf(logItem, weeks[i - 1].leafData?.[nodeId]) : 0;
    const recorded = editable ? logged.has(w.week) : Math.abs(pct - prev) > 0.004;
    const planPct =
      item.bobot > 0
        ? ((snap?.targetWF ?? 0) / item.bobot) * 100
        : sched
          ? Math.max(0, Math.min(1, (w.week - sched.startWeek + 1) / (sched.finishWeek - sched.startWeek + 1))) * 100
          : 0;
    const evidence: WeekEvidence = snap
      ? {
          cumProgressPct: snap.cumProgressPct ?? 0,
          ...(snap.qtyDone !== undefined ? { qtyDone: snap.qtyDone } : {}),
          ...(snap.milestonesDone !== undefined ? { milestonesDone: snap.milestonesDone } : {}),
          ...(snap.note !== undefined ? { note: snap.note } : {}),
          ...(snap.source !== undefined ? { source: snap.source } : {}),
        }
      : { cumProgressPct: 0 };
    return {
      week: w.week,
      endDate: w.periodEnd,
      planPct: round2(Math.max(0, Math.min(100, planPct))),
      pct: round2(pct),
      recorded,
      signed: signedWeeks.has(w.week),
      evidence,
    } satisfies LogRow;
  });

  const nowPct = all.filter((r) => r.week <= currentWeek).pop()?.pct ?? 0;
  const range = logRange({
    weeks: weeks.map((w) => w.week),
    startWeek: sched?.startWeek ?? null,
    finishWeek: sched?.finishWeek ?? null,
    recordedWeeks: all.filter((r) => r.recorded).map((r) => r.week),
    currentWeek,
    complete: nowPct >= COMPLETE_PCT,
  });

  return {
    nodeId,
    currentWeek,
    startWeek: sched?.startWeek ?? null,
    finishWeek: sched?.finishWeek ?? null,
    lastWeek: weeks.length ? weeks[weeks.length - 1].week : 0,
    editable,
    rows: range ? all.filter((r) => r.week >= range.from && r.week <= range.to) : [],
  };
}
