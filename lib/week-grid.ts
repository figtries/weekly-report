/**
 * The reporting weeks a project is divided into.
 *
 * Split out of `lib/project-actions.ts` because that file is `'use server'`,
 * where every export becomes a server action and a synchronous helper cannot
 * be one — the same reason `lib/signature.ts` exists.
 *
 * **The grid follows the project's dates.** It used to be laid out once, when
 * the project was created, and editing the start date afterwards only wrote
 * the column. So a plan whose first week was typed three days early stayed
 * three days early for its whole life, with nothing on any screen able to move
 * it: on PHSS Samberah every week ended three days before the week the
 * client's own report names, which cost 0.24 points of plan on week 36 and
 * something on every other week (14 Sep 2026).
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db, schema } from './sqlite';

const MS_PER_DAY = 86_400_000;

function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Seven-day blocks from the project start, the last one clipped at the finish.
 *
 * Gundih's weeks end on a Thursday because its reporting week does; that is a
 * per-project agreement nobody has been asked for yet, so a new project gets
 * the one rule that needs no answer — week 1 starts the day the project does.
 */
export function weekRowsFor(projectId: string, startDate: string, finishDate: string) {
  const start = utc(startDate);
  const finish = utc(finishDate);
  const rows: { id: string; projectId: string; weekNo: number; startDate: string; endDate: string }[] = [];
  let cursor = start;
  let n = 1;
  // 20 years of weeks is far past any EPC contract and stops a typo'd century
  // from trying to write a million rows.
  while (cursor <= finish && n <= 1040) {
    const end = Math.min(cursor + 6 * MS_PER_DAY, finish);
    rows.push({
      id: `${projectId}:W${n}`,
      projectId,
      weekNo: n,
      startDate: iso(cursor),
      endDate: iso(end),
    });
    cursor = end + MS_PER_DAY;
    n += 1;
  }
  return rows;
}

/**
 * Re-lay an existing project's weeks over its current dates.
 *
 * Weeks are matched by NUMBER, not by id: week 36 stays week 36 and keeps
 * everything recorded against it, it just covers the right seven days now.
 *
 * **A surplus week is only dropped if nothing was ever recorded against it.**
 * `leaf_progress`, `milestone_progress` and `approvals` all cascade from
 * `weeks`, so deleting week 60 off a shortened project would take a signed
 * approval and sixty leaves of progress with it. Shortening a project is not a
 * reason to destroy what was reported: the empty tail goes, the rest stays and
 * can still be looked at.
 *
 * Returns what it did, which is what the verify script asserts on.
 */
export function relayWeeks(projectId: string): { moved: number; added: number; removed: number; kept: number } {
  const done = { moved: 0, added: 0, removed: 0, kept: 0 };
  const project = db
    .select({ startDate: schema.projects.startDate, finishDate: schema.projects.finishDate })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .all()[0];
  if (!project?.startDate || !project?.finishDate) return done;
  if (utc(project.finishDate) < utc(project.startDate)) return done;

  const wanted = weekRowsFor(projectId, project.startDate, project.finishDate);
  if (!wanted.length) return done;

  const have = db.select().from(schema.weeks).where(eq(schema.weeks.projectId, projectId)).all();
  const byNo = new Map(have.map((w) => [w.weekNo, w]));
  const takenIds = new Set(have.map((w) => w.id));

  const used = new Set<string>();
  for (const r of db.select({ weekId: schema.leafProgress.weekId }).from(schema.leafProgress).all())
    used.add(r.weekId);
  for (const r of db
    .select({ weekId: schema.milestoneProgress.weekId })
    .from(schema.milestoneProgress)
    .all())
    used.add(r.weekId);
  for (const r of db.select({ weekId: schema.approvals.weekId }).from(schema.approvals).all())
    used.add(r.weekId);

  db.transaction((tx) => {
    for (const w of wanted) {
      const cur = byNo.get(w.weekNo);
      if (!cur) {
        // The generated id is `<project>:W<n>`, which an importer's own
        // numbering could already be holding under a different week number.
        const id = takenIds.has(w.id) ? `${w.id}:${randomUUID().slice(0, 4)}` : w.id;
        tx.insert(schema.weeks).values({ ...w, id }).run();
        done.added += 1;
        continue;
      }
      if (cur.startDate === w.startDate && cur.endDate === w.endDate) continue;
      tx.update(schema.weeks)
        .set({ startDate: w.startDate, endDate: w.endDate })
        .where(eq(schema.weeks.id, cur.id))
        .run();
      done.moved += 1;
    }
    for (const cur of have) {
      if (cur.weekNo <= wanted.length) continue;
      if (used.has(cur.id)) {
        done.kept += 1;
        continue;
      }
      tx.delete(schema.weeks).where(eq(schema.weeks.id, cur.id)).run();
      done.removed += 1;
    }
  });

  return done;
}
