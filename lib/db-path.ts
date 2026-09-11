/**
 * Where the database file lives — resolved once, with no side effects beyond
 * the seed copy described below.
 *
 * Split out of `lib/sqlite.ts` because the snapshot layer (`lib/db-snapshot.ts`)
 * and `instrumentation.ts` both need this path BEFORE a connection exists: a
 * deployment downloads the durable snapshot over this file at cold start, and
 * opening the database first would mean opening the wrong bytes.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

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

const RUNTIME_COPY = path.join(os.tmpdir(), 'weekly-report', 'report.db');

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
 * ephemeral. On its own that loses every write — see `lib/db-snapshot.ts`,
 * which is what makes this path durable when a blob store is attached.
 */
function resolveDbPath(): string {
  if (process.env.REPORT_DB_PATH) return process.env.REPORT_DB_PATH;
  if (fs.existsSync(WORKING_DB)) return WORKING_DB;
  if (!fs.existsSync(SEED_DB)) return WORKING_DB;

  fs.mkdirSync(path.dirname(RUNTIME_COPY), { recursive: true });
  // First touch only: a warm lambda keeps what it has already written, and
  // re-copying would silently discard it mid-session.
  if (!fs.existsSync(RUNTIME_COPY)) fs.copyFileSync(SEED_DB, RUNTIME_COPY);
  return RUNTIME_COPY;
}

export const DB_PATH = resolveDbPath();

/**
 * True when the file this process writes to dies with the process — a Vercel
 * lambda's own `/tmp`, seeded from `data/seed.db`. It is the one condition
 * under which the snapshot layer may take over the file, which is why a
 * developer machine (where `data/report.db` exists) is never touched by it.
 */
export const DB_IS_EPHEMERAL = DB_PATH === RUNTIME_COPY;
