/**
 * Everything Data Overall shows about the forecast, worked out on the server
 * and handed to the client as plain data: which activities will slip, what
 * the app found in the data that somebody can answer (lib/forecast-checks.ts),
 * and per activity its finish, the one date question it deserves, and what
 * it waits for.
 *
 * The forecast itself is the dashboard's. Over the map it is two reminder
 * buttons beside "late" and "ending soon", not a figure of its own: a strip
 * with the finish, the setter, the checks and a one-press Link, plus up to
 * four warning boxes in every panel, read as too much to take in (28 Sep
 * 2026). Links are the planner's, one activity at a time: EPC order only
 * suggests.
 *
 * It decides nothing of its own. The finish is lib/forecast.ts's, the
 * suggestions lib/forecast-epc.ts's, the slips `slippingOf`'s (the same
 * rows Priority Actions names), the percentages lib/progress.ts's.
 */
import { dayOf, isoOf, weekContaining, type ForecastSource, type StepBasis } from './forecast';
import { forecastChecks } from './forecast-checks';
import { profileRowsOf, suggestWaitsFor } from './forecast-epc';
import { forecastFromDb, slippingOf } from './forecast-read';
import { r2 } from './figures';
import { resolveLeafProgress } from './progress';
import { computeGrandTotal, computeRollup, promoteNestedSpkContracts } from './rollup';
import { tidyName } from './tidy-name';
import { BUILT_IN_KINDS } from './work-kind';
import type { Database, Milestone } from './types';

export interface LinkRef {
  id: string;
  code: string;
  name: string;
}

/** Something an activity waits for, with where that one stands against its plan. */
export interface WaitRef extends LinkRef {
  state: 'done' | 'on-plan' | 'late';
  /** Whole weeks its own forecast runs past its plan; 0 unless late. */
  lateWeeks: number;
}

/**
 * Why the finish is what it is, in the terms the panel says it in. Worked out
 * here so the sentence and the figure cannot disagree.
 */
export type ForecastReason =
  | { kind: 'done' }
  | { kind: 'typed' }
  | { kind: 'measured' }
  | { kind: 'pushed'; by: LinkRef; weeks: number }
  | { kind: 'behind'; weeks: number }
  | { kind: 'plan' };

export interface ForecastLeafView {
  finish: string;
  finishWeek: number;
  planStart: string;
  planStartWeek: number;
  planFinish: string;
  planFinishWeek: number;
  basis: StepBasis;
  source: ForecastSource | null;
  reason: ForecastReason;
  /** On the path that sets the project's finish. */
  onPath: boolean;
  /** The one date question this activity deserves now; null when it is done or measured by quantity. */
  next: { rungId: string | null; label: string; planDate: string } | null;
  typed: { date: string; source: ForecastSource; rungId: string | null; week: number; label: string } | null;
  /**
   * What it waits for, as the planner set it. NULL on the row (nobody asked
   * yet) and [] (asked: nothing) both arrive empty; `answered` tells them apart.
   */
  waitsFor: WaitRef[];
  answered: boolean;
  /** EPC order's guess. Offered to press while nobody has answered; marked in the picker after. */
  suggested: LinkRef[];
}

export interface ForecastView {
  week: number;
  finishWeek: number;
  finishDate: string;
  lastWeek: number;
  path: LinkRef[];
  /** Activities finishing past their plan on evidence, most weeks first ("will slip"). */
  slipping: { leaf: LinkRef; weeks: number; line: string }[];
  /** Activities with a finding somebody can answer, in plan order, with why ("to check"). */
  toCheck: { leaf: LinkRef; reasons: string[] }[];
  leaves: Record<string, ForecastLeafView>;
  /** Every scheduled activity, in plan order, for "What has to finish before this one?". */
  options: LinkRef[];
  /** Weeks where progress arrived in bulk after weeks of nothing. */
  bulkWeeks: number[];
}

const kindLabel = (id: string | null | undefined) => BUILT_IN_KINDS.find((k) => k.id === id)?.label ?? null;
const fmt1 = (v: number) => v.toFixed(1);

/** The day the plan's straight line reaches the end of a rung. */
function rungPlanDate(rungs: Milestone[], rungId: string, planStart: string, planFinish: string): string {
  const total = rungs.reduce((s, r) => s + r.weight, 0);
  const at = rungs.findIndex((r) => r.id === rungId);
  const PS = dayOf(planStart);
  const duration = dayOf(planFinish) - PS + 1;
  if (total <= 0 || at < 0) return planFinish;
  const through = rungs.slice(0, at + 1).reduce((s, r) => s + r.weight, 0) / total;
  return isoOf(PS + Math.max(0, Math.ceil(through * duration) - 1));
}

export function buildForecastView(db: Database, week: number): ForecastView | null {
  const read = forecastFromDb(db, week);
  if (!read) return null;
  const weeks = [...db.weeks].sort((a, b) => a.week - b.week);
  const meta = weeks.find((w) => w.week === week);
  if (!meta) return null;
  const weekEnds = weeks.map((w) => ({ week: w.week, end: w.periodEnd }));
  const byId = new Map(db.wbsItems.map((i) => [i.id, i]));
  const ref = (id: string): LinkRef => {
    const i = byId.get(id);
    return { id, code: i?.wbsCode ?? '', name: tidyName(i?.deskripsi ?? '') };
  };
  const dates = new Map((db.schedule ?? []).map((s) => [s.leafId, s]));
  const { forecast } = read;
  const onPath = new Set(forecast.chain);
  const weekOf = (iso: string) => weekContaining(iso, weekEnds);
  const waitRef = (id: string): WaitRef => {
    const lf = forecast.leaves.get(id)!;
    const s = dates.get(id);
    const late = lf.basis === 'done' || !s?.finishDate ? 0 : Math.max(0, weekOf(lf.finish) - weekOf(s.finishDate));
    return { ...ref(id), state: lf.basis === 'done' ? 'done' : late > 0 ? 'late' : 'on-plan', lateWeeks: late };
  };
  const guesses = suggestWaitsFor(profileRowsOf(db.wbsItems));

  // The project's actual, week by week, for the bulk-entry check.
  const actualByWeek: number[] = [];
  for (const w of weeks.filter((x) => x.week <= week)) {
    const prev = weeks.find((x) => x.week === w.week - 1);
    const gt = computeGrandTotal(
      promoteNestedSpkContracts(computeRollup(db.wbsItems, w.leafData, prev?.leafData ?? null))
    );
    actualByWeek.push(r2(gt.curProgressPct));
  }

  const checks = forecastChecks({
    items: db.wbsItems,
    leafData: meta.leafData,
    actualByWeek,
    chain: forecast.chain,
    leaves: forecast.leaves,
  });

  const leaves: Record<string, ForecastLeafView> = {};
  const reasons = new Map<string, string[]>();
  const say = (id: string, why: string) => reasons.set(id, [...(reasons.get(id) ?? []), why]);
  const ordered = db.wbsItems
    .filter((i) => forecast.leaves.has(i.id))
    .sort((a, b) => a.order - b.order);

  for (const item of ordered) {
    const lf = forecast.leaves.get(item.id)!;
    const s = dates.get(item.id)!;
    const snap = meta.leafData[item.id];
    const pct = resolveLeafProgress(item, snap);
    const rungs = item.progressMethod === 'milestone' ? item.milestones ?? [] : [];
    const doneIds = new Set(snap?.milestonesDone ?? []);
    const nextRung = rungs.find((r) => !doneIds.has(r.id));

    let next: ForecastLeafView['next'] = null;
    if (pct < 100 && item.progressMethod !== 'qty') {
      next = nextRung
        ? { rungId: nextRung.id, label: nextRung.label, planDate: rungPlanDate(rungs, nextRung.id, s.startDate!, s.finishDate!) }
        : { rungId: null, label: 'Finish', planDate: s.finishDate! };
    }
    const typed =
      item.forecast && item.forecast.week <= week
        ? {
            ...item.forecast,
            label: item.forecast.rungId ? rungs.find((r) => r.id === item.forecast!.rungId)?.label ?? 'Finish' : 'Finish',
          }
        : null;
    const finishWeek = weekOf(lf.finish);
    const planFinishWeek = weekOf(s.finishDate!);
    const over = finishWeek - planFinishWeek;
    const reason: ForecastReason =
      lf.basis === 'done'
        ? { kind: 'done' }
        : lf.basis === 'typed'
          ? { kind: 'typed' }
          : lf.basis === 'measured'
            ? { kind: 'measured' }
            : over > 0 && lf.push > 0 && lf.drivenBy
              ? { kind: 'pushed', by: ref(lf.drivenBy), weeks: over }
              : over > 0
                ? { kind: 'behind', weeks: over }
                : { kind: 'plan' };

    leaves[item.id] = {
      finish: lf.finish,
      finishWeek,
      planStart: s.startDate!,
      planStartWeek: weekOf(s.startDate!),
      planFinish: s.finishDate!,
      planFinishWeek,
      basis: lf.basis,
      source: lf.source,
      reason,
      onPath: onPath.has(item.id),
      next,
      typed,
      waitsFor: (item.waitsFor ?? []).filter((id) => forecast.leaves.has(id)).map(waitRef),
      answered: item.waitsFor !== undefined,
      suggested: (guesses.get(item.id) ?? []).filter((id) => forecast.leaves.has(id)).map(ref),
    };
  }

  // Only what somebody can ANSWER from the panel: a kind to change, a stage
  // ticked too soon, a date to give. "Repeats a ladder its siblings split" and
  // "typed against its own ticks" are still found (lib/forecast-checks.ts) but
  // not listed: neither can be fixed from here until a history-safe
  // restatement exists, and a finding nobody can act on is only noise.
  for (const c of checks) {
    if (c.kind === 'bulk-entry' || !leaves[c.leafId]) continue;
    if (c.kind === 'kind-vs-heading') {
      const currentLabel = kindLabel(c.current);
      say(
        c.leafId,
        currentLabel
          ? `Set as ${currentLabel}, but it sits under ${tidyName(c.heading)}`
          : `No kind of work yet; it sits under ${tidyName(c.heading)}`
      );
    } else if (c.kind === 'ticked-early') {
      const first = ref(c.waiting[0].id);
      say(
        c.leafId,
        `${c.rungLabel} ticked, but ${first.code} ${first.name} is at ${fmt1(c.waiting[0].pct)}%${c.waiting.length > 1 ? ` and ${c.waiting.length - 1} more` : ''}`
      );
    } else if (c.kind === 'needs-date') {
      say(c.leafId, 'Sets the finish, and has no vendor, site or client date yet');
    }
  }

  const weeksWord = (n: number) => `${n} ${n === 1 ? 'week' : 'weeks'}`;
  const slips = slippingOf(db, forecast);
  const slipping = ordered
    .filter((i) => slips[i.id] !== undefined)
    .map((i) => {
      const weeks = slips[i.id];
      const finishWeek = leaves[i.id].finishWeek;
      // The plan week is the forecast less the slip, so the line recomputes.
      return { leaf: ref(i.id), weeks, line: `Plan ends W${finishWeek - weeks} · Forecast W${finishWeek} · ${weeksWord(weeks)} late` };
    })
    .sort((a, b) => b.weeks - a.weeks);

  return {
    week,
    finishWeek: read.finishWeek,
    finishDate: forecast.finish,
    lastWeek: weeks.length ? weeks[weeks.length - 1].week : week,
    path: forecast.chain.map(ref),
    slipping,
    toCheck: ordered.filter((i) => reasons.has(i.id)).map((i) => ({ leaf: ref(i.id), reasons: reasons.get(i.id)! })),
    leaves,
    options: ordered.map((i) => ref(i.id)),
    bulkWeeks: checks.flatMap((c) => (c.kind === 'bulk-entry' ? [c.week] : [])),
  };
}
