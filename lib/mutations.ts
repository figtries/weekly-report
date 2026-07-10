import { defaultHse, defaultNonEffective, defaultWeather } from './defaults';
import type {
  ChangeLogEntry,
  DailyReport,
  Database,
  HseRow,
  LeafSnapshot,
  ManHourRow,
  NonEffectiveRow,
  WeeklyMeta,
} from './types';

const MAX_LOG = 500;

// Shared by the /api route handlers and the Server Actions so both paths
// apply exactly the same rules.

export function applyCreateDaily(db: Database, date: string): DailyReport {
  if (db.daily.some((d) => d.date === date)) {
    throw new Error(`Daily report for ${date} already exists`);
  }
  const sorted = [...db.daily].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1] as DailyReport | undefined;

  const carryCounters = <T extends { previous: number; today: number }>(rows: T[]): T[] =>
    rows.map((r) => ({ ...r, previous: r.previous + r.today, today: 0 }));

  const manHours: ManHourRow[] = (last?.manHours ?? []).map((r) => ({
    ...r,
    previousHours: r.previousHours + r.todayHours,
    todayHours: 0,
  }));
  const nonEffective: NonEffectiveRow[] = last
    ? carryCounters(last.nonEffective)
    : defaultNonEffective();
  const hseInput: HseRow[] = last ? carryCounters(last.hseInput) : defaultHse();

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

export function applyDeleteDaily(db: Database, date: string): DailyReport {
  const idx = db.daily.findIndex((d) => d.date === date);
  if (idx === -1) throw new Error(`Daily report for ${date} not found`);
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
