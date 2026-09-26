import { getCatalogs, type CatalogKey } from './catalogs';
import { defaultWeather } from './defaults';
import {
  defaultMilestones,
  hasRealQuantity,
  resolveLeafProgress,
  syncLeafSnapshot,
  totalQty,
} from './progress';
import type {
  CatalogEntry,
  ChangeLogEntry,
  DailyReport,
  Database,
  HseRow,
  LeafSnapshot,
  Milestone,
  ManHourRow,
  NonEffectiveRow,
  ProgressMethod,
  WeeklyMeta,
} from './types';

const MAX_LOG = 500;

// Shared by the /api route handlers and the Server Actions so both paths
// apply exactly the same rules.

export function applyCreateDaily(db: Database, date: string): DailyReport {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error(`Invalid date: ${date}`);
  }
  if (db.daily.some((d) => d.date === date)) {
    throw new Error(`Daily report for ${date} already exists`);
  }
  const sorted = [...db.daily].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1] as DailyReport | undefined;

  const carryCounters = <T extends { previous: number; today: number }>(rows: T[]): T[] =>
    rows.map((r) => ({ ...r, previous: r.previous + r.today, today: 0 }));

  const manHours: ManHourRow[] = last
    ? last.manHours.map((r) => ({
        ...r,
        previousHours: r.previousHours + r.todayHours,
        todayHours: 0,
      }))
    : getCatalogs(db).crew.map((c) => ({
        id: c.id,
        company: c.label,
        pobQty: 0,
        previousHours: 0,
        todayHours: 0,
      }));
  // The first report of a project seeds its rows from the project's own
  // catalogs, not from a list compiled into the app — that is what lets a
  // second company use this at all. Later reports carry their predecessor's
  // rows forward instead, so a mid-project catalog edit never rewrites the
  // shape of reports that are already signed.
  const cat = getCatalogs(db);
  const nonEffective: NonEffectiveRow[] = last
    ? carryCounters(last.nonEffective)
    : cat.delayCause.map((c) => ({
        id: c.id,
        cause: c.label,
        previous: 0,
        today: 0,
        remark: '',
      }));
  const hseInput: HseRow[] = last
    ? carryCounters(last.hseInput)
    : cat.hse.map((c) => ({ id: c.id, activity: c.label, previous: 0, today: 0 }));

  const report: DailyReport = {
    date,
    hariKe: last ? (last.hariKe ?? 0) + 1 : 1,
    weather: defaultWeather(),
    manHours,
    nonEffective,
    ptw: [],
    hseInput,
    activitiesToday: '',
    activitiesTomorrow: '',
    planPct: 0,
    actualPct: 0,
    photos: [null, null, null, null, null, null],
  };
  db.daily.push(report);
  return report;
}

export function applyPatchDaily(
  db: Database,
  date: string,
  patch: Partial<Omit<DailyReport, 'date'>>
): DailyReport {
  const report = db.daily.find((d) => d.date === date);
  if (!report) throw new Error(`Daily report for ${date} not found`);
  Object.assign(report, patch);
  return report;
}

// Idempotent: a delete aimed at an already-gone report (e.g. clicked on a
// stale list render) returns null instead of throwing — the desired end
// state is reached either way.
export function applyDeleteDaily(db: Database, date: string): DailyReport | null {
  const idx = db.daily.findIndex((d) => d.date === date);
  if (idx === -1) return null;
  const [removed] = db.daily.splice(idx, 1);
  return removed;
}

export function applyWeekUpdates(
  db: Database,
  week: number,
  updates: Record<string, Partial<LeafSnapshot>>
): WeeklyMeta {
  const meta = db.weeks.find((w) => w.week === week);
  if (!meta) throw new Error(`Week ${week} not found`);
  const wbsById = new Map(db.wbsItems.map((w) => [w.id, w]));
  if (!db.changeLog) db.changeLog = [];
  const at = new Date().toISOString();

  for (const [id, patch] of Object.entries(updates)) {
    const existing = meta.leafData[id] ?? { cumProgressPct: 0, targetWF: 0 };
    const wbs = wbsById.get(id);
    const bobot = wbs?.bobot ?? 0;

    if (patch.cumProgressPct !== undefined && patch.cumProgressPct !== existing.cumProgressPct) {
      db.changeLog.push({
        id: `${at}-${id}-actual`,
        leafId: id,
        week,
        field: 'cumProgressPct',
        oldValue: existing.cumProgressPct,
        newValue: patch.cumProgressPct,
        at,
      } satisfies ChangeLogEntry);
    }
    if (patch.targetWF !== undefined && patch.targetWF !== existing.targetWF) {
      const oldPlanPct = bobot > 0 ? (existing.targetWF / bobot) * 100 : 0;
      const newPlanPct = bobot > 0 ? (patch.targetWF / bobot) * 100 : 0;
      db.changeLog.push({
        id: `${at}-${id}-plan`,
        leafId: id,
        week,
        field: 'planPct',
        oldValue: oldPlanPct,
        newValue: newPlanPct,
        at,
      } satisfies ChangeLogEntry);
    }
    meta.leafData[id] = { ...existing, ...patch };
  }

  if (db.changeLog.length > MAX_LOG) {
    db.changeLog = db.changeLog.slice(-MAX_LOG);
  }
  return meta;
}

export interface FieldProgressUpdate {
  leafId: string;
  qtyDone?: number;
  milestonesDone?: string[];
  /** Free text the person recorded beside the figure, e.g. a vendor's report reference. */
  note?: string;
  /** How the figure was arrived at. 'quote' and 'manual' are both lumpsum and are not the same claim. */
  source?: LeafSnapshot['source'];
}

/**
 * Record what the site actually finished.
 *
 * `cumProgressPct` is written here too, but only ever as the result of
 * `syncLeafSnapshot` — the evidence decides the percentage, never the other way
 * round. That is the entire point of the quantity path, so this function must
 * stay the only way those fields are set.
 */
export function applyFieldProgress(
  db: Database,
  week: number,
  updates: FieldProgressUpdate[]
): void {
  const meta = db.weeks.find((w) => w.week === week);
  if (!meta) throw new Error(`Week ${week} not found`);
  const itemById = new Map(db.wbsItems.map((i) => [i.id, i]));
  const at = new Date().toISOString();
  db.changeLog ??= [];

  for (const u of updates) {
    const item = itemById.get(u.leafId);
    if (!item) continue;
    const prev = meta.leafData[u.leafId] ?? { cumProgressPct: 0, targetWF: 0 };
    const oldPct = resolveLeafProgress(item, prev);

    let next: LeafSnapshot = { ...prev };
    if (u.qtyDone !== undefined) {
      next.qtyDone = Math.max(0, Math.min(totalQty(item), u.qtyDone));
      // Real evidence just arrived through the quantity form, which is never
      // the escape hatch — a stale `manual` tag left over from an earlier
      // override would otherwise freeze this figure forever (see
      // `syncLeafSnapshot`). An explicit `u.source` still wins below.
      if (u.source === undefined && next.source === 'manual') next.source = undefined;
    }
    if (u.milestonesDone !== undefined) {
      const valid = new Set((item.milestones ?? []).map((m) => m.id));
      next.milestonesDone = u.milestonesDone.filter((id) => valid.has(id));
      if (u.source === undefined && next.source === 'manual') next.source = undefined;
    }
    if (u.note !== undefined) next.note = u.note;
    if (u.source !== undefined) next.source = u.source;
    next = syncLeafSnapshot(item, next);
    meta.leafData[u.leafId] = next;

    const newPct = resolveLeafProgress(item, next);
    if (Math.abs(newPct - oldPct) > 1e-9) {
      db.changeLog.push({
        id: `${at}-${u.leafId}-field`,
        leafId: u.leafId,
        week,
        field: 'cumProgressPct',
        oldValue: oldPct,
        newValue: newPct,
        at,
      });
    }
  }
  if (db.changeLog.length > MAX_LOG) db.changeLog = db.changeLog.slice(-MAX_LOG);
}

/**
 * Switch how one item is measured.
 *
 * Changing method deliberately clears the other method's evidence: carrying a
 * stale quantity behind a milestone item is how a number survives that nobody
 * can explain any more.
 */
export function applyProgressMethod(
  db: Database,
  leafId: string,
  method: ProgressMethod,
  opts: { vol?: number | null; satuan?: string | null; milestones?: Milestone[] } = {}
): void {
  const item = db.wbsItems.find((i) => i.id === leafId);
  if (!item) throw new Error('Item not found');

  if (method === 'qty') {
    const vol = opts.vol ?? item.vol;
    const satuan = opts.satuan ?? item.satuan;
    if (!hasRealQuantity({ vol, satuan })) {
      throw new Error(
        'This item has no real quantity yet. Give it a volume and a unit first (e.g. 340 m), not 1 Ls.'
      );
    }
  }

  item.progressMethod = method;
  if (method === 'qty') {
    if (opts.vol !== undefined) item.vol = opts.vol;
    if (opts.satuan !== undefined) item.satuan = opts.satuan;
    item.milestones = undefined;
  } else if (method === 'milestone') {
    item.milestones = opts.milestones?.length ? opts.milestones : defaultMilestones();
  } else {
    item.milestones = undefined;
  }

  // Carry the existing progress ACROSS the change rather than through it.
  //
  // Without this, switching an item to 'qty' recomputes every week from a
  // qtyDone that does not exist yet — which silently rewrites a leaf that sat
  // at 100% for months down to zero and drops the whole project total. Changing
  // how something is measured must never change how much of it is done; the
  // percentage is re-expressed in the new method's own terms instead.
  const total = totalQty(item);
  const ms = item.milestones ?? [];
  for (const wk of db.weeks) {
    const snap = wk.leafData[leafId];
    if (!snap) continue;
    const pct = Math.max(0, Math.min(100, snap.cumProgressPct ?? 0));

    if (method === 'qty') {
      snap.qtyDone = (pct / 100) * total;
      delete snap.milestonesDone;
    } else if (method === 'milestone') {
      // A ladder is climbed in order: award each milestone only while the
      // running total stays at or below what was already reported, and stop
      // at the first one that would exceed it — the closest honest
      // restatement, and never more generous than the number it came from.
      const done: string[] = [];
      let acc = 0;
      const totalW = ms.reduce((a, m) => a + m.weight, 0) || 1;
      for (const m of ms) {
        if (((acc + m.weight) / totalW) * 100 <= pct + 1e-9) {
          acc += m.weight;
          done.push(m.id);
        } else break; // a ladder is climbed in order; a rung missed ends the climb
      }
      snap.milestonesDone = done;
      delete snap.qtyDone;
    } else {
      delete snap.qtyDone;
      delete snap.milestonesDone;
    }
    wk.leafData[leafId] = syncLeafSnapshot(item, snap);
  }
}

/**
 * Replace one catalog list.
 *
 * Renaming a row is intentionally allowed even when history already references
 * the old label: the daily reports keep whatever text they were saved with, so
 * a rename changes what future reports offer without rewriting the past. That
 * asymmetry is deliberate — a signed report must never change after the fact.
 */
export function applyCatalog(db: Database, key: CatalogKey, entries: CatalogEntry[]): void {
  const clean = entries
    .map((e) => ({
      id: e.id.trim() || e.label.trim().toLowerCase().replace(/\s+/g, '-'),
      label: e.label.trim(),
      ...(key === 'delayCause' ? { claimable: !!e.claimable } : {}),
    }))
    .filter((e) => e.label.length > 0);

  if (!clean.length) throw new Error('The list cannot be empty');
  // Weather slots are named fields on WeatherInfo, so the list can be reworded
  // but never resized — dropping one would remove a checkbox from every future
  // daily report and orphan the field it wrote to.
  if (key === 'weather' && clean.length !== 4) {
    throw new Error('Weather terms must be exactly four rows');
  }
  const ids = new Set(clean.map((e) => e.id));
  if (ids.size !== clean.length) throw new Error('Duplicate id');

  db.catalogs = { ...getCatalogs(db), [key]: clean };
}

