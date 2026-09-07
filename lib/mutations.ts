import { getCatalogs, type CatalogKey } from './catalogs';
import { defaultWeather } from './defaults';
import { evenWeights, generatePlanCurve, rowsToWbsItems, weightsFromBoq } from './setup';
import {
  defaultMilestones,
  hasRealQuantity,
  resolveLeafProgress,
  syncLeafSnapshot,
  totalQty,
} from './progress';
import type { SetupDraft } from './setup-draft';
import type {
  Approval,
  BoqLine,
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
  ScheduleItem,
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

/**
 * Turn a wizard draft into a live project.
 *
 * This is the one place weights and plan curves are allowed to enter the
 * database, and both are computed here rather than accepted from the client —
 * so `bobot` can only ever be `line value / contract value`, and every
 * `targetWF` can only ever have come from the schedule. That invariant is what
 * lets the rest of the app trust its own numbers.
 */
export function applySetup(db: Database, draft: SetupDraft): void {
  if (!draft.rows.length) throw new Error('The WBS is still empty');
  if (draft.totalWeeks < 1) throw new Error('A project must run for at least 1 week');

  const items = rowsToWbsItems(
    draft.rows.map((r) => ({
      wbsCode: r.wbsCode,
      deskripsi: r.deskripsi,
      level: r.level,
      vol: r.vol,
      satuan: r.satuan,
    }))
  );

  // Only leaves carry weight; parents are sums (see lib/rollup.ts).
  const parentIds = new Set(items.filter((i) => i.parentId).map((i) => i.parentId!));
  const leaves = items.filter((i) => !parentIds.has(i.id));
  const leafIds = leaves.map((l) => l.id);
  const rowByItemId = new Map(items.map((it, i) => [it.id, draft.rows[i]]));

  const boq: BoqLine[] = leaves.map((l) => {
    const row = rowByItemId.get(l.id)!;
    return { leafId: l.id, unitPrice: row.unitPrice, qty: row.vol ?? 1 };
  });

  const priced = weightsFromBoq(leafIds, boq);
  const useEven = draft.evenWeights || priced.contractValue <= 0;
  const weights = useEven ? evenWeights(leafIds) : priced.weights;

  items.forEach((it) => {
    it.bobot = weights[it.id] ?? 0;
  });

  const schedule: ScheduleItem[] = leaves.map((l) => {
    const row = rowByItemId.get(l.id)!;
    return {
      leafId: l.id,
      startWeek: row.startWeek,
      finishWeek: Math.max(row.startWeek, row.finishWeek),
      pattern: row.pattern,
    };
  });

  const curve = generatePlanCurve(
    leaves.map((l) => ({ id: l.id, bobot: weights[l.id] ?? 0 })),
    schedule,
    draft.totalWeeks
  );

  // Every week is materialised so the S-Curve and rollup read the plan the
  // same way they read a seeded project — no second code path for "new"
  // projects. Actuals start at zero; week 1 is the current week.
  const weeks: WeeklyMeta[] = [];
  for (let w = 1; w <= draft.totalWeeks; w++) {
    const leafData: Record<string, { cumProgressPct: number; targetWF: number }> = {};
    for (const id of leafIds) {
      leafData[id] = { cumProgressPct: 0, targetWF: curve.points[id]?.[w] ?? 0 };
    }
    weeks.push({
      week: w,
      periodStart: '',
      periodEnd: '',
      documentation: [],
      leafData,
    });
  }

  db.project = {
    ...db.project,
    ...draft.project,
    contractValue: useEven ? undefined : priced.contractValue,
    currentWeek: 1,
  };
  db.wbsItems = items;
  db.weeks = weeks;
  db.scurvePlan = curve.projectPlan.map((p) => ({ week: p.week, valuePct: p.planPct }));
  db.scurveActual = [];
  db.daily = [];
  db.changeLog = [];
  db.boq = useEven ? [] : boq;
  db.schedule = schedule;
  db.baselines = [
    {
      version: 1,
      lockedAt: new Date().toISOString(),
      reason: 'Initial baseline from the setup wizard',
      points: curve.points,
    },
  ];
}

export interface FieldProgressUpdate {
  leafId: string;
  qtyDone?: number;
  milestonesDone?: string[];
}

/**
 * Record what the site actually finished.
 *
 * `cumProgressPct` is written here too, but only ever as the result of
 * `syncLeafSnapshot` — the evidence decides the percentage, never the other way
 * round. That is the entire point of the quantity path, so this function must
 * stay the only way those fields are set.
 */
/**
 * Record that a leaf was checked this week and had nothing to report.
 *
 * The weekly queue counts an item as dealt with when the change log has an
 * entry for it that week, and the log only gets one when a figure moves. An
 * item that was looked at and genuinely had not moved would therefore sit in
 * the queue for the rest of the project, and the "N left" counter would never
 * reach zero — so "nothing happened" has to be sayable.
 *
 * It writes no progress, only the fact of the check: `oldValue === newValue`
 * is what tells every reader this entry moved nothing.
 */
export function markNoProgress(db: Database, week: number, leafIds: string[]): void {
  const meta = db.weeks.find((w) => w.week === week);
  if (!meta) throw new Error(`Week ${week} not found`);
  const itemById = new Map(db.wbsItems.map((i) => [i.id, i]));
  const at = new Date().toISOString();
  db.changeLog ??= [];

  for (const leafId of leafIds) {
    const item = itemById.get(leafId);
    if (!item) continue;
    // Already recorded this week — checking twice is not two events.
    if (db.changeLog.some((c) => c.leafId === leafId && c.week === week && c.field === 'noProgress')) {
      continue;
    }
    const pct = resolveLeafProgress(item, meta.leafData[leafId] ?? { cumProgressPct: 0, targetWF: 0 });
    db.changeLog.push({
      id: `${at}-${leafId}-none`,
      leafId,
      week,
      field: 'noProgress',
      oldValue: pct,
      newValue: pct,
      at,
    });
  }
  if (db.changeLog.length > MAX_LOG) db.changeLog = db.changeLog.slice(-MAX_LOG);
}

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
    }
    if (u.milestonesDone !== undefined) {
      const valid = new Set((item.milestones ?? []).map((m) => m.id));
      next.milestonesDone = u.milestonesDone.filter((id) => valid.has(id));
    }
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
      // Award milestones in order until their cumulative weight would exceed
      // what was already reported — the closest honest restatement, and never
      // more generous than the number it came from.
      const done: string[] = [];
      let acc = 0;
      const totalW = ms.reduce((a, m) => a + m.weight, 0) || 1;
      for (const m of ms) {
        if (((acc + m.weight) / totalW) * 100 <= pct + 1e-9) {
          acc += m.weight;
          done.push(m.id);
        }
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

/**
 * Sign off a week.
 *
 * Re-approving replaces the previous record rather than appending: what matters
 * downstream is who currently stands behind the week, and a stack of
 * supersedeed approvals reads like disagreement where there is none. The
 * approved percentage is snapshotted so a later edit shows up as drift instead
 * of quietly inheriting the signature.
 */
export function applyApproval(
  db: Database,
  week: number,
  by: string,
  role: string,
  approvedPct: number,
  note?: string
): void {
  const name = by.trim();
  if (!name) throw new Error('An approver name is required');
  if (!db.weeks.some((w) => w.week === week)) throw new Error(`Week ${week} not found`);
  db.approvals = [
    ...(db.approvals ?? []).filter((a) => a.week !== week),
    { week, by: name, role: role.trim() || 'Project Manager', at: new Date().toISOString(), approvedPct, note: note?.trim() || undefined },
  ].sort((a, b) => a.week - b.week);
}

export function applyRevokeApproval(db: Database, week: number): void {
  db.approvals = (db.approvals ?? []).filter((a) => a.week !== week);
}
