import type {
  BoqLine,
  DistributionPattern,
  ScheduleItem,
  WbsItem,
} from './types';

/**
 * Building a project's baseline — the part of project control that actually
 * needs experience, and the reason a new hire can't do the job from a blank
 * screen.
 *
 * Two rules drive everything here:
 *
 *   1. Weight is DERIVED, never judged. `bobot = line value / contract value`.
 *      A BOQ exists on every EPC contract (it's what the bid was priced from),
 *      so asking for prices asks for a document people already have — and the
 *      weights then sum to exactly 100 by construction instead of by luck.
 *
 *   2. The plan curve is GENERATED, never imported. Given start, finish and a
 *      spread, each leaf's weekly target computes itself, which means a
 *      schedule revision regenerates the curve instead of sending someone back
 *      to Excel.
 */

// ---------------------------------------------------------------------------
// Weights from the BOQ
// ---------------------------------------------------------------------------

export interface WeightResult {
  /** leafId -> bobot in percent. Sums to 100 (within float tolerance). */
  weights: Record<string, number>;
  /** leafId -> line value in Rupiah. */
  values: Record<string, number>;
  contractValue: number;
  /** True when every priced line resolved; false means some leaves had no line. */
  complete: boolean;
  unpricedLeafIds: string[];
}

export function lineValue(line: BoqLine): number {
  return line.unitPrice * line.qty;
}

/**
 * Turn priced BOQ lines into weights.
 *
 * The contract value is the sum of the lines rather than a separately typed
 * number: two sources for the same figure is how a report ends up disagreeing
 * with itself.
 */
export function weightsFromBoq(leafIds: string[], boq: BoqLine[]): WeightResult {
  const byLeaf = new Map(boq.map((l) => [l.leafId, l]));
  const values: Record<string, number> = {};
  let contractValue = 0;

  for (const id of leafIds) {
    const line = byLeaf.get(id);
    const v = line ? lineValue(line) : 0;
    values[id] = v;
    contractValue += v;
  }

  const weights: Record<string, number> = {};
  const unpricedLeafIds: string[] = [];
  for (const id of leafIds) {
    weights[id] = contractValue > 0 ? (values[id] / contractValue) * 100 : 0;
    if (!values[id]) unpricedLeafIds.push(id);
  }

  return {
    weights,
    values,
    contractValue,
    complete: unpricedLeafIds.length === 0,
    unpricedLeafIds,
  };
}

/**
 * The escape hatch. A project without a priced BOQ still has to be able to
 * start — better a rough number that is labelled rough than a project that
 * never gets set up. Callers must surface that these weights are not
 * value-based.
 */
export function evenWeights(leafIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!leafIds.length) return out;
  const each = 100 / leafIds.length;
  leafIds.forEach((id) => (out[id] = each));
  return out;
}

// ---------------------------------------------------------------------------
// Plan curve from the schedule
// ---------------------------------------------------------------------------

export const PATTERN_LABELS: Record<DistributionPattern, string> = {
  linear: 'Even',
  scurve: 'S-curve',
  front: 'Front-loaded',
  back: 'Back-loaded',
};

export const PATTERN_HINTS: Record<DistributionPattern, string> = {
  linear: 'The same progress every week. Suits repetitive installation.',
  scurve: 'Slow to start, fast in the middle, easing off at the end. The commonest shape.',
  front: 'Most of it finishes early. Suits mobilisation and procurement.',
  back: 'Piles up at the end. Suits commissioning and close-out.',
};

/**
 * Fraction of an item complete at `t` (0..1 of its own duration).
 *
 * `scurve` is a smoothstep rather than a logistic: it starts and ends exactly
 * at 0 and 1, so an item is never left at 99.7% when its finish week arrives —
 * which would leak a permanent phantom deviation into the project total.
 */
export function progressAt(t: number, pattern: DistributionPattern): number {
  const x = Math.min(1, Math.max(0, t));
  switch (pattern) {
    case 'linear':
      return x;
    case 'scurve':
      return x * x * (3 - 2 * x);
    case 'front':
      return 1 - (1 - x) * (1 - x);
    case 'back':
      return x * x;
  }
}

export interface PlanCurveResult {
  /** leafId -> week -> targetWF (weight-factor, i.e. already × bobot). */
  points: Record<string, Record<number, number>>;
  /** Project cumulative plan percent per week, 1..totalWeeks. */
  projectPlan: { week: number; planPct: number }[];
}

/**
 * Build every leaf's weekly target, then the project curve as their sum.
 *
 * Targets are cumulative and carry forward past `finishWeek`, so a completed
 * item keeps contributing its full weight instead of dropping out of the total.
 */
export function generatePlanCurve(
  leaves: { id: string; bobot: number }[],
  schedule: ScheduleItem[],
  totalWeeks: number
): PlanCurveResult {
  const byLeaf = new Map(schedule.map((s) => [s.leafId, s]));
  const points: Record<string, Record<number, number>> = {};
  const weekTotals = new Array<number>(totalWeeks + 1).fill(0);

  for (const leaf of leaves) {
    const s = byLeaf.get(leaf.id);
    const row: Record<number, number> = {};
    if (!s) {
      // Unscheduled item: no plan, but still occupy a row so callers can tell
      // "planned zero" from "not in the schedule at all".
      for (let w = 1; w <= totalWeeks; w++) row[w] = 0;
      points[leaf.id] = row;
      continue;
    }

    const start = Math.max(1, Math.min(s.startWeek, totalWeeks));
    const finish = Math.max(start, Math.min(s.finishWeek, totalWeeks));
    const span = finish - start + 1;

    for (let w = 1; w <= totalWeeks; w++) {
      let frac: number;
      if (w < start) frac = 0;
      else if (w >= finish) frac = 1;
      else frac = progressAt((w - start + 1) / span, s.pattern);
      const wf = leaf.bobot * frac;
      row[w] = wf;
      weekTotals[w] += wf;
    }
    points[leaf.id] = row;
  }

  const projectPlan = [];
  for (let w = 1; w <= totalWeeks; w++) {
    projectPlan.push({ week: w, planPct: weekTotals[w] });
  }
  return { points, projectPlan };
}

/** A schedule that spans the whole project — the starting point before editing. */
export function defaultSchedule(
  leafIds: string[],
  totalWeeks: number,
  pattern: DistributionPattern = 'scurve'
): ScheduleItem[] {
  return leafIds.map((leafId) => ({
    leafId,
    startWeek: 1,
    finishWeek: totalWeeks,
    pattern,
  }));
}

// ---------------------------------------------------------------------------
// WBS import
// ---------------------------------------------------------------------------

export interface ParsedWbsRow {
  wbsCode: string;
  deskripsi: string;
  level: number;
  vol: number | null;
  satuan: string | null;
}

/**
 * Read a pasted WBS table.
 *
 * Real WBS exports carry their hierarchy in one of three ways and a project
 * manager should not have to know which one they have:
 *
 *   - a dotted code in one column     "1.2.3  Detail Engineering"
 *   - leading indentation             "      Detail Engineering"
 *   - an explicit level column        "3 | Detail Engineering"
 *
 * Dotted codes win when present because they are unambiguous; indentation is
 * the fallback. Rows that are blank or carry no description are dropped rather
 * than imported as empty nodes.
 */
export function parseWbsText(text: string): ParsedWbsRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ParsedWbsRow[] = [];

  for (const raw of lines) {
    const indent = raw.length - raw.trimStart().length;
    const cells = raw.trim().split(/\t|\s{2,}|\s*\|\s*/).filter((c) => c.length);
    if (!cells.length) continue;

    const first = cells[0];
    const dotted = /^\d+(\.\d+)*$/.test(first);
    const numericLevel = /^\d{1,2}$/.test(first) && cells.length > 1 && !dotted;

    let wbsCode = '';
    let level: number;
    let rest: string[];

    if (dotted) {
      wbsCode = first;
      level = first.split('.').length;
      rest = cells.slice(1);
    } else if (numericLevel) {
      level = Number(first);
      rest = cells.slice(1);
    } else {
      level = Math.floor(indent / 2) + 1;
      rest = cells;
    }

    const deskripsi = (rest[0] ?? '').trim();
    if (!deskripsi) continue;

    const volRaw = rest[1] ? Number(String(rest[1]).replace(/[.\s]/g, '').replace(',', '.')) : NaN;
    rows.push({
      wbsCode,
      deskripsi,
      level: Math.max(1, level),
      vol: Number.isFinite(volRaw) ? volRaw : null,
      satuan: rest[2]?.trim() || null,
    });
  }

  return renumber(rows);
}

/** Fill in dotted codes for rows that arrived without one, from their level. */
function renumber(rows: ParsedWbsRow[]): ParsedWbsRow[] {
  const counters: number[] = [];
  return rows.map((r) => {
    if (r.wbsCode) {
      const parts = r.wbsCode.split('.').map(Number);
      counters.length = parts.length;
      parts.forEach((p, i) => (counters[i] = p));
      return r;
    }
    const depth = r.level;
    counters.length = depth;
    counters[depth - 1] = (counters[depth - 1] ?? 0) + 1;
    for (let i = 0; i < depth; i++) if (!counters[i]) counters[i] = 1;
    return { ...r, wbsCode: counters.slice(0, depth).join('.') };
  });
}

/** Turn parsed rows into the app's WBS shape, linking parents by level. */
export function rowsToWbsItems(rows: ParsedWbsRow[]): WbsItem[] {
  const items: WbsItem[] = [];
  const lastAtLevel: Record<number, string> = {};

  rows.forEach((r, i) => {
    const id = `w${i + 1}`;
    const parentId = r.level > 1 ? lastAtLevel[r.level - 1] ?? null : null;
    lastAtLevel[r.level] = id;
    // A deeper level can never inherit a stale parent from a previous branch.
    Object.keys(lastAtLevel)
      .map(Number)
      .filter((l) => l > r.level)
      .forEach((l) => delete lastAtLevel[l]);

    items.push({
      id,
      parentId,
      wbsCode: r.wbsCode,
      deskripsi: r.deskripsi,
      bobot: 0,
      vol: r.vol,
      satuan: r.satuan,
      order: i + 1,
    });
  });

  return items;
}
