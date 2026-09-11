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
 *
 * That constraint is also why a deployment keeps this driver and gets its
 * durability from `lib/db-snapshot.ts` instead — the whole file is pushed to a
 * blob store after a write and pulled back before a stale read. Two things
 * here serve that: the connection is reachable only through a proxy, so a
 * pulled snapshot can CLOSE and REOPEN the database underneath callers that
 * imported `db` at module load; and every mutating statement is wrapped so a
 * push is scheduled without each of the fifty-odd server actions having to
 * remember. Both are inert when no store is attached — `db` is then the
 * drizzle instance itself, exactly as before.
 */
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

import { DB_PATH } from './db-path';
import {
  registerConnection,
  scheduleSnapshotPush,
  snapshotConfigured,
  writeDbFile,
} from './db-snapshot';
import * as schema from './schema';

type Conn = Database.Database;

/**
 * Statements that change the file, decided from the SQL text rather than from
 * which method runs it: drizzle executes `insert … returning` through `.all()`
 * and `.get()` as readily as through `.run()`, so watching `.run()` alone would
 * miss exactly the writes that hand an id back to the page.
 */
const MUTATES = /^\s*(insert|update|delete|replace|create|drop|alter|vacuum|commit|release)/i;

/** Off until the module has finished opening: `pragma` writes are not edits. */
let armed = false;

function instrument(conn: Conn): Conn {
  if (!snapshotConfigured) return conn;

  const prepare = conn.prepare.bind(conn);
  conn.prepare = ((sql: string) => {
    const stmt = prepare(sql);
    if (!MUTATES.test(sql)) return stmt;
    const methods = stmt as unknown as Record<string, unknown>;
    for (const name of ['run', 'get', 'all', 'iterate']) {
      const original = methods[name];
      if (typeof original !== 'function') continue;
      const bound = (original as (...a: unknown[]) => unknown).bind(stmt);
      methods[name] = (...args: unknown[]) => {
        if (armed) scheduleSnapshotPush();
        return bound(...args);
      };
    }
    return stmt;
  }) as Conn['prepare'];

  const exec = conn.exec.bind(conn);
  conn.exec = ((sql: string) => {
    if (armed && MUTATES.test(sql)) scheduleSnapshotPush();
    return exec(sql);
  }) as Conn['exec'];

  return conn;
}

function open(): Conn {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new Database(DB_PATH);
  // WAL lets the field crew's writes land while a report is being read.
  conn.pragma('journal_mode = WAL');
  // Off by default in SQLite, and without it every `references()` above is decoration.
  conn.pragma('foreign_keys = ON');
  return instrument(conn);
}

// Next's dev server re-evaluates modules on every edit; without the global the
// file would be opened again on each one until SQLite runs out of handles.
const globalForDb = globalThis as unknown as { __reportSqlite?: Conn };

let live: Conn = globalForDb.__reportSqlite ?? open();
let orm = drizzle(live, { schema });
if (process.env.NODE_ENV !== 'production') globalForDb.__reportSqlite = live;

/**
 * Adopt a snapshot pulled from the blob store.
 *
 * The connection has to close first: SQLite caches pages, so rewriting the file
 * underneath an open handle is corruption rather than a refresh.
 */
function replace(bytes: Buffer): void {
  try {
    live.close();
  } catch {
    // Already closed, or closing on a connection mid-statement — either way the
    // bytes below are what the next query must see.
  }
  writeDbFile(bytes);
  live = open();
  orm = drizzle(live, { schema });
  if (process.env.NODE_ENV !== 'production') globalForDb.__reportSqlite = live;
}

registerConnection({ serialize: () => live.serialize(), replace });
armed = true;

/**
 * One indirection, so `import { db }` keeps working after a swap. Only built
 * when a store is attached; otherwise the real objects are exported, and
 * nothing about local behaviour changes at all.
 */
function forward<T extends object>(current: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const source = current() as unknown as Record<string | symbol, unknown>;
      const value = source[prop];
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(source)
        : value;
    },
    has(_target, prop) {
      return prop in (current() as object);
    },
  });
}

type Orm = BetterSQLite3Database<typeof schema> & { $client: Conn };

export const db: Orm = snapshotConfigured ? forward(() => orm as Orm) : (orm as Orm);
export const sqlite: Conn = snapshotConfigured ? forward(() => live) : live;

export { schema, DB_PATH };
export { beforeWrite, ensureFreshDb, flushDbSnapshot, refreshDbSnapshot } from './db-snapshot';
