/**
 * Everything Data Overall shows about the forecast, worked out on the server
 * and handed to the client as plain data: the finish and the path that sets
 * it, what the app found in the data (lib/forecast-checks.ts), and per
 * activity the one date question it deserves and what it waits for.
 *
 * It decides nothing of its own. The finish is lib/forecast.ts's, the links it
 * offers are lib/forecast-epc.ts's, the percentages lib/progress.ts's, and the
 * figure a kind change would leave is `changeFor`'s, the same function the
 * panel's own kind picker previews with.
 */
import { dayOf, isoOf, weekContaining, type ForecastSource, type StepBasis } from './forecast';
import { forecastChecks } from './forecast-checks';
import { profileRowsOf, suggestWaitsFor, unansweredLinks } from './forecast-epc';
import { forecastFromDb } from './forecast-read';
import { r2 } from './figures';
import { resolveLeafProgress } from './progress';
import { computeGrandTotal, computeRollup, promoteNestedSpkContracts } from './rollup';
import { BUILT_IN_KINDS, shapeOf, type Shape } from './work-kind';
import { changeFor, ladderFor } from './work-kind-apply';
import type { Database, Milestone, WbsItem } from './types';

export interface LinkRef {
  id: string;
  code: string;
  name: string;
}

/** A link, with how far that activity's own forecast runs past its plan. */
export interface WaitRef extends LinkRef {
  /** Whole weeks late; 0 when it is done, on plan or early. */
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

export type ForecastIssue =
  | {
      kind: 'kind-vs-heading';
      currentLabel: string | null;
      suggested: string;
      suggestedLabel: string;
      heading: string;
      shape: Shape;
      ladder: Milestone[];
      /** The figure this row would stand at after the change, from `changeFor`. */
      afterPct: number;
    }
  | { kind: 'ladder-repeats'; kindLabel: string; keepLabels: string[]; siblings: LinkRef[] }
  | { kind: 'typed-vs-ladder'; typedPct: number; ladderPct: number };

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
  waitsFor: WaitRef[];
  /** EPC order's offer, for a row nobody has answered. Empty once it has been. */
  suggested: LinkRef[];
  issues: ForecastIssue[];
}

export interface ForecastView {
  week: number;
  finishWeek: number;
  finishDate: string;
  lastWeek: number;
  path: LinkRef[];
  /** Activities the app found something about, in plan order, with why. */
  toCheck: { leaf: LinkRef; reasons: string[] }[];
  leaves: Record<string, ForecastLeafView>;
  /** Every scheduled activity, in plan order, for "waits for". */
  options: LinkRef[];
  /** Weeks where progress arrived in bulk after weeks of nothing. */
  bulkWeeks: number[];
  /** Activities EPC order has links for that nobody has answered: what "Link" fills. */
  unlinked: number;
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
    return { id, code: i?.wbsCode ?? '', name: i?.deskripsi ?? '' };
  };
  const dates = new Map((db.schedule ?? []).map((s) => [s.leafId, s]));
  const { forecast } = read;
  const onPath = new Set(forecast.chain);
  const weekOf = (iso: string) => weekContaining(iso, weekEnds);
  /** Whole weeks an activity's own forecast runs past its plan; 0 when done. */
  const lateWeeks = (id: string) => {
    const lf = forecast.leaves.get(id);
    const s = dates.get(id);
    if (!lf || !s?.finishDate || lf.basis === 'done') return 0;
    return Math.max(0, weekOf(lf.finish) - weekOf(s.finishDate));
  };

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
  const suggestions = suggestWaitsFor(profileRowsOf(db.wbsItems));

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
    const confirmed = (item.waitsFor ?? []).filter((id) => forecast.leaves.has(id));
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
      waitsFor: confirmed.map((id) => ({ ...ref(id), lateWeeks: lateWeeks(id) })),
      suggested: item.waitsFor === undefined ? (suggestions.get(item.id) ?? []).map(ref) : [],
      issues: [],
    };
  }

  for (const c of checks) {
    if (c.kind === 'bulk-entry') continue;
    const leaf = leaves[c.leafId];
    if (!leaf) continue;
    const item = byId.get(c.leafId) as WbsItem;
    if (c.kind === 'kind-vs-heading') {
      const kind = BUILT_IN_KINDS.find((k) => k.id === c.suggested);
      if (!kind) continue;
      const shape = shapeOf(item.deskripsi, kind);
      const ladder = ladderFor(kind.id, shape, item.deskripsi, BUILT_IN_KINDS);
      const pct = resolveLeafProgress(item, meta.leafData[item.id]);
      const after = changeFor({ id: item.id, name: item.deskripsi, bobot: item.bobot, pct }, ladder).toPct;
      const currentLabel = kindLabel(c.current);
      leaf.issues.push({
        kind: 'kind-vs-heading',
        currentLabel,
        suggested: kind.id,
        suggestedLabel: kind.label,
        heading: c.heading,
        shape,
        ladder,
        afterPct: after,
      });
      say(
        c.leafId,
        currentLabel
          ? `Set as ${currentLabel}, but it sits under ${c.heading}`
          : `No kind of work yet; it sits under ${c.heading}`
      );
    } else if (c.kind === 'ladder-repeats') {
      const kind = BUILT_IN_KINDS.find((k) => k.steps.some((s) => c.keep.includes(s.id)));
      const keepLabels = (kind?.steps ?? []).filter((s) => c.keep.includes(s.id)).map((s) => s.label);
      leaf.issues.push({
        kind: 'ladder-repeats',
        kindLabel: kind?.label ?? 'stage',
        keepLabels,
        siblings: c.siblings.map(ref),
      });
      say(c.leafId, `Carries every ${(kind?.label ?? 'stage').toLowerCase()} stage, which the rows beside it already split`);
    } else if (c.kind === 'typed-vs-ladder') {
      leaf.issues.push({ kind: 'typed-vs-ladder', typedPct: c.typedPct, ladderPct: c.ladderPct });
      say(c.leafId, `Typed ${fmt1(c.typedPct)}% while its ticked stages say ${fmt1(c.ladderPct)}%`);
    } else if (c.kind === 'needs-date') {
      say(c.leafId, 'Sets the finish on plan dates alone: no vendor, site or client date yet');
    }
  }

  return {
    week,
    finishWeek: read.finishWeek,
    finishDate: forecast.finish,
    lastWeek: weeks.length ? weeks[weeks.length - 1].week : week,
    path: forecast.chain.map(ref),
    toCheck: ordered.filter((i) => reasons.has(i.id)).map((i) => ({ leaf: ref(i.id), reasons: reasons.get(i.id)! })),
    leaves,
    options: ordered.map((i) => ref(i.id)),
    bulkWeeks: checks.flatMap((c) => (c.kind === 'bulk-entry' ? [c.week] : [])),
    unlinked: unansweredLinks(db.wbsItems).size,
  };
}
