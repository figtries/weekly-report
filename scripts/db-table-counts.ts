/**
 * Row counts for every table, so a migration can be proved not to have eaten
 * anything.
 *
 * A drizzle migration that recreates a table DROPs the old one, and
 * `PRAGMA foreign_keys=OFF` is a no-op inside the transaction drizzle wraps
 * migrations in, so the DROP cascades. In August 2026 that silently took all
 * 357 `doc_stages` rows when `documents` gained a column. The defence is
 * arithmetic: count before, count after, compare.
 *
 * Run: node scripts/db-table-counts.ts [path-to-db]
 */
import Database from 'better-sqlite3';

const path = process.argv[2] ?? 'data/report.db';
const db = new Database(path, { readonly: true });

const tables = db
  .prepare(
    `select name from sqlite_master
      where type = 'table'
        and name not like 'sqlite_%'
        and name not like '__drizzle%'
      order by name`
  )
  .all() as Array<{ name: string }>;

for (const { name } of tables) {
  const { n } = db.prepare(`select count(*) as n from "${name}"`).get() as { n: number };
  console.log(`${name}=${n}`);
}
db.close();
