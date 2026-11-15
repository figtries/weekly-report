/**
 * Recording what the site finished — for a project that lives in SQLite.
 *
 * `lib/mutations.ts` does this for `db.json`, and it only ever had one project
 * to do it for. The weekly pages now read whichever project is open
 * (`getOpenDb` in lib/data.ts), so the Fill in screen renders for a project
 * built in the app — and a screen you can fill in but not save is worse than
 * one that was never offered.
 *
 * **The arithmetic is not repeated here.** `lib/progress.ts` decides every leaf
 * percentage and this file calls it, exactly as `applyFieldProgress` does: the
 * evidence decides the percentage, never the reverse. What differs is only
 * where the rows come from and where they go.
 *
 * Two things this store does that the JSON one could not.
 *
 * **`targetWF` is never written.** The plan curve is derived from the dates
 * (`lib/plan-curve.ts`) — a locked decision, not an optimisation — so a patch
 * carrying a target is a request to move the SCHEDULE, which this is not, and
 * it is dropped. `applyWeekUpdates` accepts one only because db.json stores the
 * curve per leaf per week.
 *
 * **Evidence is carried forward.** A row is written for the week it is reported
 * in, and a week with no row for a leaf means the leaf still stands where it
 * last stood — including its quantity. Reading the last row at or before the
 * week is what stops a correction to week 12 from being undone by week 13's
 * silence.
 */
import { and, asc, desc, eq, inArray, lte } from 'drizzle-orm';

import { db } from './pg';
import * as schema from './schema';
import { defaultMilestones, hasRealQuantity, syncLeafSnapshot, totalQty } from './progress';
import type { FieldProgressUpdate } from './mutations';
import type { LeafSnapshot, Milestone, ProgressMethod, WbsItem } from './types';
import { cascade, type WeekEvidence } from './week-log';

type Writer = Pick<typeof db, 'update' | 'insert' | 'delete'>;

/** 'linked' resolves elsewhere; for measurement it behaves as lumpsum. */
function methodOfRow(m: string | null): ProgressMethod {
  return m === 'qty' || m === 'milestone' ? m : 'lumpsum';
}

async function weekRow(projectId: string, weekNo: number) {
  const rows = await db
    .select()
    .from(schema.weeks)
    .where(and(eq(schema.weeks.projectId, projectId), eq(schema.weeks.weekNo, weekNo)));
  return rows[0];
}

/** The node, plus its milestones, in the shape `lib/progress.ts` reads. */
async function itemOf(nodeId: string): Promise<(WbsItem & { projectId: string }) | null> {
  const ns = await db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId));
  const n = ns[0];
  if (!n) return null;
  const ms = await db
    .select()
    .from(schema.milestones)
    .where(eq(schema.milestones.nodeId, nodeId))
    .orderBy(asc(schema.milestones.order));
  return {
    id: n.id,
    projectId: n.projectId,
    parentId: n.parentId,
    wbsCode: n.wbsCode,
    deskripsi: n.deskripsi,
    bobot: n.bobot ?? 0,
    vol: n.vol,
    satuan: n.satuan,
    order: n.order,
    progressMethod: methodOfRow(n.progressMethod),
    milestones: ms.length
      ? ms.map((m) => ({ id: m.id, label: m.label, weight: m.weight }))
      : undefined,
  };
}

/**
 * Where this leaf stood going INTO the given week — the last row at or before
 * it, never a later one. A week nobody filled in does not reset anything.
 */
async function standingAt(projectId: string, nodeId: string, weekNo: number): Promise<LeafSnapshot> {
  const rows = await db
    .select({
      cumProgressPct: schema.leafProgress.cumProgressPct,
      qtyDone: schema.leafProgress.qtyDone,
      note: schema.leafProgress.note,
      source: schema.leafProgress.source,
      weekId: schema.leafProgress.weekId,
    })
    .from(schema.leafProgress)
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.leafProgress.weekId))
    .where(
      and(
        eq(schema.leafProgress.nodeId, nodeId),
        eq(schema.weeks.projectId, projectId),
        lte(schema.weeks.weekNo, weekNo)
      )
    )
    .orderBy(desc(schema.weeks.weekNo));
  const row = rows[0];

  const done = row
    ? (
        await db
          .select({ milestoneId: schema.milestoneProgress.milestoneId })
          .from(schema.milestoneProgress)
          .where(
            and(
              eq(schema.milestoneProgress.weekId, row.weekId),
              eq(schema.milestoneProgress.achieved, true)
            )
          )
      ).map((m) => m.milestoneId)
    : [];

  return {
    cumProgressPct: row?.cumProgressPct ?? 0,
    // Derived on read from the dates, never stored — see the header.
    targetWF: 0,
    ...(row?.qtyDone != null ? { qtyDone: row.qtyDone } : {}),
    ...(done.length ? { milestonesDone: done } : {}),
    ...(row?.note != null ? { note: row.note } : {}),
    ...(row?.source != null ? { source: row.source as LeafSnapshot['source'] } : {}),
  };
}

async function writeSnapshot(
  tx: Writer,
  weekId: string,
  item: WbsItem,
  snap: LeafSnapshot,
  at: string
): Promise<void> {
  const method = item.progressMethod ?? 'lumpsum';
  await tx.insert(schema.leafProgress)
    .values({
      id: `${weekId}:${item.id}`,
      weekId,
      nodeId: item.id,
      method,
      cumProgressPct: snap.cumProgressPct,
      qtyDone: snap.qtyDone ?? null,
      note: snap.note ?? null,
      source: snap.source ?? null,
      recordedAt: at,
    })
    .onConflictDoUpdate({
      target: [schema.leafProgress.weekId, schema.leafProgress.nodeId],
      set: {
        method,
        cumProgressPct: snap.cumProgressPct,
        qtyDone: snap.qtyDone ?? null,
        note: snap.note ?? null,
        source: snap.source ?? null,
        recordedAt: at,
      },
    });

  const all = item.milestones ?? [];
  if (all.length === 0) return;
  const done = new Set(snap.milestonesDone ?? []);
  for (const m of all) {
    await tx.insert(schema.milestoneProgress)
      .values({
        id: `${weekId}:${m.id}`,
        weekId,
        milestoneId: m.id,
        achieved: done.has(m.id),
        recordedAt: at,
      })
      .onConflictDoUpdate({
        target: [schema.milestoneProgress.weekId, schema.milestoneProgress.milestoneId],
        set: { achieved: done.has(m.id), recordedAt: at },
      });
  }
}

/** The Fill in screen: a quantity, or the milestones reached. */
export async function saveFieldProgressSqlite(
  projectId: string,
  weekNo: number,
  updates: FieldProgressUpdate[]
): Promise<void> {
  const week = await weekRow(projectId, weekNo);
  if (!week) throw new Error(`Week ${weekNo} is not in this project`);
  const at = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const u of updates) {
      const item = await itemOf(u.leafId);
      if (!item || item.projectId !== projectId) continue;

      let next: LeafSnapshot = { ...await standingAt(projectId, u.leafId, weekNo) };
      if (u.qtyDone !== undefined) {
        next.qtyDone = Math.max(0, Math.min(totalQty(item), u.qtyDone));
        // Real evidence just arrived through the quantity form, which is
        // never the escape hatch — a stale `manual` tag left over from an
        // earlier override would otherwise freeze this figure forever (see
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
      await writeSnapshot(tx, week.id, item, next, at);
    }
  });
}

/**
 * "Checked it, nothing moved this week."
 *
 * db.json records this as a log entry and nothing else, because its weeks
 * already carry every leaf. Here it writes the figure the leaf is standing on
 * into this week, which is the same statement made in this store's own terms —
 * and it is what makes the week count as reported.
 */
export async function markNoProgressSqlite(projectId: string, weekNo: number, leafIds: string[]): Promise<void> {
  const week = await weekRow(projectId, weekNo);
  if (!week) throw new Error(`Week ${weekNo} is not in this project`);
  const at = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const leafId of leafIds) {
      const item = await itemOf(leafId);
      if (!item || item.projectId !== projectId) continue;
      const snap = await standingAt(projectId, leafId, weekNo);
      await writeSnapshot(tx, week.id, item, syncLeafSnapshot(item, snap), at);
    }
  });
}

/** The Detail table: a typed percentage, which only a lumpsum leaf really has. */
export async function saveWeekUpdatesSqlite(
  projectId: string,
  weekNo: number,
  updates: Record<string, Partial<LeafSnapshot>>
): Promise<void> {
  const week = await weekRow(projectId, weekNo);
  if (!week) throw new Error(`Week ${weekNo} is not in this project`);
  const at = new Date().toISOString();

  await db.transaction(async (tx) => {
    for (const [nodeId, patch] of Object.entries(updates)) {
      // A target is the SCHEDULE's business — see the header.
      if (patch.cumProgressPct === undefined) continue;
      const item = await itemOf(nodeId);
      if (!item || item.projectId !== projectId) continue;
      const snap = await standingAt(projectId, nodeId, weekNo);
      snap.cumProgressPct = Math.max(0, Math.min(100, patch.cumProgressPct));
      if (patch.note !== undefined) snap.note = patch.note;
      if (patch.source !== undefined) snap.source = patch.source;
      // A qty or milestone leaf still answers to its evidence, so the typed
      // figure is re-expressed rather than trusted — UNLESS it is declared
      // `source: 'manual'` above, in which case `syncLeafSnapshot` leaves it
      // alone. Without copying `patch.source` first, that declaration would
      // never reach the snapshot at all: this call would go on carrying
      // forward whatever `source` the row already stood at, `syncLeafSnapshot`
      // would see the OLD value (never 'manual'), and a percent typed through
      // the escape hatch would be silently recomputed away on this store.
      await writeSnapshot(tx, week.id, item, syncLeafSnapshot(item, snap), at);
    }
  });
}

/**
 * Changing HOW a leaf is measured, without changing how much of it is done.
 *
 * The same rule as `applyProgressMethod`, and for the same reason: recomputing
 * from evidence that does not exist yet rewrote a leaf which had sat at 100%
 * for 27 weeks down to zero. Every week the leaf already has is re-expressed in
 * the new method's own terms instead.
 */
export async function setProgressMethodSqlite(
  nodeId: string,
  method: ProgressMethod,
  opts: { vol?: number | null; satuan?: string | null; milestones?: Milestone[] } = {}
): Promise<void> {
  const item = await itemOf(nodeId);
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

  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    await tx.update(schema.wbsNodes)
      .set({
        progressMethod: method,
        ...(method === 'qty' && opts.vol !== undefined ? { vol: opts.vol } : {}),
        ...(method === 'qty' && opts.satuan !== undefined ? { satuan: opts.satuan } : {}),
      })
      .where(eq(schema.wbsNodes.id, nodeId));

    // SWITCHING CLEARS THE OTHER METHOD'S EVIDENCE — a stale quantity sitting
    // behind a milestone item is a number nobody can explain later.
    //
    // THIS ROW'S ticks only. It used to delete every tick in every week this
    // row had a figure in, which is EVERY ROW's ticks in those weeks: changing
    // one activity's kind of work took a project's actual from 66.01% to
    // 17.82% (4,656 ticks down to 188, found 7 Oct 2026; the line dates from
    // 12 Sep 2026). Scoped to this row's own rungs, by id.
    const ownRungs = (
      await db
        .select({ id: schema.milestones.id })
        .from(schema.milestones)
        .where(eq(schema.milestones.nodeId, nodeId))
    ).map((r) => r.id);
    if (ownRungs.length) {
      await tx.delete(schema.milestoneProgress)
        .where(inArray(schema.milestoneProgress.milestoneId, ownRungs));
    }
    await tx.delete(schema.milestones).where(eq(schema.milestones.nodeId, nodeId));

    let milestones: Milestone[] = [];
    if (method === 'milestone') {
      const source = opts.milestones?.length ? opts.milestones : defaultMilestones();
      milestones = source.map((m) => ({ ...m, id: `${nodeId}:${m.id}` }));
      for (const [i, m] of milestones.entries()) {
        await tx.insert(schema.milestones)
          .values({ id: m.id, nodeId, label: m.label, weight: m.weight, order: i });
      }
    }

    const next: WbsItem = {
      ...item,
      progressMethod: method,
      vol: method === 'qty' && opts.vol !== undefined ? opts.vol : item.vol,
      satuan: method === 'qty' && opts.satuan !== undefined ? opts.satuan : item.satuan,
      milestones: milestones.length ? milestones : undefined,
    };

    const rows = await db
      .select({
        weekId: schema.leafProgress.weekId,
        cumProgressPct: schema.leafProgress.cumProgressPct,
        note: schema.leafProgress.note,
        source: schema.leafProgress.source,
      })
      .from(schema.leafProgress)
      .where(eq(schema.leafProgress.nodeId, nodeId));

    const total = totalQty(next);
    const totalW = milestones.reduce((a, m) => a + m.weight, 0) || 1;

    for (const row of rows) {
      const pct = Math.max(0, Math.min(100, row.cumProgressPct ?? 0));
      // A method switch re-expresses the FIGURE, not the annotation beside it —
      // carried through untouched, same as a note survives any other resave.
      const snap: LeafSnapshot = {
        cumProgressPct: pct,
        targetWF: 0,
        ...(row.note != null ? { note: row.note } : {}),
        ...(row.source != null ? { source: row.source as LeafSnapshot['source'] } : {}),
      };
      if (method === 'qty') {
        snap.qtyDone = (pct / 100) * total;
      } else if (method === 'milestone') {
        // A ladder is climbed in order: awarded while the running total stays
        // at or below what was already reported, and stopped at the first rung
        // that would exceed it — the closest honest restatement, never more
        // generous.
        const done: string[] = [];
        let acc = 0;
        for (const m of milestones) {
          if (((acc + m.weight) / totalW) * 100 <= pct + 1e-9) {
            acc += m.weight;
            done.push(m.id);
          } else break; // a ladder is climbed in order; a rung missed ends the climb
        }
        snap.milestonesDone = done;
      }
      await writeSnapshot(tx, row.weekId, next, syncLeafSnapshot(next, snap), at);
    }

    if (method !== 'qty') {
      await tx.update(schema.leafProgress)
        .set({ qtyDone: null })
        .where(eq(schema.leafProgress.nodeId, nodeId));
    }
  });
}

/**
 * What kind of work a row is, and the ladder that answer implies.
 *
 * Does what `setProgressMethodSqlite` does, plus the one field that isn't
 * progress at all: `work_kind` names the question this row was asked, so the
 * panel can show it back rather than asking again. Reuses the same
 * transaction shape so "switching clears the other method's evidence" keeps
 * holding here too.
 */
export async function setWorkKindSqlite(
  nodeId: string,
  kindId: string,
  method: ProgressMethod,
  opts: { vol?: number | null; satuan?: string | null; milestones?: Milestone[] } = {},
  /** Construction's part, as Data Overall was told it. Null everywhere else. */
  part: string | null = null
): Promise<void> {
  // The same ladder again (Other picked on a row already on the generic
  // ladder) is an answer, not a re-measure: the rungs and their ticks stay.
  const nodes = await db
    .select({ method: schema.wbsNodes.progressMethod })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.id, nodeId));
  const node = nodes[0];
  const own = await db
    .select({ id: schema.milestones.id, weight: schema.milestones.weight })
    .from(schema.milestones)
    .where(eq(schema.milestones.nodeId, nodeId))
    .orderBy(schema.milestones.order);
  const next = opts.milestones ?? [];
  const sameLadder =
    method === 'milestone' &&
    node?.method === 'milestone' &&
    own.length > 0 &&
    own.length === next.length &&
    own.every((m, i) => m.id === `${nodeId}:${next[i].id}` && m.weight === next[i].weight);
  if (!sameLadder) await setProgressMethodSqlite(nodeId, method, opts);
  await db.update(schema.wbsNodes)
    .set({ workKind: kindId, workPart: kindId === 'construction' ? part : null })
    .where(eq(schema.wbsNodes.id, nodeId));
}

/* ----------------------------------------------- what only a person knows */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FORECAST_SOURCES = new Set(['vendor', 'site', 'client']);

/** A leaf of this project, or an error saying which it is not. */
async function leafOfProject(projectId: string, nodeId: string) {
  const ns = await db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId));
  const n = ns[0];
  if (!n || n.projectId !== projectId) throw new Error('Item not found');
  const children = await db
    .select({ id: schema.wbsNodes.id })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.parentId, nodeId));
  if (children[0]) throw new Error('Only an activity can carry a forecast date or wait for another');
  return n;
}

/**
 * The date someone outside the app gave for this activity's next rung (or its
 * finish), or null to go back to the plan. On the ACTIVITY, never on the
 * week's progress row: that row is the record that somebody checked the
 * progress, and a vendor's email is not that (lib/forecast.ts).
 */
export async function setLeafForecastSqlite(
  projectId: string,
  nodeId: string,
  value: { date: string; source: string; rungId: string | null } | null,
  week: number
): Promise<void> {
  await leafOfProject(projectId, nodeId);
  if (value) {
    if (!ISO_DATE.test(value.date) || Number.isNaN(Date.parse(value.date))) throw new Error('That is not a date');
    if (!FORECAST_SOURCES.has(value.source)) throw new Error('Say who gave the date: vendor, site or client');
    if (value.rungId) {
      const rungs = await db.select().from(schema.milestones).where(eq(schema.milestones.id, value.rungId));
      const rung = rungs[0];
      if (!rung || rung.nodeId !== nodeId) throw new Error('That stage is not on this activity');
    }
  }
  await db.update(schema.wbsNodes)
    .set({
      forecastDate: value?.date ?? null,
      forecastSource: value?.source ?? null,
      forecastRung: value?.rungId ?? null,
      forecastWeek: value ? week : null,
    })
    .where(eq(schema.wbsNodes.id, nodeId));
}

// Links between activities are written by lib/links-sqlite.ts (since 7 Oct
// 2026 they are made in Projects, with a way and a wait).

/* ------------------------------------------------------ one leaf, many weeks */

/**
 * Weeks that carry an approval. A signature that silently follows the number
 * it signed is worth nothing in a dispute, so the log will not write into one
 * of these unless the person has said, for this save, that they mean to.
 */
export async function signedWeeksSqlite(projectId: string): Promise<Set<number>> {
  const rows = await db
    .select({ weekNo: schema.weeks.weekNo })
    .from(schema.approvals)
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.approvals.weekId))
    .where(eq(schema.weeks.projectId, projectId));
  return new Set(rows.map((r) => r.weekNo));
}

/** Refused because the save touches signed weeks nobody agreed to change. */
export class SignedWeeksError extends Error {
  // A plain field, not a constructor parameter property: the verify scripts
  // run this file through Node's type stripping, which cannot erase those.
  weeks: number[];
  constructor(weeks: number[]) {
    const one = weeks.length === 1;
    super(
      `${weeks.map((w) => `W${w}`).join(', ')} ${one ? 'is' : 'are'} signed. Confirm the change to write ${one ? 'it' : 'them'}.`
    );
    this.weeks = weeks;
  }
}

type LeafProgressRow = typeof schema.leafProgress.$inferSelect;
type MilestoneProgressRow = typeof schema.milestoneProgress.$inferSelect;

/**
 * What a week looked like before the log wrote it, EXACTLY: the raw rows, or
 * null where the week had none. Undo puts these back — and deleting a row
 * that did not exist before matters as much as restoring one that did, because
 * under carry-forward an empty week and a week holding 0% are not the same
 * statement.
 */
export interface LeafWeekBefore {
  weekId: string;
  leaf: LeafProgressRow | null;
  milestones: MilestoneProgressRow[];
}

/** Each recorded week's evidence for one leaf, keyed by week number. */
async function recordedEvidence(projectId: string, nodeId: string): Promise<Map<number, WeekEvidence>> {
  const rows = await db
    .select({
      weekId: schema.leafProgress.weekId,
      weekNo: schema.weeks.weekNo,
      cumProgressPct: schema.leafProgress.cumProgressPct,
      qtyDone: schema.leafProgress.qtyDone,
      note: schema.leafProgress.note,
      source: schema.leafProgress.source,
    })
    .from(schema.leafProgress)
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.leafProgress.weekId))
    .where(and(eq(schema.leafProgress.nodeId, nodeId), eq(schema.weeks.projectId, projectId)));
  const ms = await db
    .select({ weekId: schema.milestoneProgress.weekId, milestoneId: schema.milestoneProgress.milestoneId })
    .from(schema.milestoneProgress)
    .innerJoin(schema.milestones, eq(schema.milestones.id, schema.milestoneProgress.milestoneId))
    .where(and(eq(schema.milestones.nodeId, nodeId), eq(schema.milestoneProgress.achieved, true)));
  const doneByWeek = new Map<string, string[]>();
  for (const m of ms) doneByWeek.set(m.weekId, [...(doneByWeek.get(m.weekId) ?? []), m.milestoneId]);

  const out = new Map<number, WeekEvidence>();
  for (const r of rows) {
    const done = doneByWeek.get(r.weekId);
    out.set(r.weekNo, {
      cumProgressPct: r.cumProgressPct ?? 0,
      ...(r.qtyDone != null ? { qtyDone: r.qtyDone } : {}),
      ...(done ? { milestonesDone: done } : {}),
      ...(r.note != null ? { note: r.note } : {}),
      ...(r.source != null ? { source: r.source as WeekEvidence['source'] } : {}),
    });
  }
  return out;
}

const SOURCES = new Set(['gate', 'steps', 'qty', 'quote', 'manual']);

/**
 * Write several weeks of ONE leaf in one transaction — the log's single-week
 * save and its "Repeat weekly" both come through here.
 *
 * The weeks that move with the edit (`cascade` in `lib/week-log.ts`) are
 * worked out HERE again rather than taken from the client, with the same
 * function the preview used, so the screen can only ever have promised what
 * this writes. Every figure still goes through `syncLeafSnapshot`.
 *
 * Returns the rows as they were, for Undo.
 */
export async function saveLeafWeeksSqlite(
  projectId: string,
  nodeId: string,
  edits: { week: number; evidence: WeekEvidence }[],
  { allowSigned = false }: { allowSigned?: boolean } = {}
): Promise<LeafWeekBefore[]> {
  const item = await itemOf(nodeId);
  if (!item || item.projectId !== projectId) throw new Error('Item not found');

  const weekRows = await db
    .select({ id: schema.weeks.id, weekNo: schema.weeks.weekNo })
    .from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId));
  const weekIdOf = new Map(weekRows.map((w) => [w.weekNo, w.id]));

  // What the client sent is a request, not a fact: clamp it to what the item
  // can hold and drop anything it cannot.
  const total = totalQty(item);
  const valid = new Set((item.milestones ?? []).map((m) => m.id));
  const clean = new Map<number, WeekEvidence>();
  for (const e of edits) {
    if (!weekIdOf.has(e.week)) throw new Error(`Week ${e.week} is not in this project`);
    const ev = e.evidence;
    clean.set(e.week, {
      cumProgressPct: Math.max(0, Math.min(100, Number(ev.cumProgressPct) || 0)),
      ...(ev.qtyDone !== undefined ? { qtyDone: Math.max(0, Math.min(total, Number(ev.qtyDone) || 0)) } : {}),
      ...(ev.milestonesDone !== undefined
        ? { milestonesDone: ev.milestonesDone.filter((id) => valid.has(id)) }
        : {}),
      ...(typeof ev.note === 'string' && ev.note ? { note: ev.note.slice(0, 500) } : {}),
      ...(ev.source && SOURCES.has(ev.source) ? { source: ev.source } : {}),
    });
  }
  if (!clean.size) return [];

  const logItem = { progressMethod: item.progressMethod ?? 'lumpsum', vol: item.vol, milestones: item.milestones };
  const { writes } = cascade(logItem, await recordedEvidence(projectId, nodeId), clean);

  const signed = await signedWeeksSqlite(projectId);
  const touchesSigned = [...writes.keys()].filter((w) => signed.has(w)).sort((a, b) => a - b);
  if (touchesSigned.length && !allowSigned) throw new SignedWeeksError(touchesSigned);

  const msIds = (item.milestones ?? []).map((m) => m.id);
  const before: LeafWeekBefore[] = await Promise.all(
    [...writes.keys()].map(async (w) => {
      const weekId = weekIdOf.get(w)!;
      const leafRows = await db
        .select()
        .from(schema.leafProgress)
        .where(and(eq(schema.leafProgress.weekId, weekId), eq(schema.leafProgress.nodeId, nodeId)));
      const leaf = leafRows[0] ?? null;
      const milestones = msIds.length
        ? await db
            .select()
            .from(schema.milestoneProgress)
            .where(
              and(
                eq(schema.milestoneProgress.weekId, weekId),
                inArray(schema.milestoneProgress.milestoneId, msIds)
              )
            )
        : [];
      return { weekId, leaf, milestones };
    })
  );

  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const [w, ev] of writes) {
      await writeSnapshot(tx, weekIdOf.get(w)!, item, syncLeafSnapshot(item, { targetWF: 0, ...ev }), at);
    }
  });
  return before;
}

/**
 * Undo: put every week back exactly as `saveLeafWeeksSqlite` found it.
 *
 * The rows come back from the client, so each one is checked against the leaf
 * and the project before anything is written: a row for another leaf, another
 * project's week or another leaf's milestone is refused rather than restored.
 */
export async function restoreLeafWeeksSqlite(projectId: string, nodeId: string, before: LeafWeekBefore[]): Promise<void> {
  const item = await itemOf(nodeId);
  if (!item || item.projectId !== projectId) throw new Error('Item not found');
  const ownWeeks = new Set(
    (
      await db
        .select({ id: schema.weeks.id })
        .from(schema.weeks)
        .where(eq(schema.weeks.projectId, projectId))
    ).map((w) => w.id)
  );
  const msIds = (item.milestones ?? []).map((m) => m.id);
  const ownMs = new Set(msIds);
  for (const b of before) {
    if (!ownWeeks.has(b.weekId)) throw new Error('That week is not in this project');
    if (b.leaf && (b.leaf.nodeId !== nodeId || b.leaf.weekId !== b.weekId)) throw new Error('Nothing to undo');
    if (b.milestones.some((m) => m.weekId !== b.weekId || !ownMs.has(m.milestoneId))) {
      throw new Error('Nothing to undo');
    }
  }

  await db.transaction(async (tx) => {
    for (const b of before) {
      await tx.delete(schema.leafProgress)
        .where(and(eq(schema.leafProgress.weekId, b.weekId), eq(schema.leafProgress.nodeId, nodeId)));
      if (msIds.length) {
        await tx.delete(schema.milestoneProgress)
          .where(
            and(
              eq(schema.milestoneProgress.weekId, b.weekId),
              inArray(schema.milestoneProgress.milestoneId, msIds)
            )
          );
      }
      if (b.leaf) await tx.insert(schema.leafProgress).values(b.leaf);
      for (const m of b.milestones) await tx.insert(schema.milestoneProgress).values(m);
    }
  });
}
