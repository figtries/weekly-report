/**
 * The weekly write path, for a project that lives in SQLite.
 *
 * Runs against a COPY of the working database. What it is guarding is the one
 * rule this app has never been allowed to break: changing how something is
 * MEASURED must not change how much of it is DONE — the August 2026 bug that
 * rewrote a leaf sitting at 100% down to zero and dropped the project total.
 * Plus the two things the JSON store could not do at all: evidence carried
 * forward through a silent week, and a derived plan that a typed percentage
 * cannot overwrite.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-progress-sqlite.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const src = path.join(process.cwd(), 'data', 'report.db');
const work = path.join(os.tmpdir(), `progress-sqlite-${Date.now()}.db`);
// NOT `fs.copyFileSync`: report.db is in WAL mode and a plain file copy leaves
// recent writes behind in the -wal. See scripts/db-fixture.ts.
copyDbFixture(src, work);
process.env.REPORT_DB_PATH = work;

const { db, schema } = await import('../lib/sqlite.ts');
const { eq } = await import('drizzle-orm');
const { syncDerivedWeights } = await import('../lib/weights-auto.ts');
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const {
  markNoProgressSqlite,
  saveFieldProgressSqlite,
  saveWeekUpdatesSqlite,
  setProgressMethodSqlite,
  setWorkKindSqlite,
} = await import('../lib/progress-sqlite.ts');
const { BUILT_IN_KINDS } = await import('../lib/work-kind.ts');
const { ladderFor } = await import('../lib/work-kind-apply.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

const project = db
  .select()
  .from(schema.projects)
  .all()
  .find((p) => !p.legacyJsonId && p.weightBasis !== 'boq');
if (!project) throw new Error('This database has no app-made project to test with');

// Give it weights, so the rollup has something to add up.
syncDerivedWeights(project.id);

const leaves = db
  .select()
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.projectId, project.id))
  .all()
  .filter((n) => n.isLeaf);
const weeks = db
  .select()
  .from(schema.weeks)
  .where(eq(schema.weeks.projectId, project.id))
  .all()
  .sort((a, b) => a.weekNo - b.weekNo);
if (leaves.length === 0 || weeks.length < 2) throw new Error('Need a project with leaves and 2+ weeks');

const leaf = leaves[0];
const w1 = weeks[0].weekNo;
const w2 = weeks[1].weekNo;

const pctAt = (weekNo: number, nodeId: string) =>
  buildProjectDashboardData(project.id)?.db.weeks.find((w) => w.week === weekNo)?.leafData[nodeId];

/* ------------------------------------------------------------ a quantity */

setProgressMethodSqlite(leaf.id, 'qty', { vol: 200, satuan: 'm' });
saveFieldProgressSqlite(project.id, w1, [{ leafId: leaf.id, qtyDone: 50 }]);

check(
  'a quantity becomes a percentage, and the quantity is kept',
  Math.abs((pctAt(w1, leaf.id)?.cumProgressPct ?? 0) - 25) < 1e-9 &&
    pctAt(w1, leaf.id)?.qtyDone === 50,
  `50 of 200 m = ${(pctAt(w1, leaf.id)?.cumProgressPct ?? 0).toFixed(2)}%`
);

check(
  'a week nobody filled in holds the figure, and the evidence with it',
  Math.abs((pctAt(w2, leaf.id)?.cumProgressPct ?? 0) - 25) < 1e-9 &&
    pctAt(w2, leaf.id)?.qtyDone === 50,
  `week ${w2} still reads ${(pctAt(w2, leaf.id)?.cumProgressPct ?? 0).toFixed(2)}% on ${pctAt(w2, leaf.id)?.qtyDone} m`
);

// Over the total is not a percentage over 100, it is a typo.
saveFieldProgressSqlite(project.id, w1, [{ leafId: leaf.id, qtyDone: 9999 }]);
check(
  'a quantity past the total is clamped to the total',
  Math.abs((pctAt(w1, leaf.id)?.cumProgressPct ?? 0) - 100) < 1e-9 &&
    pctAt(w1, leaf.id)?.qtyDone === 200,
  `9,999 m against a 200 m item reads ${pctAt(w1, leaf.id)?.qtyDone} m`
);
saveFieldProgressSqlite(project.id, w1, [{ leafId: leaf.id, qtyDone: 50 }]);

/* ------------------------------------- "checked it, nothing moved" */

markNoProgressSqlite(project.id, w2, [leaf.id]);
const row2 = db
  .select()
  .from(schema.leafProgress)
  .where(eq(schema.leafProgress.weekId, weeks[1].id))
  .all()
  .find((r) => r.nodeId === leaf.id);
check(
  'a quiet week is recorded as the figure it is standing on',
  !!row2 && Math.abs((row2.cumProgressPct ?? 0) - 25) < 1e-9,
  `week ${w2} now carries a row at ${(row2?.cumProgressPct ?? 0).toFixed(2)}%`
);

/* ---------------------------------- the plan is derived, not typed over */

const planBefore = pctAt(w1, leaf.id)?.targetWF ?? 0;
saveWeekUpdatesSqlite(project.id, w1, [leaf.id].reduce((acc, id) => ({ ...acc, [id]: { targetWF: 999 } }), {}));
check(
  'a typed target does not move the plan curve',
  Math.abs((pctAt(w1, leaf.id)?.targetWF ?? 0) - planBefore) < 1e-9,
  `still ${planBefore.toFixed(6)} — the curve comes from the dates`
);

/* ------------------- changing the method must not change the figure */

const before = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
setProgressMethodSqlite(leaf.id, 'lumpsum');
const afterLump = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
check(
  'switching to lumpsum carries the figure across',
  Math.abs(before - afterLump) < 1e-9,
  `${before.toFixed(2)}% before, ${afterLump.toFixed(2)}% after`
);
check(
  "and the other method's evidence is gone",
  pctAt(w1, leaf.id)?.qtyDone === undefined,
  'no quantity left behind a lumpsum item'
);

setProgressMethodSqlite(leaf.id, 'milestone');
const afterMs = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
check(
  'switching to milestones never awards more than was reported',
  afterMs <= before + 1e-9,
  `${before.toFixed(2)}% became ${afterMs.toFixed(2)}% across ${(pctAt(w1, leaf.id)?.milestonesDone ?? []).length} milestones reached`
);

setProgressMethodSqlite(leaf.id, 'qty', { vol: 200, satuan: 'm' });
const backToQty = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
check(
  'and back to a quantity, still without inventing work',
  Math.abs(backToQty - afterMs) < 1e-9 && pctAt(w1, leaf.id)?.qtyDone != null,
  `${backToQty.toFixed(2)}% on ${pctAt(w1, leaf.id)?.qtyDone} m`
);

/* ------------------------------------- a work kind must not move the figure */

// Seeded fresh, right here — not inherited from whatever an earlier case left
// this leaf at. A leaf sitting at 0% before AND after would pass this check
// whether setWorkKindSqlite carries the figure or silently zeroes it, which is
// exactly the August 2026 bug this case exists to catch. 137 of 200 m is a
// genuine, non-round, non-zero percentage that depends on nothing upstream.
setProgressMethodSqlite(leaf.id, 'qty', { vol: 200, satuan: 'm' });
saveFieldProgressSqlite(project.id, w1, [{ leafId: leaf.id, qtyDone: 137 }]);
const kindBefore = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;

// 'quote' is lumpsum with an empty ladder (see lib/work-kind-apply.ts), so this
// is the one shape a restatement is required to leave EXACTLY alone — a
// 'steps' ladder is allowed to restate a between-rungs figure down to the
// nearest rung, which is correct behaviour, not the bug under test here.
const ladder = ladderFor('procurement', 'quote', leaf.deskripsi, BUILT_IN_KINDS);
setWorkKindSqlite(leaf.id, 'procurement', 'lumpsum', ladder);
const kindAfter = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
const nodeRow = db
  .select({ workKind: schema.wbsNodes.workKind })
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.id, leaf.id))
  .all()[0];

check(
  'the work kind round-trips',
  nodeRow?.workKind === 'procurement',
  `read back as ${nodeRow?.workKind}`
);
check(
  'asking what kind of work a row is does not change how much of it is done',
  kindBefore > 0 && Math.abs(kindBefore - kindAfter) < 1e-9,
  `${kindBefore.toFixed(2)}% before, ${kindAfter.toFixed(2)}% after`
);

/* --------------------- a hand-typed override, through the real writers,
   and its un-freezing when the row is measured a different way again */

// Seeded fresh here too, for the same reason as the work-kind case above:
// the starting point must be the LADDER's own figure, not whatever an
// earlier case left this leaf reporting.
const overrideLadder = ladderFor('construction', 'steps', leaf.deskripsi, BUILT_IN_KINDS);
setWorkKindSqlite(leaf.id, 'construction', 'milestone', overrideLadder);
const rungRows = db
  .select()
  .from(schema.milestones)
  .where(eq(schema.milestones.nodeId, leaf.id))
  .all();
const rungId = (label: string) => rungRows.find((r) => r.id.endsWith(`:${label}`))!.id;
const materialId = rungId('material');
const installId = rungId('install');
const connectId = rungId('connect');

// 1. A real figure through the normal save path: material (15) + install
//    (50) = 65, the ladder's own number.
saveFieldProgressSqlite(project.id, w1, [
  { leafId: leaf.id, milestonesDone: [materialId, installId], source: 'steps' },
]);
const ladderPct = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
check(
  'the starting point is the ladder\'s own figure',
  Math.abs(ladderPct - 65) < 1e-9,
  `${ladderPct.toFixed(2)}%`
);

// 2. The escape hatch's own path: saveWeekUpdatesSqlite with source: 'manual',
//    clearly different from the ladder's 65.
saveWeekUpdatesSqlite(project.id, w1, { [leaf.id]: { cumProgressPct: 40, source: 'manual' } });
const overriddenPct = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
check(
  'a hand-typed override through the real writer reports the typed figure',
  Math.abs(overriddenPct - 40) < 1e-9,
  `reads ${overriddenPct.toFixed(2)}%, not the ladder's ${ladderPct.toFixed(2)}%`
);

// 3. THE UN-FREEZING. A rung tick through the normal milestone path —
//    material + install + connect (15+50+25=90) — must return the row to the
//    LADDER's figure, not leave it pinned to the stale typed 40.
saveFieldProgressSqlite(project.id, w1, [
  { leafId: leaf.id, milestonesDone: [materialId, installId, connectId], source: 'steps' },
]);
const unfrozenPct = pctAt(w1, leaf.id)?.cumProgressPct ?? 0;
check(
  'ticking a rung afterwards un-freezes the figure back to the ladder',
  Math.abs(unfrozenPct - 90) < 1e-9,
  `reads ${unfrozenPct.toFixed(2)}%, not the stale typed 40%`
);

/* ------------------------------------------- and the project can be read */

const data = buildProjectDashboardData(project.id);
check(
  'the project now reports a current week',
  (data?.currentWeek ?? 0) >= w1,
  `week ${data?.currentWeek} is the last one anybody filed`
);

// The copy is left behind: the connection is still open and Windows will not
// unlink a file SQLite holds. It is in the OS temp dir.

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
