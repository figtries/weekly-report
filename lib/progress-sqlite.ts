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

import { db, schema } from './sqlite';
import { defaultMilestones, hasRealQuantity, syncLeafSnapshot, totalQty } from './progress';
import type { FieldProgressUpdate } from './mutations';
import type { LeafSnapshot, Milestone, ProgressMethod, WbsItem } from './types';
import { cascade, type WeekEvidence } from './week-log';

type Writer = Pick<typeof db, 'update' | 'insert' | 'delete'>;

/** 'linked' resolves elsewhere; for measurement it behaves as lumpsum. */
function methodOfRow(m: string | null): ProgressMethod {
  return m === 'qty' || m === 'milestone' ? m : 'lumpsum';
}

function weekRow(projectId: string, weekNo: number) {
  return db
    .select()
    .from(schema.weeks)
    .where(and(eq(schema.weeks.projectId, projectId), eq(schema.weeks.weekNo, weekNo)))
    .all()[0];
}

/** The node, plus its milestones, in the shape `lib/progress.ts` reads. */
function itemOf(nodeId: string): (WbsItem & { projectId: string }) | null {
  const n = db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, nodeId)).all()[0];
  if (!n) return null;
  const ms = db
    .select()
    .from(schema.milestones)
    .where(eq(schema.milestones.nodeId, nodeId))
    .orderBy(asc(schema.milestones.order))
    .all();
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
function standingAt(projectId: string, nodeId: string, weekNo: number): LeafSnapshot {
  const row = db
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
    .orderBy(desc(schema.weeks.weekNo))
    .all()[0];

  const done = row
    ? db
        .select({ milestoneId: schema.milestoneProgress.milestoneId })
        .from(schema.milestoneProgress)
        .where(
          and(
            eq(schema.milestoneProgress.weekId, row.weekId),
            eq(schema.milestoneProgress.achieved, true)
          )
        )
        .all()
        .map((m) => m.milestoneId)
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

function writeSnapshot(
  tx: Writer,
  weekId: string,
  item: WbsItem,
  snap: LeafSnapshot,
  at: string
): void {
  const method = item.progressMethod ?? 'lumpsum';
  tx.insert(schema.leafProgress)
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
    })
    .run();

  const all = item.milestones ?? [];
  if (all.length === 0) return;
  const done = new Set(snap.milestonesDone ?? []);
  for (const m of all) {
    tx.insert(schema.milestoneProgress)
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
      })
      .run();
  }
}

/** The Fill in screen: a quantity, or the milestones reached. */
export function saveFieldProgressSqlite(
  projectId: string,
  weekNo: number,
  updates: FieldProgressUpdate[]
): void {
  const week = weekRow(projectId, weekNo);
  if (!week) throw new Error(`Week ${weekNo} is not in this project`);
  const at = new Date().toISOString();

  db.transaction((tx) => {
    for (const u of updates) {
      const item = itemOf(u.leafId);
      if (!item || item.projectId !== projectId) continue;

      let next: LeafSnapshot = { ...standingAt(projectId, u.leafId, weekNo) };
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
      writeSnapshot(tx, week.id, item, next, at);
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
export function markNoProgressSqlite(projectId: string, weekNo: number, leafIds: string[]): void {
  const week = weekRow(projectId, weekNo);
  if (!week) throw new Error(`Week ${weekNo} is not in this project`);
  const at = new Date().toISOString();

  db.transaction((tx) => {
    for (const leafId of leafIds) {
      const item = itemOf(leafId);
      if (!item || item.projectId !== projectId) continue;
      const snap = standingAt(projectId, leafId, weekNo);
      writeSnapshot(tx, week.id, item, syncLeafSnapshot(item, snap), at);
    }
  });
}

/** The Detail table: a typed percentage, which only a lumpsum leaf really has. */
export function saveWeekUpdatesSqlite(
  projectId: string,
  weekNo: number,
  updates: Record<string, Partial<LeafSnapshot>>
): void {
  const week = weekRow(projectId, weekNo);
  if (!week) throw new Error(`Week ${weekNo} is not in this project`);
  const at = new Date().toISOString();

  db.transaction((tx) => {
    for (const [nodeId, patch] of Object.entries(updates)) {
      // A target is the SCHEDULE's business — see the header.
      if (patch.cumProgressPct === undefined) continue;
      const item = itemOf(nodeId);
      if (!item || item.projectId !== projectId) continue;
      const snap = standingAt(projectId, nodeId, weekNo);
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
      writeSnapshot(tx, week.id, item, syncLeafSnapshot(item, snap), at);
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
export function setProgressMethodSqlite(
  nodeId: string,
  method: ProgressMethod,
  opts: { vol?: number | null; satuan?: string | null; milestones?: Milestone[] } = {}
): void {
  const item = itemOf(nodeId);
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
  db.transaction((tx) => {
    tx.update(schema.wbsNodes)
      .set({
        progressMethod: method,
        ...(method === 'qty' && opts.vol !== undefined ? { vol: opts.vol } : {}),
        ...(method === 'qty' && opts.satuan !== undefined ? { satuan: opts.satuan } : {}),
      })
      .where(eq(schema.wbsNodes.id, nodeId))
      .run();

    // SWITCHING CLEARS THE OTHER METHOD'S EVIDENCE — a stale quantity sitting
    // behind a milestone item is a number nobody can explain later.
    const weekIds = db
      .select({ weekId: schema.leafProgress.weekId })
      .from(schema.leafProgress)
      .where(eq(schema.leafProgress.nodeId, nodeId))
      .all()
      .map((r) => r.weekId);
    if (weekIds.length) {
      tx.delete(schema.milestoneProgress)
        .where(inArray(schema.milestoneProgress.weekId, weekIds))
        .run();
    }
    tx.delete(schema.milestones).where(eq(schema.milestones.nodeId, nodeId)).run();

    let milestones: Milestone[] = [];
    if (method === 'milestone') {
      const source = opts.milestones?.length ? opts.milestones : defaultMilestones();
      milestones = source.map((m) => ({ ...m, id: `${nodeId}:${m.id}` }));
      for (const [i, m] of milestones.entries()) {
        tx.insert(schema.milestones)
          .values({ id: m.id, nodeId, label: m.label, weight: m.weight, order: i })
          .run();
      }
    }

    const next: WbsItem = {
      ...item,
      progressMethod: method,
      vol: method === 'qty' && opts.vol !== undefined ? opts.vol : item.vol,
      satuan: method === 'qty' && opts.satuan !== undefined ? opts.satuan : item.satuan,
      milestones: milestones.length ? milestones : undefined,
    };

    const rows = db
      .select({
        weekId: schema.leafProgress.weekId,
        cumProgressPct: schema.leafProgress.cumProgressPct,
        note: schema.leafProgress.note,
        source: schema.leafProgress.source,
      })
      .from(schema.leafProgress)
      .where(eq(schema.leafProgress.nodeId, nodeId))
      .all();

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
      writeSnapshot(tx, row.weekId, next, syncLeafSnapshot(next, snap), at);
    }

    if (method !== 'qty') {
      tx.update(schema.leafProgress)
        .set({ qtyDone: null })
        .where(eq(schema.leafProgress.nodeId, nodeId))
        .run();
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
export function setWorkKindSqlite(
  nodeId: string,
  kindId: string,
  method: ProgressMethod,
  opts: { vol?: number | null; satuan?: string | null; milestones?: Milestone[] } = {}
): void {
  setProgressMethodSqlite(nodeId, method, opts);
  db.update(schema.wbsNodes)
    .set({ workKind: kindId })
    .where(eq(schema.wbsNodes.id, nodeId))
    .run();
}

/* ------------------------------------------------------ one leaf, many weeks */

/**
 * Weeks that carry an approval. A signature that silently follows the number
 * it signed is worth nothing in a dispute, so the log will not write into one
 * of these unless the person has said, for this save, that they mean to.
 */
export function signedWeeksSqlite(projectId: string): Set<number> {
  const rows = db
    .select({ weekNo: schema.weeks.weekNo })
    .from(schema.approvals)
    .innerJoin(schema.weeks, eq(schema.weeks.id, schema.approvals.weekId))
    .where(eq(schema.weeks.projectId, projectId))
    .all();
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
function recordedEvidence(projectId: string, nodeId: string): Map<number, WeekEvidence> {
  const rows = db
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
    .where(and(eq(schema.leafProgress.nodeId, nodeId), eq(schema.weeks.projectId, projectId)))
    .all();
  const ms = db
    .select({ weekId: schema.milestoneProgress.weekId, milestoneId: schema.milestoneProgress.milestoneId })
    .from(schema.milestoneProgress)
    .innerJoin(schema.milestones, eq(schema.milestones.id, schema.milestoneProgress.milestoneId))
    .where(and(eq(schema.milestones.nodeId, nodeId), eq(schema.milestoneProgress.achieved, true)))
    .all();
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
export function saveLeafWeeksSqlite(
  projectId: string,
  nodeId: string,
  edits: { week: number; evidence: WeekEvidence }[],
  { allowSigned = false }: { allowSigned?: boolean } = {}
): LeafWeekBefore[] {
  const item = itemOf(nodeId);
  if (!item || item.projectId !== projectId) throw new Error('Item not found');

  const weekRows = db
    .select({ id: schema.weeks.id, weekNo: schema.weeks.weekNo })
    .from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId))
    .all();
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
  const { writes } = cascade(logItem, recordedEvidence(projectId, nodeId), clean);

  const signed = signedWeeksSqlite(projectId);
  const touchesSigned = [...writes.keys()].filter((w) => signed.has(w)).sort((a, b) => a - b);
  if (touchesSigned.length && !allowSigned) throw new SignedWeeksError(touchesSigned);

  const msIds = (item.milestones ?? []).map((m) => m.id);
  const before: LeafWeekBefore[] = [...writes.keys()].map((w) => {
    const weekId = weekIdOf.get(w)!;
    const leaf =
      db
        .select()
        .from(schema.leafProgress)
        .where(and(eq(schema.leafProgress.weekId, weekId), eq(schema.leafProgress.nodeId, nodeId)))
        .all()[0] ?? null;
    const milestones = msIds.length
      ? db
          .select()
          .from(schema.milestoneProgress)
          .where(
            and(
              eq(schema.milestoneProgress.weekId, weekId),
              inArray(schema.milestoneProgress.milestoneId, msIds)
            )
          )
          .all()
      : [];
    return { weekId, leaf, milestones };
  });

  const at = new Date().toISOString();
  db.transaction((tx) => {
    for (const [w, ev] of writes) {
      writeSnapshot(tx, weekIdOf.get(w)!, item, syncLeafSnapshot(item, { targetWF: 0, ...ev }), at);
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
export function restoreLeafWeeksSqlite(projectId: string, nodeId: string, before: LeafWeekBefore[]): void {
  const item = itemOf(nodeId);
  if (!item || item.projectId !== projectId) throw new Error('Item not found');
  const ownWeeks = new Set(
    db
      .select({ id: schema.weeks.id })
      .from(schema.weeks)
      .where(eq(schema.weeks.projectId, projectId))
      .all()
      .map((w) => w.id)
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

  db.transaction((tx) => {
    for (const b of before) {
      tx.delete(schema.leafProgress)
        .where(and(eq(schema.leafProgress.weekId, b.weekId), eq(schema.leafProgress.nodeId, nodeId)))
        .run();
      if (msIds.length) {
        tx.delete(schema.milestoneProgress)
          .where(
            and(
              eq(schema.milestoneProgress.weekId, b.weekId),
              inArray(schema.milestoneProgress.milestoneId, msIds)
            )
          )
          .run();
      }
      if (b.leaf) tx.insert(schema.leafProgress).values(b.leaf).run();
      for (const m of b.milestones) tx.insert(schema.milestoneProgress).values(m).run();
    }
  });
}
