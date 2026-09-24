/**
 * The dashboard's data, built from SQLite for whichever project is open.
 *
 * WHY THIS EXISTS. Dashboard, Weekly, Daily, Reports and Klaim all read
 * `readDb()` — the single project inside `db.json` — while projects are chosen
 * in SQLite. `lib/legacy-bridge.ts` stopped that from lying by refusing to draw
 * anything for a project db.json has never heard of, but "we cannot show you
 * this" is not the same as showing it. The dashboard is the app's front page
 * and it has to answer for EVERY project, and for any week of it.
 *
 * WHY AN ADAPTER RATHER THAN A REWRITE. `lib/rollup.ts` and `lib/analysis.ts`
 * are 1,300 lines of arithmetic the client has already checked: rollup, grand
 * total, SPI, laggards, velocity, forecast, look-ahead, week validation. None
 * of it cares where the rows came from — it takes a `Database`. So this file
 * builds one, per project and read-only, and the whole dashboard works
 * unchanged. Reading the same project two different ways is exactly how two
 * numbers drift apart, and this is what stops there being a second way.
 *
 * WHY THAT IS SAFE HERE AND NOWHERE ELSE. `legacy-bridge.ts` warns that reads
 * and writes must stay on the same store: serving a page SQLite while its form
 * still writes JSON loses people's edits. **The dashboard never writes.** It has
 * no form, no action, no mutation — every route off it goes somewhere that owns
 * its own store. Do not reach for this from a page that saves anything until
 * board items 08–14 move the write path too.
 *
 * WHAT IS DERIVED HERE. The plan. `node_schedules` holds three numbers per leaf
 * and the weekly curve is computed from them (`lib/plan-curve.ts`), which is why
 * `targetWF` below is a multiplication and not a column. Actuals are carried
 * forward: a leaf with no row this week stands where it last stood, which is
 * what a cumulative percentage means and what keeps a week with nothing
 * reported from reading as a collapse to zero.
 */
import { asc, eq, inArray } from 'drizzle-orm';

import { leafPlanFraction } from './plan-curve';
import { getActiveBaselineId } from './sheet';
import { db as sqlite, schema } from './sqlite';
import { parseSignature } from './signature';
import type {
  ChangeLogEntry,
  Database,
  LeafSnapshot,
  ProgressMethod,
  ProjectInfo,
  ScheduleItem,
  WbsItem,
  WeeklyLeafData,
  WeeklyMeta,
} from './types';

export interface ProjectDashboardData {
  /** Legacy-shaped and read-only. Feed it to rollup/analysis exactly as before. */
  db: Database;
  /** Every reporting week the project has, in order — the week picker's list. */
  weeks: number[];
  /** The last week anything was actually reported. 0 when nothing has been. */
  currentWeek: number;
  /** True once the project has a WBS with weight and a calendar to spread it over. */
  hasPlan: boolean;
  /**
   * A WBS and a calendar, weighed or not. Since 24 Sep 2026 a row weighs 0
   * until somebody budgets it, so a project can have its whole schedule and
   * no weight at all, and the Weights screen is where it gets one. Gating that
   * screen on `hasPlan` locked it the moment the last budget was cleared.
   */
  hasSchedule: boolean;
  /**
   * The project's own currency. `ProjectInfo` has never carried one — the whole
   * app was one Rupiah project — so it rides alongside rather than inside, and
   * the dashboard formats money with it instead of stamping "Rp" on a contract
   * priced in dollars.
   */
  currency: string;
}

/** 'linked' is a v2 method whose percentage is already resolved into the row. */
function legacyMethod(m: string | null): ProgressMethod {
  return m === 'qty' || m === 'milestone' ? m : 'lumpsum';
}

export function buildProjectDashboardData(projectId: string): ProjectDashboardData | null {
  const project = sqlite
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project) return null;

  const nodes = sqlite
    .select()
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(asc(schema.wbsNodes.order))
    .all();

  const weekRows = sqlite
    .select()
    .from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId))
    .orderBy(asc(schema.weeks.weekNo))
    .all();

  // Milestones ride along, because a milestone item's percentage IS its
  // milestones — `resolveLeafProgress` reads them off the item, and without
  // them every milestone leaf resolves to zero no matter what was recorded.
  const msRows = sqlite
    .select({
      id: schema.milestones.id,
      nodeId: schema.milestones.nodeId,
      label: schema.milestones.label,
      weight: schema.milestones.weight,
      order: schema.milestones.order,
    })
    .from(schema.milestones)
    .innerJoin(schema.wbsNodes, eq(schema.wbsNodes.id, schema.milestones.nodeId))
    .where(eq(schema.wbsNodes.projectId, projectId))
    .orderBy(asc(schema.milestones.order))
    .all();
  const msByNode = new Map<string, { id: string; label: string; weight: number }[]>();
  for (const m of msRows) {
    const list = msByNode.get(m.nodeId);
    const entry = { id: m.id, label: m.label, weight: m.weight };
    if (list) list.push(entry);
    else msByNode.set(m.nodeId, [entry]);
  }

  const wbsItems: WbsItem[] = nodes.map((n) => ({
    id: n.id,
    parentId: n.parentId,
    wbsCode: n.wbsCode,
    deskripsi: n.deskripsi,
    bobot: n.bobot ?? 0,
    vol: n.vol,
    satuan: n.satuan,
    order: n.order,
    progressMethod: legacyMethod(n.progressMethod),
    milestones: msByNode.get(n.id),
    // The answer to "what kind of work is this?". Written by
    // `setWorkKindSqlite` since the question existed and never read back here,
    // so every SQLite row came to the panel unanswered and it asked again on
    // every open (PHSS Samberah, 23 Sep 2026).
    workKind: n.workKind,
    // The flag the planner's row menu writes. Dropping it here is what made
    // "Make it a reporting unit" change nothing on the dashboard or on the
    // Overall Summary sheet for every project made inside the app.
    isReportingUnit: n.isReportingUnit,
    unitLabel: n.unitLabel,
  }));

  // Dates come from the ACTIVE baseline, like every other reader: the
  // contractual one is claim material, this is how the work is being managed.
  const baselineId = getActiveBaselineId(projectId);
  const schedules = baselineId
    ? sqlite
        .select()
        .from(schema.nodeSchedules)
        .where(eq(schema.nodeSchedules.baselineId, baselineId))
        .all()
    : [];
  const dates = new Map(schedules.map((s) => [s.nodeId, s]));

  const leafIds = new Set(nodes.filter((n) => n.isLeaf).map((n) => n.id));
  const weekIds = weekRows.map((w) => w.id);
  const progress = weekIds.length
    ? sqlite
        .select()
        .from(schema.leafProgress)
        .where(inArray(schema.leafProgress.weekId, weekIds))
        .all()
    : [];

  // The EVIDENCE, not just the percentage. `lib/progress.ts` is the single
  // origin of a leaf's figure and it reads `qtyDone`/`milestonesDone` off the
  // snapshot; dropping them here meant the Fill in screen showed an empty
  // quantity box over a leaf that had one recorded, and re-saving it would
  // have written that emptiness back.
  const msDone = weekIds.length
    ? sqlite
        .select({
          weekId: schema.milestoneProgress.weekId,
          milestoneId: schema.milestoneProgress.milestoneId,
          achieved: schema.milestoneProgress.achieved,
          nodeId: schema.milestones.nodeId,
        })
        .from(schema.milestoneProgress)
        .innerJoin(schema.milestones, eq(schema.milestones.id, schema.milestoneProgress.milestoneId))
        .where(inArray(schema.milestoneProgress.weekId, weekIds))
        .all()
    : [];

  const byWeek = new Map<
    string,
    Map<string, { pct: number; qtyDone: number | null; source: LeafSnapshot['source'] }>
  >();
  for (const row of progress) {
    let m = byWeek.get(row.weekId);
    if (!m) byWeek.set(row.weekId, (m = new Map()));
    m.set(row.nodeId, {
      pct: row.cumProgressPct ?? 0,
      qtyDone: row.qtyDone ?? null,
      // Dropped here originally: this map only kept {pct, qtyDone}, so every
      // SQLite leaf's snapshot carried `source: undefined` regardless of how
      // the figure was actually recorded — a report claiming nothing was
      // typed by hand even when it was. `leaf_progress.source` is selected by
      // the `.select()` above like every other column; it just was not read.
      source: (row.source ?? undefined) as LeafSnapshot['source'],
    });
  }
  const msByWeekNode = new Map<string, Map<string, string[]>>();
  for (const row of msDone) {
    if (!row.achieved) continue;
    let m = msByWeekNode.get(row.weekId);
    if (!m) msByWeekNode.set(row.weekId, (m = new Map()));
    m.set(row.nodeId, [...(m.get(row.nodeId) ?? []), row.milestoneId]);
  }

  // THE RECORD THAT SOMEBODY ANSWERED. `buildWorklist` decides an item was
  // dealt with from the change log, and this adapter used to hand over none at
  // all — so on a SQLite project every leaf the schedule touched stayed
  // "due and unanswered" forever, `done` was permanently empty, and the Check
  // page's blocking finding could not be cleared by any button in the app.
  // Pressing "no progress" wrote its row and changed nothing on screen
  // (14 Sep 2026, week 37 of the Samberah project: an item at 100% still held
  // the week back).
  //
  // A `leaf_progress` row IS that record: `writeSnapshot` is the only thing
  // that creates one, both the Fill in screen and "no progress" go through it,
  // and it is keyed per week. So the log is read back off the rows already
  // loaded above rather than from a table of its own. It carries no before/
  // after — SQLite keeps the standing figure, not the edit — and nothing reads
  // one: `field` exists for db.json's own dedupe, and `at` for "last touched".
  const weekNoById = new Map(weekRows.map((w) => [w.id, w.weekNo]));
  const changeLog: ChangeLogEntry[] = progress.map((row) => {
    const pct = row.cumProgressPct ?? 0;
    return {
      id: row.id,
      leafId: row.nodeId,
      week: weekNoById.get(row.weekId) ?? 0,
      field: 'cumProgressPct',
      oldValue: pct,
      newValue: pct,
      at: row.recordedAt ?? '',
    };
  });

  // The last week anybody recorded anything. The S-curve draws its actual line
  // up to here and stops — a flat line running to week 60 would claim the
  // project stalled, when in truth nobody has filed those weeks yet.
  let currentWeek = 0;
  for (const w of weekRows) if (byWeek.has(w.id)) currentWeek = Math.max(currentWeek, w.weekNo);

  // Carried forward across the whole run, so a leaf with no row this week holds
  // the figure it last had rather than falling back to zero. The EVIDENCE is
  // carried with it: a quantity that stopped being reported has not stopped
  // being done.
  const carried = new Map<
    string,
    { pct: number; qtyDone: number | null; source: LeafSnapshot['source'] }
  >();
  const carriedMs = new Map<string, string[]>();
  const weeks: WeeklyMeta[] = weekRows.map((w) => {
    const recorded = byWeek.get(w.id);
    const recordedMs = msByWeekNode.get(w.id);
    const leafData: WeeklyLeafData = {};
    for (const node of nodes) {
      if (!leafIds.has(node.id)) continue;
      const fresh = recorded?.get(node.id);
      if (fresh !== undefined) carried.set(node.id, fresh);
      const freshMs = recordedMs?.get(node.id);
      if (freshMs !== undefined) carriedMs.set(node.id, freshMs);
      const held = carried.get(node.id);
      const d = dates.get(node.id);
      leafData[node.id] = {
        cumProgressPct: held?.pct ?? 0,
        targetWF: d ? (node.bobot ?? 0) * leafPlanFraction(d.startDate, d.finishDate, w.endDate) : 0,
        ...(held?.qtyDone != null ? { qtyDone: held.qtyDone } : {}),
        ...(carriedMs.has(node.id) ? { milestonesDone: carriedMs.get(node.id) } : {}),
        ...(held?.source ? { source: held.source } : {}),
      };
    }
    return {
      week: w.weekNo,
      periodStart: w.startDate,
      periodEnd: w.endDate,
      documentation: [],
      leafData,
    };
  });

  // Start and finish as week numbers, for the worklist behind "What is urgent".
  // A leaf finishing mid-week belongs to the week that CONTAINS its date, which
  // is the first week whose end is not before it.
  const weekOf = (isoDate: string, fallback: number) =>
    weekRows.find((w) => w.endDate >= isoDate)?.weekNo ?? fallback;
  const lastWeekNo = weekRows.length ? weekRows[weekRows.length - 1].weekNo : 1;
  const schedule: ScheduleItem[] = [];
  for (const node of nodes) {
    if (!leafIds.has(node.id)) continue;
    const d = dates.get(node.id);
    if (!d) continue;
    schedule.push({
      leafId: node.id,
      startWeek: weekOf(d.startDate, 1),
      finishWeek: weekOf(d.finishDate, lastWeekNo),
      pattern: 'linear',
    });
  }

  const info: ProjectInfo = {
    name: project.name,
    contractNo: project.contractNo ?? '',
    customer: project.clientName ?? '',
    contractor: project.contractorName ?? '',
    workLocation: project.workLocation ?? '',
    documentNoWeekly: project.documentNoWeekly ?? '',
    documentNoDaily: project.documentNoDaily ?? '',
    // READ FROM THEIR OWN COLUMNS, which until 12 Sep 2026 they were not.
    //
    // These two lines used to fabricate a block from `contractorName` and
    // `clientName`, and both halves of that were wrong. The signatory's NAME
    // was dropped entirely, so a report printed a company over an empty rule.
    // And the sides were SWAPPED against the convention the imported project
    // actually prints by: db.json's `p-utama` has the client on the left
    // (PT PERTAMINA EP ZONA 11 / Andika Wijaya Kusumah) and the contractor on
    // the right (PT. INDOTURBINE / Yopi Budiana Perkasa). Every project on
    // this path was signing the wrong way round.
    //
    // The fallback keeps a report from printing two blank rules on a project
    // whose columns are still null, and keeps the sides the right way round
    // while doing it.
    signatureLeft: parseSignature(project.signatureLeft) ?? {
      company: project.clientName ?? '',
      name: '',
    },
    signatureRight: parseSignature(project.signatureRight) ?? {
      company: project.contractorName ?? '',
      name: '',
    },
    // THE ANCHOR IS WEEK ONE'S END, and every reader treats it as one:
    // `weekEndDate(anchor, n)` is `anchor + (n - 1) weeks`. This handed over
    // the LAST week's end instead, so every period label in the app and on all
    // five printed sheets was (weeks - 1) weeks into the future — a 72-week
    // project showed week 36 as "08 Jan – 14 Jan 2028" where the client's own
    // report said 31 Aug – 06 Sep 2026 (14 Sep 2026). The figures were never
    // wrong: `targetWF` above reads each week row's own `endDate`.
    // db.json's side has always stored week 1's end here — Gundih's 2025-10-30
    // is `weeks[0].periodEnd` — which is what makes the two stores agree.
    weekAnchorEndDate: weekRows.length ? weekRows[0].endDate : '',
    currentWeek,
    // Always a number or null on this side, never undefined: that is what tells
    // `pinnedWeekOf` it is reading a SQLite project and must not mistake the
    // computed `currentWeek` above for a pin. See lib/current-week.ts.
    currentWeekOverride: project.pinnedCurrentWeek ?? null,
    contractValue: project.contractValue ?? undefined,
    weightsLocked: project.weightBasis === 'boq',
  };

  const totalBobot = nodes
    .filter((n) => leafIds.has(n.id))
    .reduce((sum, n) => sum + (n.bobot ?? 0), 0);

  return {
    db: {
      project: info,
      wbsItems,
      weeks,
      // Both series are derived from `weeks` above, so nothing is stored here.
      // `buildSCurveSeries` only reaches for these when a week has no leaf data.
      scurvePlan: [],
      scurveActual: [],
      daily: [],
      schedule,
      changeLog,
    },
    weeks: weekRows.map((w) => w.weekNo),
    currentWeek,
    hasPlan: totalBobot > 0 && weekRows.length > 0,
    hasSchedule: nodes.length > 0 && weekRows.length > 0,
    currency: project.currency,
  };
}
