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
      recordedAt: at,
    })
    .onConflictDoUpdate({
      target: [schema.leafProgress.weekId, schema.leafProgress.nodeId],
      set: {
        method,
        cumProgressPct: snap.cumProgressPct,
        qtyDone: snap.qtyDone ?? null,
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
      }
      if (u.milestonesDone !== undefined) {
        const valid = new Set((item.milestones ?? []).map((m) => m.id));
        next.milestonesDone = u.milestonesDone.filter((id) => valid.has(id));
      }
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
      // A qty or milestone leaf still answers to its evidence, so the typed
      // figure is re-expressed rather than trusted: `syncLeafSnapshot` puts the
      // percentage back to whatever the evidence says it is.
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
      })
      .from(schema.leafProgress)
      .where(eq(schema.leafProgress.nodeId, nodeId))
      .all();

    const total = totalQty(next);
    const totalW = milestones.reduce((a, m) => a + m.weight, 0) || 1;

    for (const row of rows) {
      const pct = Math.max(0, Math.min(100, row.cumProgressPct ?? 0));
      const snap: LeafSnapshot = { cumProgressPct: pct, targetWF: 0 };
      if (method === 'qty') {
        snap.qtyDone = (pct / 100) * total;
      } else if (method === 'milestone') {
        // Awarded in order until the next one would exceed what was already
        // reported — the closest honest restatement, never more generous.
        const done: string[] = [];
        let acc = 0;
        for (const m of milestones) {
          if (((acc + m.weight) / totalW) * 100 <= pct + 1e-9) {
            acc += m.weight;
            done.push(m.id);
          }
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
