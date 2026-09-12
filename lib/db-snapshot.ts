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

/**
 * How this process proves it may use the store — and there are now two ways.
 *
 * `BLOB_READ_WRITE_TOKEN` is no longer what Vercel hands a project. Connecting
 * a store today sets `BLOB_STORE_ID` (plus a webhook key) and nothing else:
 * `resolveBlobAuth` in @vercel/blob 2.8 tries an explicit token, THEN the
 * deployment's own OIDC identity paired with that store id, and only then the
 * read-write token. Gating this module on the token alone therefore left it
 * inert against a store that was attached, private, healthy and connected —
 * so the app went on discarding every write, and creating the store changed
 * nothing at all (12 Sep 2026, after two redeploys chasing a variable that was
 * never going to appear).
 *
 * A read-write token still wins when one exists, which is how local testing
 * and any older deployment keep working. `blobAuth()` is what every call
 * spreads: an explicit token, or nothing at all so the library reaches for the
 * OIDC identity itself.
 */
function resolveTokenName(): string | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return 'BLOB_READ_WRITE_TOKEN';
  // A project with a second store is offered a variable PREFIX, so the same
  // token can arrive as e.g. REPORT_BLOB_READ_WRITE_TOKEN.
  for (const name of Object.keys(process.env).sort()) {
    if (/_BLOB_READ_WRITE_TOKEN$/.test(name) && process.env[name]) return name;
  }
  return null;
}

/** Which variable a token came from — a name, never a value. For diagnostics. */
export const blobTokenName = resolveTokenName();

const TOKEN = blobTokenName ? process.env[blobTokenName] : undefined;

/**
 * The store's identity, and the one thing stable enough to name the object by.
 *
 * Read from `BLOB_STORE_ID` when the platform sets it, and otherwise parsed
 * out of the read-write token, whose format is
 * `vercel_blob_rw_<storeId>_<random>`. Deriving the path from the store rather
 * than from the credential is what keeps it pointing at the same object when a
 * token is rotated, or when a deployment that had a token starts authenticating
 * by OIDC instead.
 */
const STORE_ID = (() => {
  const raw = process.env.BLOB_STORE_ID ?? TOKEN?.match(/^vercel_blob_rw_([^_]+)_/)?.[1] ?? '';
  const trimmed = raw.trim();
  return trimmed.startsWith('store_') ? trimmed.slice('store_'.length) : trimmed;
})();

/** What every @vercel/blob call spreads. Empty means "use the OIDC identity". */
function blobAuth(): { token?: string } {
  return TOKEN ? { token: TOKEN } : {};
}

export { STORE_ID as blobStoreId };

const BUILD = process.env.NEXT_PHASE === 'phase-production-build';

/**
 * Only where the database is already throwaway. A developer machine keeps its
 * own `data/report.db` and must never have a deployment's data pulled over it,
 * even with credentials in the environment — `REPORT_DB_SNAPSHOT=1` is the
 * deliberate opt-in for testing this path locally.
 */
export const snapshotConfigured =
  Boolean(STORE_ID) && (DB_IS_EPHEMERAL || process.env.REPORT_DB_SNAPSHOT === '1');

/**
 * Derived rather than fixed, so the object's path cannot be guessed from the
 * store URL alone. The seed is the STORE id, not the credential: a token can be
 * rotated and a deployment can move from a token to the OIDC identity, and
 * either would have renamed this object and left the database looking wiped.
 * Private access is asked for first and public is the fallback (see `attempt`),
 * because a store created before private blobs existed only answers to the
 * latter.
 */
const PATHNAME = STORE_ID
  ? `report-db/${createHash('sha256').update(STORE_ID).digest('hex').slice(0, 24)}/report.db`
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
        ...blobAuth(),
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
      ...blobAuth(),
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
 * Called at the top of every server action that WRITES.
 *
 * Reads had a freshness path from the start; writes did not, and that asymmetry
 * is a bug twice over. A server action lands on whichever instance the platform
 * picks, and that instance's `/tmp` copy may predate the row the action is
 * about — so `addRowAction` inserted a `wbs_nodes.project_id` pointing at a
 * project those bytes had never seen, and SQLite answered
 * `FOREIGN KEY constraint failed` (11 Sep 2026, on a project created minutes
 * earlier by another lambda). The constraint firing is the LUCKY case: a write
 * that stale bytes happen to accept is serialized and pushed whole, and the
 * push overwrites whatever another instance created in the meantime. That is
 * the "every project vanished" bug again, one layer down.
 *
 * Unthrottled, unlike `ensureFreshDb`. A read answering from bytes 1.5 s old
 * shows a slightly old number; a write on bytes 1.5 s old can delete someone
 * else's project. The cost is one conditional GET per write, a 304 in the
 * common case.
 */
export async function beforeWrite(): Promise<boolean> {
  if (!snapshotConfigured) return false;
  checkedAt = Date.now();
  try {
    return await applyRemote(true);
  } catch (err) {
    // Same rule as the read path: a store that is reachable but failing must
    // not make the app unusable. The write proceeds on what this instance has.
    console.error("[db-snapshot] pre-write refresh failed", err);
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
