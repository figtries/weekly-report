/**
 * Proves the deployment's schema repair works, on a throwaway copy.
 *
 * A deployment restores its schema from the blob snapshot, not from a
 * migration, so a snapshot written before a column existed silently un-adds
 * that column at every cold start. `ensureSchema` is what puts it back. This
 * script manufactures exactly that state: take the real database, DROP the
 * column, and check the repair restores it without touching the rows.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-ensure-schema.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';

import { ensureSchema } from '../lib/db-snapshot.ts';

const DIR = 'data/_tmp-ensure-schema';
const COPY = `${DIR}/report.db`;

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

// SERIALIZED, not file-copied, and the difference is the whole point of this
// script's fixture. `data/report.db` runs in WAL mode, so a plain
// `copyFileSync` takes the main file and leaves the -wal behind: the copy is
// the database as it was BEFORE the most recent migration, and the first
// assertion below then fails for a reason that has nothing to do with the
// code under test. `serialize()` returns the complete image including the WAL,
// which is also exactly what the snapshot push path uploads.
{
  const source = new Database('data/report.db', { readonly: true });
  writeFileSync(COPY, source.serialize());
  source.close();
}

const columns = (): string[] => {
  const db = new Database(COPY, { readonly: true });
  const names = (db.prepare('pragma table_info(projects)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  db.close();
  return names;
};
const projectCount = (): number => {
  const db = new Database(COPY, { readonly: true });
  const { n } = db.prepare('select count(*) as n from projects').get() as { n: number };
  db.close();
  return n;
};

let failed = 0;
const before = projectCount();

// An already-current file must be left completely alone, and must say so.
const noop = ensureSchema(COPY);
if (noop.length !== 0) {
  failed += 1;
  console.error(`✗ a current database should need no repair, got ${JSON.stringify(noop)}`);
}

// Now manufacture the deployment's state.
{
  const db = new Database(COPY);
  db.prepare('alter table projects drop column alias').run();
  db.close();
}
if (columns().includes('alias')) {
  failed += 1;
  console.error('✗ setup failed: the column was not actually dropped');
}

const added = ensureSchema(COPY);
if (!added.includes('projects.alias')) {
  failed += 1;
  console.error(`✗ expected projects.alias to be reported as added, got ${JSON.stringify(added)}`);
}
if (!columns().includes('alias')) {
  failed += 1;
  console.error('✗ the column is still missing after the repair');
}
if (projectCount() !== before) {
  failed += 1;
  console.error(`✗ the repair changed the row count: ${before} → ${projectCount()}`);
}

// And it must be safe to run twice, because it runs on every cold start and
// on every mid-life snapshot refresh.
if (ensureSchema(COPY).length !== 0) {
  failed += 1;
  console.error('✗ the repair is not idempotent');
}

rmSync(DIR, { recursive: true, force: true });

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(
  '✓ a snapshot missing the column gets it back, rows intact, and running twice is a no-op.'
);
