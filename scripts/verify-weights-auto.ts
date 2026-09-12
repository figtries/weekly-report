/**
 * Proves the line between "weight follows price" and "weight is authoritative".
 *
 * Runs against a COPY of the working database so it can write, and exercises
 * the real path: set a price, call `syncDerivedWeights`, read the stored
 * weights back. Three things must hold, and the third is the one that protects
 * the imported data.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-weights-auto.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const src = path.join(process.cwd(), 'data', 'report.db');
const work = path.join(os.tmpdir(), `weights-auto-${Date.now()}.db`);
// NOT `fs.copyFileSync`: report.db is in WAL mode and a plain file copy leaves
// recent writes behind in the -wal. It did exactly that when `projects` gained
// `alias`, and this script died with `no such column: "alias"` — a failure that
// looks like a bug in weights-auto and is not. See scripts/db-fixture.ts.
copyDbFixture(src, work);
process.env.REPORT_DB_PATH = work;

const { db, schema } = await import('../lib/sqlite.ts');
const { syncDerivedWeights } = await import('../lib/weights-auto.ts');
const { eq } = await import('drizzle-orm');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

const projects = db.select().from(schema.projects).all();
const unlocked = projects.find((p) => p.weightBasis !== 'boq' && !p.legacyJsonId);
const locked = projects.find((p) => p.weightBasis === 'boq');
if (!unlocked || !locked) throw new Error('This database has no unlocked and locked project to compare');

const leaves = db
  .select()
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.projectId, unlocked.id))
  .all()
  .filter((n) => n.isLeaf);

check(
  'the app-made project starts with no weights at all',
  leaves.every((l) => l.bobot == null),
  `${leaves.length} leaves, ${leaves.filter((l) => l.bobot != null).length} weighted`
);

// A price on the FIRST leaf AND NOTHING ELSE PRICED — cleared explicitly,
// because a leftover price anywhere in the tree changes what the remainder is
// and this test is about the remainder. Everything unpriced must still come out
// with a weight, or it is invisible to every report.
db.update(schema.wbsNodes)
  .set({ price: null })
  .where(eq(schema.wbsNodes.projectId, unlocked.id))
  .run();
db.update(schema.wbsNodes).set({ price: 1000 }).where(eq(schema.wbsNodes.id, leaves[0].id)).run();
db.update(schema.projects).set({ contractValue: 4000 }).where(eq(schema.projects.id, unlocked.id)).run();
const moved = syncDerivedWeights(unlocked.id);

const after = db
  .select()
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.projectId, unlocked.id))
  .all()
  .filter((n) => n.isLeaf);
const total = after.reduce((s, n) => s + (n.bobot ?? 0), 0);

check(
  'typing one price gives every leaf a weight',
  moved >= leaves.length && after.every((l) => l.bobot != null && l.bobot > 0),
  `${moved} rows moved, ${after.length} leaves and none left null`
);

// A branch's figure is its children added up. One left holding a weight of its
// own — set while it was still a leaf, kept when something was indented under
// it — is counted twice by every report that reads it.
const branches = db
  .select()
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.projectId, unlocked.id))
  .all()
  .filter((n) => !n.isLeaf);
check(
  'a row that stopped being a leaf stops carrying a weight',
  branches.every((b) => b.bobot == null),
  `${branches.length} branches, ${branches.filter((b) => b.bobot != null).length} still weighted`
);
check(
  'and the plan closes at 100',
  Math.abs(total - 100) < 1e-6,
  `total ${total.toFixed(6)} across ${after.length} leaves`
);
check(
  'the priced leaf gets what its price is worth against the contract',
  Math.abs((after.find((l) => l.id === leaves[0].id)?.bobot ?? 0) - 25) < 1e-6,
  `1,000 of a 4,000 contract = ${(after.find((l) => l.id === leaves[0].id)?.bobot ?? 0).toFixed(2)}%`
);

// The whole point of the lock: an imported project is never touched.
const before = db
  .select()
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.projectId, locked.id))
  .all()
  .filter((n) => n.isLeaf)
  .reduce((s, n) => s + (n.bobot ?? 0), 0);
const lockedMoved = syncDerivedWeights(locked.id);
const afterLocked = db
  .select()
  .from(schema.wbsNodes)
  .where(eq(schema.wbsNodes.projectId, locked.id))
  .all()
  .filter((n) => n.isLeaf)
  .reduce((s, n) => s + (n.bobot ?? 0), 0);

check(
  'an imported project is refused, not recomputed',
  lockedMoved === 0 && Math.abs(before - afterLocked) < 1e-9,
  `${locked.name.slice(0, 28)}… still totals ${afterLocked.toFixed(6)}`
);

// The copy is left behind: the connection is still open and Windows will not
// unlink a file SQLite holds. It is in the OS temp dir, which is the right
// place for something nobody has to clean up.

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
