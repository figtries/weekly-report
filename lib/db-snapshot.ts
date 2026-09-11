/**
 * Durable storage for the deployed app.
 *
 * On Vercel there is no disk. `lib/db-path.ts` falls back to a copy of
 * `data/seed.db` in the lambda's own `/tmp`, and that copy is per-INSTANCE and
 * per-FUNCTION: `createProject` writes it inside the function serving
 * `/projects`, then the redirect to `/projects/[id]` is served by a different
 * function whose `/tmp` still holds the untouched seed, so `getProject()`
 * returns nothing and the page 404s. Reported 11 Sep 2026 as "bikin project
 * jadi 0"; the deployed list was byte-for-byte the committed seed.
 *
 * The fix keeps the database exactly as it is — one synchronous better-sqlite3
 * file, which is what lets every read prerender under `cacheComponents` (see
 * `lib/sqlite.ts`) — and gives that file ONE durable home outside the lambda:
 * a Vercel Blob object holding the whole ~2 MB image.
 *
 *   cold start  →  download the blob over the file, before the first query
 *   any write   →  serialize the database and upload it, inside `after()`
 *   any read    →  a conditional GET (ETag), at most once every 1.5 s
 *
 * Three properties this relies on. `sqlite.serialize()` returns the complete
 * image including anything still in the WAL, so a snapshot is never half a
 * transaction. `after()` is backed by `waitUntil` on Vercel, so the instance
 * stays alive until the upload finishes rather than freezing mid-PUT. And the
 * conditional GET costs a 304 when nothing changed, which is the common case.
 *
 * It is a single-writer design: two people editing different projects in the
 * same second can have one snapshot land on top of the other. That is the
 * honest shape of a file-level snapshot, and it is the trade for not rewriting
 * forty synchronous call sites onto an async driver.
 *
 * With no blob store attached this module does nothing at all, and the app
 * behaves exactly as it did before — ephemeral, but working.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { DB_PATH, DB_IS_EPHEMERAL } from './db-path';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BUILD = process.env.NEXT_PHASE === 'phase-production-build';

/**
 * Only where the database is already throwaway. A developer machine keeps its
 * own `data/report.db` and must never have a deployment's data pulled over it,
 * even with a token in the environment — `REPORT_DB_SNAPSHOT=1` is the
 * deliberate opt-in for testing this path locally.
 */
export const snapshotConfigured =
  Boolean(TOKEN) && (DB_IS_EPHEMERAL || process.env.REPORT_DB_SNAPSHOT === '1');

/**
 * Derived from the token rather than fixed, so the object's path cannot be
 * guessed from the store URL alone. Private access is asked for first and
 * public is the fallback (see `attempt`), because a store created before
 * private blobs existed only answers to the latter.
 */
const PATHNAME = TOKEN
  ? `report-db/${createHash('sha256').update(TOKEN).digest('hex').slice(0, 24)}/report.db`
  : '';

/** How long a downloaded image is trusted before the next conditional GET. */
const FRESH_MS = 1500;

type Connection = {
  /** The complete database image, WAL included. */
  serialize(): Buffer;
  /** Close, swap the bytes on disk, reopen. */
  replace(bytes: Buffer): void;
};

let connection: Connection | null = null;
let etag: string | null = null;
let access: 'private' | 'public' = 'private';
let checkedAt = 0;
let dirty = false;
let scheduled = false;
let queue: Promise<void> = Promise.resolve();

/** Resolved once at boot so a write never waits on a module load. */
let afterFn: ((cb: () => unknown) => void) | null = null;
if (snapshotConfigured) {
  void import('next/server')
    .then((m) => {
      afterFn = m.after;
    })
    .catch(() => {});
}

/** `lib/sqlite.ts` hands its connection over as soon as it has one. */
export function registerConnection(conn: Connection): void {
  connection = conn;
}

function writeDbFile(bytes: Buffer): void {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const incoming = `${DB_PATH}.incoming`;
  fs.writeFileSync(incoming, bytes);
  // A WAL left over from the bytes being replaced belongs to a different
  // database. Replaying it against these pages is corruption, not recovery.
  fs.rmSync(`${DB_PATH}-wal`, { force: true });
  fs.rmSync(`${DB_PATH}-shm`, { force: true });
  fs.renameSync(incoming, DB_PATH);
}

export { writeDbFile };

async function attempt<T>(run: (mode: 'private' | 'public') => Promise<T>): Promise<T> {
  try {
    return await run(access);
  } catch (err) {
    const other = access === 'private' ? 'public' : 'private';
    let result: T;
    try {
      result = await run(other);
    } catch {
      // The fallback failed too — the first error is the one worth reading.
      throw err;
    }
    access = other;
    return result;
  }
}

/** The remote image, or null when it is missing or unchanged. */
async function download(conditional: boolean): Promise<Buffer | null> {
  const { get, BlobNotFoundError } = await import('@vercel/blob');
  try {
    const res = await attempt((mode) =>
      get(PATHNAME, {
        access: mode,
        token: TOKEN,
        // The CDN copy can be seconds behind, and seconds is exactly the
        // window this whole module exists to close.
        useCache: false,
        ...(conditional && etag ? { ifNoneMatch: etag } : {}),
      })
    );
    // null is a blob that is not there yet (the first deploy, before anything
    // has been written); 304 is one this instance already holds.
    if (!res || res.statusCode === 304) return null;
    const bytes = Buffer.from(await new Response(res.stream).arrayBuffer());
    etag = res.blob.etag;
    return bytes;
  } catch (err) {
    if (err instanceof BlobNotFoundError) return null;
    throw err;
  }
}

async function upload(bytes: Buffer): Promise<string> {
  const { put } = await import('@vercel/blob');
  const res = await attempt((mode) =>
    put(PATHNAME, bytes, {
      access: mode,
      token: TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/octet-stream',
      cacheControlMaxAge: 0,
    })
  );
  return res.etag;
}

/**
 * Push, if anything was written. Serialized through one queue so two writes in
 * the same request upload once, and re-marked dirty on failure so the next
 * write retries instead of silently dropping the change.
 */
export function flushDbSnapshot(): Promise<void> {
  if (!snapshotConfigured || BUILD) return Promise.resolve();
  queue = queue
    .then(async () => {
      if (!dirty || !connection) return;
      dirty = false;
      const bytes = connection.serialize();
      try {
        etag = await upload(bytes);
      } catch (err) {
        dirty = true;
        throw err;
      }
    })
    .catch((err) => {
      console.error('[db-snapshot] upload failed', err);
    });
  return queue;
}

/** Called from the write path in `lib/sqlite.ts`, once per statement. */
export function scheduleSnapshotPush(): void {
  if (!snapshotConfigured || BUILD) return;
  dirty = true;
  if (scheduled) return;
  scheduled = true;
  const flush = () => {
    scheduled = false;
    return flushDbSnapshot();
  };
  try {
    if (!afterFn) throw new Error('no request scope');
    afterFn(flush);
  } catch {
    // Outside a request (a script, a background job): best effort.
    scheduled = false;
    setTimeout(() => void flushDbSnapshot(), 25).unref?.();
  }
}

/**
 * Adopt a downloaded image as the database this process serves. Before the
 * connection exists (cold start, from instrumentation) that is a plain file
 * write; after it, the connection has to be closed around the swap.
 */
export function adoptDbBytes(bytes: Buffer): void {
  if (connection) connection.replace(bytes);
  else writeDbFile(bytes);
}

async function applyRemote(conditional: boolean): Promise<boolean> {
  // Never pull over writes this instance has not pushed yet.
  if (dirty) await flushDbSnapshot();
  const bytes = await download(conditional);
  if (!bytes) return false;
  adoptDbBytes(bytes);
  return true;
}
/**
 * Called before a read that must see writes made by another instance. Cheap by
 * design: a 304 at most every 1.5 s, and nothing at all when no store is
 * attached.
 */
export async function ensureFreshDb(): Promise<boolean> {
  if (!snapshotConfigured) return false;
  const now = Date.now();
  if (now - checkedAt < FRESH_MS) return false;
  checkedAt = now;
  try {
    return await applyRemote(true);
  } catch (err) {
    // A reachable-but-failing store must not take the app down; the instance
    // keeps serving what it has.
    console.error('[db-snapshot] refresh failed', err);
    return false;
  }
}

/**
 * The unconditional version, for the one case where staleness is already
 * proven: a row the URL names and this instance cannot find.
 */
export async function refreshDbSnapshot(): Promise<boolean> {
  if (!snapshotConfigured) return false;
  checkedAt = Date.now();
  try {
    return await applyRemote(false);
  } catch (err) {
    console.error('[db-snapshot] forced refresh failed', err);
    return false;
  }
}

/**
 * Cold start, from `instrumentation.ts` — before any route module imports
 * `lib/sqlite.ts` and opens the file.
 */
export async function restoreDbSnapshot(): Promise<void> {
  if (!snapshotConfigured) return;
  try {
    await applyRemote(false);
  } catch (err) {
    console.error('[db-snapshot] restore failed', err);
  }
}
