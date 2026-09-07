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
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import * as schema from './schema';

const WORKING_DB = path.join(process.cwd(), 'data', 'report.db');
/**
 * The committed snapshot. `data/report.db` is gitignored on purpose — it is a
 * machine's own working copy — so a deployment clones the repo with no database
 * at all, and `new Database()` cheerfully creates an EMPTY file instead of
 * failing. The first query is what dies, with "no such table: app_state", which
 * is exactly how this branch's first Vercel build fell over during page
 * collection.
 */
const SEED_DB = path.join(process.cwd(), 'data', 'seed.db');

/**
 * Where this process should open its database.
 *
 * An explicit REPORT_DB_PATH always wins. Otherwise the working copy is used
 * whenever it exists, which is every developer machine — nothing about local
 * behaviour changes. Only when it is missing AND a seed is present do we fall
 * back, and then the seed is COPIED somewhere writable first: a lambda's own
 * bundle is read-only, and SQLite cannot open a WAL database even for reading
 * without writing its `-shm`/`-wal` siblings beside it.
 *
 * That copy lives in the OS temp dir, which on Vercel is per-instance and
 * ephemeral — the same place this app already puts uploaded photos when the
 * filesystem isn't the store (see `next.config.ts`). So a deployment READS the
 * seed correctly, and a write survives only as long as the instance that served
 * it. This is a demo path, not a production database; giving the deployed app
 * durable storage is its own piece of work.
 */
function resolveDbPath(): string {
  if (process.env.REPORT_DB_PATH) return process.env.REPORT_DB_PATH;
  if (fs.existsSync(WORKING_DB)) return WORKING_DB;
  if (!fs.existsSync(SEED_DB)) return WORKING_DB;

  const runtimeCopy = path.join(os.tmpdir(), 'weekly-report', 'report.db');
  fs.mkdirSync(path.dirname(runtimeCopy), { recursive: true });
  // First touch only: a warm lambda keeps what it has already written, and
  // re-copying would silently discard it mid-session.
  if (!fs.existsSync(runtimeCopy)) fs.copyFileSync(SEED_DB, runtimeCopy);
  return runtimeCopy;
}

const DB_PATH = resolveDbPath();

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
