/**
 * Two repairs, proved on a throwaway copy of the real database.
 *
 * Run: npx tsx scripts/verify-week-grid.mts
 * (the throwaway fixture is built by the script itself).
 *
 * **A package covers what is inside it.** PHSS Samberah's Engineering row held
 * a box of 30 Dec 25 to 30 Dec 25 with two lines of work inside it running to
 * November, because indent, drag and paste never looked at a package's dates —
 * only a typed date was ever fenced. The sheet DRAWS the widened span, so the
 * refusal named a range that appears on no screen, and both lines were frozen
 * for good. `coverChildren` catches the stored box up to the bar already drawn,
 * and only ever widens.
 *
 * **The week grid follows the project's dates.** Weeks were laid out once, at
 * creation. Samberah's first week was typed 26 Dec 25 against a plan whose
 * weeks run from Monday 29 Dec, so every week ended three days early and the
 * week 36 plan came out 0.24 points light, forever, with nothing on any screen
 * able to move it.
 *
 * The last assertion is the one that matters most: re-laying the grid must not
 * cost a single recorded figure. `weeks` cascades into `leaf_progress`,
 * `milestone_progress` and `approvals`.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { copyDbFixture } from './db-fixture.ts';

const fixture = path.join(os.tmpdir(), `week-grid-${Date.now()}.db`);
copyDbFixture('data/report.db', fixture);
process.env.REPORT_DB_PATH = fixture;

const { db, schema, sqlite } = await import('../lib/sqlite.ts');
const { coverChildren, boxAt, boxAbove, rowSpan, getActiveBaselineId } = await import('../lib/sheet.ts');
const { relayWeeks, weekRowsFor } = await import('../lib/week-grid.ts');
const { eq, and } = await import('drizzle-orm');

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!pass) failures += 1;
}

// ---------------------------------------------------------------- packages

// The largest plan in the database. Written against Gundih, removed 26 Sep 2026.
const PROJECT = (
  sqlite
    .prepare('select project_id id, count(*) c from wbs_nodes group by project_id order by c desc limit 1')
    .get() as { id: string } | undefined
)?.id ?? 'none';
const baselineId = getActiveBaselineId(PROJECT)!;

// Gundih is the control: all 67 of its branches carry stored dates that already
// equal their rollup, so a correct repair moves nothing at all.
check('an intact plan is left alone', coverChildren(PROJECT, baselineId) === 0);

// The checks below need a package: a branch with at least two dated rows. The
// plan this was written against (Gundih) had 67; a flat plan has none, so one
// is made here the way indent makes one — two rows moved under the row above
// them, which stops being a leaf. The fixture is a throwaway copy.
{
  const hasBranch = db
    .select({ id: schema.wbsNodes.id })
    .from(schema.wbsNodes)
    .where(and(eq(schema.wbsNodes.projectId, PROJECT), eq(schema.wbsNodes.isLeaf, false)))
    .all()
    .some((n) => db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.parentId, n.id)).all().length >= 2);
  if (!hasBranch) {
    const rows = db
      .select({ id: schema.wbsNodes.id, parentId: schema.wbsNodes.parentId, order: schema.wbsNodes.order })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.projectId, PROJECT))
      .all()
      .sort((a, b) => a.order - b.order)
      .filter((r) => !!rowSpan(r.id, baselineId));
    const [head, ...next] = rows.filter((r) => (r.parentId ?? null) === (rows[0]?.parentId ?? null));
    if (!head || next.length < 2) throw new Error('The plan under test has too few dated rows to build a package from');
    sqlite.prepare('update wbs_nodes set parent_id = ? where id in (?, ?)').run(head.id, next[0].id, next[1].id);
    sqlite.prepare('update wbs_nodes set is_leaf = 0 where id = ?').run(head.id);
    // An intact package's box is exactly its work, as every one of Gundih's
    // was: the checks below squash it and expect the repair to restore that.
    const spans = [next[0].id, next[1].id].map((id) => rowSpan(id, baselineId)!);
    const start = spans.map((s) => s.start).sort()[0];
    const finish = spans.map((s) => s.finish).sort().at(-1)!;
    sqlite
      .prepare('update node_schedules set start_date = ?, finish_date = ? where baseline_id = ? and node_id = ?')
      .run(start, finish, baselineId, head.id);
  }
}

// Now break one the way the planner did: a package narrowed to a single day
// with its children left where they are.
const victim = db
  .select({ id: schema.wbsNodes.id, name: schema.wbsNodes.deskripsi })
  .from(schema.wbsNodes)
  .where(and(eq(schema.wbsNodes.projectId, PROJECT), eq(schema.wbsNodes.isLeaf, false)))
  .all()
  .find((n) => {
    const kids = db
      .select({ id: schema.wbsNodes.id })
      .from(schema.wbsNodes)
      .where(eq(schema.wbsNodes.parentId, n.id))
      .all();
    return kids.length >= 2 && !!rowSpan(n.id, baselineId);
  })!;

const before = rowSpan(victim.id, baselineId)!;
sqlite
  .prepare('update node_schedules set start_date = ?, finish_date = ?, duration_days = 1 where baseline_id = ? and node_id = ?')
  .run(before.start, before.start, baselineId, victim.id);

const stuckBox = boxAt(victim.id, baselineId)!;
const stuckSpan = rowSpan(victim.id, baselineId)!;
check(
  'a squashed package fences against dates the sheet never shows',
  stuckBox.finish !== stuckSpan.finish,
  `box ends ${stuckBox.finish}, bar ends ${stuckSpan.finish}`
);

// The fence is `boxAbove` and nothing else — `checkFits` refuses any row whose
// dates fall outside it. So a line inside a squashed package is refused EVERY
// date it could be given, including the one it is already sitting on, which is
// what "I want to fix the date and it will not let me" actually is.
// The one that reaches furthest past the squashed box — the line the package
// was drawn around and can no longer hold.
const kid = db
  .select({ id: schema.wbsNodes.id })
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.parentId, victim.id))
  .all()
  .filter((k) => !!rowSpan(k.id, baselineId))
  .sort(
    (a, b) =>
      (rowSpan(b.id, baselineId)!.finish > rowSpan(a.id, baselineId)!.finish ? 1 : -1)
  )[0];
const kidSpan = rowSpan(kid.id, baselineId)!;
const kidFenceBefore = boxAbove(kid.id, baselineId)!;
check(
  'its lines are refused even the dates they already hold',
  kidSpan.start < kidFenceBefore.start || kidSpan.finish > kidFenceBefore.finish,
  `row ${kidSpan.start} to ${kidSpan.finish}, fence ${kidFenceBefore.start} to ${kidFenceBefore.finish}`
);

const widened = coverChildren(PROJECT, baselineId);
const fixedBox = boxAt(victim.id, baselineId)!;
check('the box catches up to the bar', widened >= 1 && fixedBox.finish === before.finish, `${widened} widened, ${fixedBox.start} to ${fixedBox.finish}`);
check('and the bar itself has not moved', rowSpan(victim.id, baselineId)!.finish === before.finish);
check('running it again is a no-op', coverChildren(PROJECT, baselineId) === 0);

const kidFenceAfter = boxAbove(kid.id, baselineId)!;
check(
  'and the fence now holds what is inside it, so the dates can be typed again',
  kidSpan.start >= kidFenceAfter.start && kidSpan.finish <= kidFenceAfter.finish,
  `fence ${kidFenceAfter.start} to ${kidFenceAfter.finish}`
);

// Widening never narrows: give the package a box far wider than its work and
// the repair has to leave every day of it alone.
sqlite
  .prepare('update node_schedules set start_date = ?, finish_date = ? where baseline_id = ? and node_id = ?')
  .run('2020-01-01', '2030-12-31', baselineId, victim.id);
coverChildren(PROJECT, baselineId);
const wide = boxAt(victim.id, baselineId)!;
check(
  'a package wider than its work keeps every day of it',
  wide.start === '2020-01-01' && wide.finish === '2030-12-31'
);

// ---------------------------------------------------------------- the grid

const weeksOf = (projectId: string) =>
  db
    .select()
    .from(schema.weeks)
    .where(eq(schema.weeks.projectId, projectId))
    .all()
    .sort((a, b) => a.weekNo - b.weekNo);

const project = db
  .select()
  .from(schema.projects)
  .where(eq(schema.projects.id, PROJECT))
  .all()[0];

const originalWeeks = weeksOf(PROJECT);
const progressBefore = sqlite.prepare('select count(*) c from leaf_progress').get() as { c: number };

// The grid as it stands answers to the dates it was built from.
check('the fixture has a grid to move', originalWeeks.length > 1, `${originalWeeks.length} weeks`);


// ------------------------------------------------------------- the anchor
//
// Every period label in the app and on all five printed sheets is drawn from
// one date, and `weekEndDate(anchor, n)` is `anchor + (n - 1) weeks` — so the
// anchor is WEEK ONE'S END. The SQLite side handed over the LAST week's
// instead, which put week 36 of a 72-week project in January 2028.
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const built = buildProjectDashboardData(PROJECT)!;
check(
  'the week anchor is week one, not week last',
  built.db.project.weekAnchorEndDate === originalWeeks[0].endDate,
  `${built.db.project.weekAnchorEndDate} vs ${originalWeeks[0].endDate}`
);

// Shift the project three days later, exactly the Samberah case in reverse.
const shifted = new Date(Date.parse(project.startDate! + 'T00:00:00Z') + 3 * 86_400_000)
  .toISOString()
  .slice(0, 10);
sqlite.prepare('update projects set start_date = ? where id = ?').run(shifted, PROJECT);
const moved = relayWeeks(PROJECT);

const after = weeksOf(PROJECT);
const wanted = weekRowsFor(PROJECT, shifted, project.finishDate!);
check('every week moved with the start date', moved.moved > 0, JSON.stringify(moved));
check('week 1 now starts the day the project does', after[0].startDate === shifted, after[0].startDate);
check(
  'the grid matches what a fresh project would be given',
  after.length === wanted.length && after.every((w, i) => w.startDate === wanted[i].startDate && w.endDate === wanted[i].endDate),
  `${after.length} weeks vs ${wanted.length}`
);
check(
  'week numbers are unchanged, so nothing was re-pointed',
  after.every((w, i) => w.weekNo === i + 1)
);

const progressAfter = sqlite.prepare('select count(*) c from leaf_progress').get() as { c: number };
check(
  'NOT ONE recorded figure was lost',
  progressAfter.c === progressBefore.c,
  `${progressBefore.c} rows before, ${progressAfter.c} after`
);

// Shortening the project must not cascade away a week somebody reported in.
sqlite
  .prepare('update projects set finish_date = ? where id = ?')
  .run(after[Math.floor(after.length / 2)].endDate, PROJECT);
const shortened = relayWeeks(PROJECT);
const afterShort = weeksOf(PROJECT);
const progressShort = sqlite.prepare('select count(*) c from leaf_progress').get() as { c: number };
check(
  'a reported week outlives the finish date being pulled in',
  progressShort.c === progressBefore.c,
  `${shortened.kept} kept, ${shortened.removed} empty weeks dropped`
);
check('and the weeks holding it are still there', afterShort.length > wanted.length / 2);

sqlite.close();
// Windows keeps the handle until the process lets go; a leftover temp file is
// not worth failing a passing run over.
try {
  fs.rmSync(fixture, { force: true });
} catch {}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
