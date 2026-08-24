/**
 * The connection.
 *
 * better-sqlite3 is deliberately synchronous. Next's Cache Components model
 * treats a synchronous embedded-database query as a deterministic operation, so
 * it completes during prerendering and lands in the static shell — no
 * `use cache`, no `<Suspense>`, no "Uncached data was accessed outside of
 * `<Suspense>`" build failure. An async driver would have forced a Suspense
 * boundary around every read in the app, which is the wall this repo has
 * already hit twice. Where a read genuinely must be per-request, call
 * `connection()` before it.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

import * as schema from './schema';

const DB_PATH = process.env.REPORT_DB_PATH || path.join(process.cwd(), 'data', 'report.db');

function open() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  // WAL lets the field crew's writes land while a report is being read.
  sqlite.pragma('journal_mode = WAL');
  // Off by default in SQLite, and without it every `references()` above is decoration.
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

// Next's dev server re-evaluates modules on every edit; without the global the
// file would be opened again on each one until SQLite runs out of handles.
const globalForDb = globalThis as unknown as { __reportSqlite?: Database.Database };
const sqlite = globalForDb.__reportSqlite ?? open();
if (process.env.NODE_ENV !== 'production') globalForDb.__reportSqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { schema, sqlite, DB_PATH };
