/**
 * What the app finds in a project's data by itself, so nobody has to read the
 * data by hand to see it (27 Sep 2026). Every one of these was first found on
 * PHSS Samberah by pulling the deployment apart; this module is that reading,
 * run on every project.
 *
 *   C1 a work kind that disagrees with the WBS heading above it, or is empty
 *   C2 a row carrying a whole ladder its siblings have already split between
 *      them (PO / Fab & RTS / Shipment each holding PO, Fab, RTS and On site)
 *   C3 a typed percent that is not what its own ticked ladder says
 *   C4 progress entered in bulk after weeks of nothing
 *   C5 activities on the path that sets the finish with no outside date
 *   C6 a construction rung ticked before the work its row waits for is done
 *      (28 Sep 2026; widened 2 Oct 2026): the rung each discipline marks as
 *      needing it (lib/disciplines.ts), so a hydrotest filled before its piping
 *      is finished is found as well as material ticked before delivery. One of
 *      the two is wrong, and the forecast cannot tell which
 *
 * Data only. What they say on screen is Plan B's.
 */
import { milestoneProgress, resolveLeafProgress } from './progress';
import { profileRowsOf, rungsNamedBy, stepIdOf, subjectOf, suggestWaitsFor, type Phase } from './forecast-epc';
import { disciplineOf } from './disciplines';
import { BUILT_IN_KINDS } from './work-kind';
import type { LeafForecast } from './forecast';
import type { WbsItem, WeeklyLeafData } from './types';

export type ForecastCheck =
  | { kind: 'kind-vs-heading'; leafId: string; current: string | null; suggested: Phase; heading: string }
  | { kind: 'ladder-repeats'; leafId: string; keep: string[]; siblings: string[] }
  | { kind: 'typed-vs-ladder'; leafId: string; typedPct: number; ladderPct: number }
  | { kind: 'bulk-entry'; week: number; addedPct: number; quietWeeks: number }
  | { kind: 'needs-date'; leafId: string }
  | { kind: 'ticked-early'; leafId: string; rungLabel: string; waiting: { id: string; pct: number }[] };

/** A week this big after this many silent ones reads as catching up, not as work. */
const BULK_POINTS = 5;
const BULK_QUIET_WEEKS = 3;

export function forecastChecks(input: {
  items: WbsItem[];
  leafData: WeeklyLeafData;
  actualByWeek: number[];
  chain: string[];
  leaves: Map<string, LeafForecast>;
}): ForecastCheck[] {
  const { items, leafData, actualByWeek, chain, leaves } = input;
  const out: ForecastCheck[] = [];
  const rows = profileRowsOf(items);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const leafRows = rows.filter((r) => r.isLeaf).sort((a, b) => a.order - b.order);

  // C1
  for (const r of leafRows) {
    if (!r.headingPhase || !r.headingName) continue;
    const current = itemById.get(r.id)?.workKind ?? null;
    if (current !== r.headingPhase) {
      out.push({ kind: 'kind-vs-heading', leafId: r.id, current, suggested: r.headingPhase, heading: r.headingName });
    }
  }

  // C2
  for (const r of leafRows) {
    const item = itemById.get(r.id);
    const kind = BUILT_IN_KINDS.find((k) => k.id === r.phase);
    if (!item || !kind || (item.milestones?.length ?? 0) < 2) continue;
    const stepIds = kind.steps.map((s) => s.id);
    const named = rungsNamedBy(r.name, stepIds);
    if (!named.length) continue;
    const subject = subjectOf(r.name, stepIds);
    const siblings = leafRows.filter(
      (s) =>
        s.id !== r.id &&
        s.parentId === r.parentId &&
        s.phase === r.phase &&
        subjectOf(s.name, stepIds) === subject &&
        rungsNamedBy(s.name, stepIds).length > 0
    );
    const covered = new Set(siblings.flatMap((s) => rungsNamedBy(s.name, stepIds)));
    const carried = (item.milestones ?? []).map((m) => stepIdOf(m.id));
    if (carried.some((id) => !named.includes(id) && covered.has(id))) {
      out.push({ kind: 'ladder-repeats', leafId: r.id, keep: named, siblings: siblings.map((s) => s.id) });
    }
  }

  // C3
  for (const r of leafRows) {
    const item = itemById.get(r.id);
    const snap = leafData[r.id];
    if (!item || !snap || snap.source !== 'manual' || item.progressMethod !== 'milestone') continue;
    if (!item.milestones?.length) continue;
    const ladderPct = milestoneProgress(item.milestones, snap.milestonesDone ?? []);
    if (Math.abs(snap.cumProgressPct - ladderPct) >= 0.5) {
      out.push({ kind: 'typed-vs-ladder', leafId: r.id, typedPct: snap.cumProgressPct, ladderPct });
    }
  }

  // C4
  let quiet = 0;
  for (let i = 0; i < actualByWeek.length; i++) {
    const added = actualByWeek[i] - (i === 0 ? 0 : actualByWeek[i - 1]);
    if (added >= BULK_POINTS && quiet >= BULK_QUIET_WEEKS) {
      out.push({ kind: 'bulk-entry', week: i + 1, addedPct: Math.round(added * 100) / 100, quietWeeks: quiet });
    }
    quiet = Math.abs(added) < 0.005 ? quiet + 1 : 0;
  }

  // C5
  for (const id of chain) {
    if (leaves.get(id)?.basis === 'plan') out.push({ kind: 'needs-date', leafId: id });
  }

  // C6. The links a person confirmed, or EPC order's offer while nobody has
  // answered, so the check works before anyone has linked anything. Any row
  // it waits for counts, not only procurement: a test waits for what it tests.
  const offered = suggestWaitsFor(rows);
  for (const r of leafRows) {
    const item = itemById.get(r.id);
    if (!item || r.phase !== 'construction' || item.progressMethod !== 'milestone') continue;
    const discipline = disciplineOf(item.milestones);
    if (!discipline) continue;
    const guarded = (item.milestones ?? []).find((m) => stepIdOf(m.id) === discipline.needs);
    if (!guarded || !(leafData[r.id]?.milestonesDone ?? []).includes(guarded.id)) continue;
    const preds = item.waitsFor ?? offered.get(r.id) ?? [];
    const waiting = preds
      .flatMap((id) => {
        const p = itemById.get(id);
        return p ? [{ id, pct: resolveLeafProgress(p, leafData[id]) }] : [];
      })
      .filter((p) => p.pct < 100);
    if (waiting.length) out.push({ kind: 'ticked-early', leafId: r.id, rungLabel: guarded.label, waiting });
  }

  return out;
}
