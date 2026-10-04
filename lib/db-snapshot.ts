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
 * two Redis keys, the gzipped image and a version string.
 *
 *   cold start  →  download the image over the file, before the first query
 *   any write   →  serialize the database and upload it, inside `after()`
 *   any read    →  read the version, at most once every 1.5 s; the image is
 *                  downloaded only when the version moved
 *
 * IT WAS A VERCEL BLOB OBJECT UNTIL 1 OCT 2026. The read check was a
 * conditional GET, and a 304 still counts as an operation: across every lambda
 * that came to 10,000 in nineteen days, the Hobby store was suspended for 30
 * days, downloads were refused even from the dashboard, and a new store cannot
 * be created on a suspended account. Redis (Upstash, already attached for
 * db.json) allows 500,000 commands a month, and a version read is one tiny
 * command. The last Blob image is still in that store and has to be brought
 * across by hand once it can be read.
 *
 * Three properties this relies on. `sqlite.serialize()` returns the complete
 * image including anything still in the WAL, so a snapshot is never half a
 * transaction. `after()` is backed by `waitUntil` on Vercel, so the instance
 * stays alive until the upload finishes rather than freezing mid-upload. And
 * MSET writes the image and its version in one atomic command, so a reader
 * never pairs a new version with an old image.
 *
 * It is a single-writer design: two people editing different projects in the
 * same second can have one snapshot land on top of the other. That is the
 * honest shape of a file-level snapshot, and it is the trade for not rewriting
 * forty synchronous call sites onto an async driver.
 *
 * With no Redis attached this module does nothing at all, and the app
 * behaves exactly as it did before — ephemeral, but working.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

// The DRIVER, not the connection. This module must never import `./sqlite`
// (that is what lets `instrumentation.ts` run it before any route module opens
// the file), but opening a throwaway handle on a file we have just written is a
// different thing entirely, and `ensureSchema` needs it synchronously.
// `better-sqlite3` is in `serverExternalPackages`, the same as in `lib/sqlite.ts`.
import Database from 'better-sqlite3';

import { DB_PATH, DB_IS_EPHEMERAL } from './db-path';
import { redisConfigured, redisGet, redisMGet, redisMSet } from './storage';
import { bobotWrites, deriveWeights, type WeightNode } from './weights';

/** The image (gzip, base64) and the version a reader compares against. */
const IMG_KEY = 'weekly-report:sqlite:img';
const VER_KEY = 'weekly-report:sqlite:ver';

/**
 * THE OLD BLOB STORE, for `/api/health/db` only: nothing here reads or writes
 * it any more (see the header). Kept so the health route can still say whether
 * the suspended store answers and what it holds.
 *
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
 * and any older deployment keep working.
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

export { STORE_ID as blobStoreId };

const BUILD = process.env.NEXT_PHASE === 'phase-production-build';

/**
 * Only where the database is already throwaway. A developer machine keeps its
 * own `data/report.db` and must never have a deployment's data pulled over it,
 * even with credentials in the environment — `REPORT_DB_SNAPSHOT=1` is the
 * deliberate opt-in for testing this path locally.
 *
 * And never during the production build. The store's variables are set while
 * the build runs too, and on Vercel the repo ships no `data/report.db`, so a
 * store-gated module once went live at BUILD time: `restoreDbSnapshot()` from
 * `instrumentation.ts`, then a remote read behind every prerendered page, and
 * the Vercel build failed. A build has no runtime data to restore, so the whole
 * module stays inert there.
 */
export const snapshotConfigured =
  redisConfigured && !BUILD && (DB_IS_EPHEMERAL || process.env.REPORT_DB_SNAPSHOT === '1');

/** How long a downloaded image is trusted before the next version read. */
const FRESH_MS = 1500;

type Connection = {
  /** The complete database image, WAL included. */
  serialize(): Buffer;
  /** Close, swap the bytes on disk, reopen. */
  replace(bytes: Buffer): void;
};

let connection: Connection | null = null;
/** The version of the image this instance holds. */
let etag: string | null = null;
let checkedAt = 0;
let dirty = false;
let scheduled = false;
/**
 * Whether this instance's bytes are the store's: it downloaded the image, or the
 * store answered that it holds none. Until then the file is `data/seed.db`, and
 * pushing it would REPLACE the database. 1 Oct 2026: the store was paused on the
 * free tier, every pull answered 403, each lambda served the seed's two test
 * projects, and the first write anywhere would have uploaded them over the real
 * image. See `scripts/verify-snapshot-guard.ts`.
 */
let adopted = false;
let queue: Promise<void> = Promise.resolve();

/**
 * The last swallowed failure, kept so it can be asked for.
 *
 * Every failure in here is deliberately non-fatal — a store that is reachable
 * but failing must not take the app down — which for two days meant the only
 * record of WHY the database looked empty was a console line inside a lambda,
 * reachable only by someone logged into the dashboard. Keeping the last one in
 * memory costs nothing and is what `/api/health/db` reports.
 */
let lastFailure: { phase: string; message: string; at: string } | null = null;

function note(phase: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  lastFailure = { phase, message, at: new Date().toISOString() };
  console.error(`[db-snapshot] ${phase} failed`, err);
}

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

/**
 * Columns this build needs that a stored snapshot may predate.
 *
 * A DEPLOYMENT DOES NOT RUN MIGRATIONS. `instrumentation.ts` pulls the blob
 * over the database file before the first query, so the snapshot's schema IS
 * the deployed schema and the freshly built file is overwritten by it. A
 * column added by a migration therefore reaches Vercel only if something puts
 * it back after the download, and this list is that something.
 *
 * Append one line per column added from here on. Keep it to COLUMNS: a new
 * table would also need its indexes and its foreign keys, and adding one here
 * would create neither. That remains a deployment question to answer before
 * writing the code, exactly as AGENTS.md says.
 */
const EXPECTED_COLUMNS: Array<{ table: string; column: string; decl: string }> = [
  { table: 'projects', column: 'alias', decl: 'text' },
  { table: 'projects', column: 'current_week', decl: 'integer' },
  { table: 'wbs_nodes', column: 'work_kind', decl: 'text' },
  { table: 'leaf_progress', column: 'source', decl: 'text' },
  { table: 'wbs_nodes', column: 'forecast_date', decl: 'text' },
  { table: 'wbs_nodes', column: 'forecast_source', decl: 'text' },
  { table: 'wbs_nodes', column: 'forecast_rung', decl: 'text' },
  { table: 'wbs_nodes', column: 'forecast_week', decl: 'integer' },
  { table: 'wbs_nodes', column: 'waits_for', decl: 'text' },
  { table: 'doc_stage_weights', column: 'label', decl: 'text' },
  { table: 'doc_stage_weights', column: 'full_name', decl: 'text' },
  { table: 'doc_stage_weights', column: 'color', decl: 'text' },
  { table: 'doc_numbering', column: 'area', decl: 'text' },
  { table: 'doc_numbering', column: 'codes', decl: 'text' },
];

/**
 * Bring a database file up to the columns this build needs.
 *
 * Idempotent, additive, and it never drops or rewrites anything: the worst it
 * can do to a file that is already current is read one `pragma` per table.
 * Returns what it had to add, so a repair is said out loud in the log rather
 * than happening in silence.
 *
 * **It runs only on bytes that arrived from the store**, called from
 * `writeDbFile`, which is the single place incoming bytes land. It deliberately
 * does NOT run against a developer's own `data/report.db`: that file's
 * authority is the drizzle journal, and silently adding a column to it would
 * leave the journal disagreeing with the file and make the next
 * `drizzle-kit migrate` fail on a duplicate column. A local database is
 * migrated, not repaired.
 */
export function ensureSchema(dbPath: string): string[] {
  const added: string[] = [];
  const db = new Database(dbPath);
  try {
    for (const { table, column, decl } of EXPECTED_COLUMNS) {
      const cols = db.prepare(`pragma table_info("${table}")`).all() as Array<{ name: string }>;
      // A table this build does not have yet is not this function's problem.
      if (cols.length === 0) continue;
      if (cols.some((c) => c.name === column)) continue;
      db.prepare(`alter table "${table}" add column "${column}" ${decl}`).run();
      added.push(`${table}.${column}`);
    }
  } finally {
    db.close();
  }
  return added;
}

/**
 * Which weight rule the stored `bobot` on this file was written under, kept in
 * `pragma user_version` (nothing else here uses it; drizzle keeps its own table).
 *
 * 1 — budget only, no even share (24 Sep 2026). The rule changed what every
 * unbudgeted leaf weighs, and the reports read the STORED figure, so without
 * this a deployment would draw the new rule on the Weights screen and the old
 * one on every S-curve until somebody happened to edit a price.
 *
 * 2 — weights over the PROJECT budget (the work packages added up), not over
 * the contract value (24 Sep 2026, same day).
 */
const WEIGHT_RULE = 2;

/**
 * Bring the stored weights of every UNLOCKED project in line with the current
 * rule, once per file. Locked projects (`weight_basis = 'boq'`) are never
 * touched: their weights are authoritative, which is what the lock means.
 *
 * Same scope as `ensureSchema`: only bytes that arrived from the store. It is
 * repeated on each cold start until the next write pushes a file that already
 * carries the version, and it writes the same figures every time.
 */
export function resyncWeights(dbPath: string): number {
  const file = new Database(dbPath);
  try {
    if ((file.pragma('user_version', { simple: true }) as number) >= WEIGHT_RULE) return 0;
    const projects = file
      .prepare(`select id, contract_value from projects where weight_basis <> 'boq'`)
      .all() as Array<{ id: string; contract_value: number | null }>;
    const rows = file.prepare(
      `select id, parent_id, sort_order, price, workstep_factor, is_reporting_unit,
              unit_contract_value, bobot, is_leaf
       from wbs_nodes where project_id = ? order by sort_order`
    );
    const write = file.prepare('update wbs_nodes set bobot = ? where id = ?');
    let moved = 0;
    file.transaction(() => {
      for (const p of projects) {
        const nodes: WeightNode[] = (rows.all(p.id) as Array<Record<string, unknown>>).map((r) => ({
          id: r.id as string,
          parentId: (r.parent_id as string | null) ?? null,
          order: r.sort_order as number,
          price: (r.price as number | null) ?? null,
          workstepFactor: (r.workstep_factor as number | null) ?? null,
          isReportingUnit: !!r.is_reporting_unit,
          unitContractValue: (r.unit_contract_value as number | null) ?? null,
          bobot: (r.bobot as number | null) ?? null,
          isLeaf: !!r.is_leaf,
        }));
        const signed = (p.contract_value ?? 0) > 0 ? (p.contract_value as number) : undefined;
        for (const w of bobotWrites(nodes, deriveWeights(nodes, signed))) {
          write.run(w.bobot, w.id);
          moved += 1;
        }
      }
      file.pragma(`user_version = ${WEIGHT_RULE}`);
    })();
    return moved;
  } finally {
    file.close();
  }
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
  // AFTER the rename, so the repair lands on the file the app will open rather
  // than on a temporary name that is about to move. Every path that adopts
  // foreign bytes comes through here, so this covers the cold-start restore and
  // the mid-life refresh alike.
  try {
    const repaired = ensureSchema(DB_PATH);
    if (repaired.length) {
      console.log(`[db-snapshot] schema repaired after restore: ${repaired.join(', ')}`);
    }
  } catch (err) {
    // A snapshot we cannot repair is still a snapshot worth serving: the app
    // will fail loudly on the missing column if it needs it, which is more
    // useful than refusing to start.
    note('schema repair', err);
  }
  try {
    const moved = resyncWeights(DB_PATH);
    if (moved) console.log(`[db-snapshot] weights re-derived after restore: ${moved} rows`);
  } catch (err) {
    note('weight resync', err);
  }
}

export { writeDbFile };

/**
 * The remote image, or null when it is unchanged or there is none.
 *
 * Conditional: one GET of the version, and the image only when that moved.
 * The pair is then read with one MGET, so the version returned is the version
 * of these bytes even if a write lands between the two commands. The caller
 * records it only once the bytes are ADOPTED: the health route downloads
 * without adopting, and an instance that recorded a version it does not hold
 * would skip the next real change.
 */
async function download(conditional: boolean): Promise<{ bytes: Buffer; ver: string } | null> {
  if (conditional && etag) {
    const ver = await redisGet(VER_KEY);
    if (ver === etag) return null;
  }
  const [ver, img] = await redisMGet([VER_KEY, IMG_KEY]);
  if (!ver || !img) return null;
  return { bytes: gunzipSync(Buffer.from(img, 'base64')), ver };
}

/** Image and version in one MSET; the version is the image's own hash. */
async function upload(bytes: Buffer): Promise<string> {
  const ver = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  await redisMSet([
    [IMG_KEY, gzipSync(bytes).toString('base64')],
    [VER_KEY, ver],
  ]);
  return ver;
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
      if (!adopted) {
        // The write stays on this instance and dies with it. Losing it is the
        // price; uploading it would lose everything else.
        note('upload', new Error('refused: this instance never read the stored database'));
        return;
      }
      const bytes = connection.serialize();
      try {
        etag = await upload(bytes);
      } catch (err) {
        dirty = true;
        throw err;
      }
    })
    .catch((err) => {
      note('upload', err);
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
  const got = await download(conditional);
  // Reaching here means the store ANSWERED: an image, the version we already hold,
  // or no object at all (the first deploy, where the seed is the first image).
  // A refusal throws and never gets here.
  if (!got) {
    adopted = true;
    return false;
  }
  adoptDbBytes(got.bytes);
  etag = got.ver;
  adopted = true;
  return true;
}
/**
 * Called before a read that must see writes made by another instance. Cheap by
 * design: one version read at most every 1.5 s, and nothing at all when no store is
 * attached.
 */
export async function ensureFreshDb(force = false): Promise<boolean> {
  if (!snapshotConfigured) return false;
  const now = Date.now();
  // `force` skips the throttle. Only one caller uses it, and it has earned it:
  // a cookie naming a project this instance has never heard of is far more
  // likely to be bytes that have not arrived than a project that is gone.
  if (!force && now - checkedAt < FRESH_MS) return false;
  checkedAt = now;
  try {
    return await applyRemote(true);
  } catch (err) {
    // A reachable-but-failing store must not take the app down; the instance
    // keeps serving what it has.
    note('refresh', err);
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
 * else's project. The cost is one version read per write, unchanged in the
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
    note('pre-write refresh', err);
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
    note('forced refresh', err);
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
    note('restore', err);
  }
}

/**
 * Which projects the DOWNLOADED BYTES hold — opened as their own throwaway
 * file, never adopted.
 *
 * "The upload happened" and "the upload contained the row" are different
 * claims, and from outside they looked the same: the object's timestamp moved
 * to the second the project was created, its size did not change by a byte, and
 * the project still 404d. Reading the image directly is the only way to say
 * which half of the round trip is broken.
 */
async function peekProjects(bytes: Buffer): Promise<string[] | { error: string }> {
  const probePath = path.join(path.dirname(DB_PATH), `probe-${process.pid}-${Date.now()}.db`);
  try {
    fs.writeFileSync(probePath, bytes);
    const { default: Database } = await import('better-sqlite3');
    const probe = new Database(probePath, { readonly: true });
    try {
      return (probe.prepare('select id from projects').all() as Array<{ id: string }>).map(
        (r) => r.id
      );
    } finally {
      probe.close();
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.rmSync(probePath, { force: true });
  }
}

/**
 * What this instance's pull path actually does, right now.
 *
 * Read-only: it downloads the object and reports on it without adopting the
 * bytes, so asking the question cannot change what the instance is serving.
 * It exists because "the push worked and the pull returned nothing" and "no
 * store at all" produced exactly the same symptom from outside — a 404 on a
 * project that had just been created — and telling them apart otherwise means
 * reading a lambda's console.
 */
export async function snapshotDiagnostics(): Promise<Record<string, unknown>> {
  if (!snapshotConfigured) return { configured: false, lastFailure };
  const out: Record<string, unknown> = {
    configured: true,
    keys: [IMG_KEY, VER_KEY],
    heldEtag: etag,
  };
  try {
    const got = await download(false);
    out.pull = got
      ? { ok: true, bytes: got.bytes.length, version: got.ver, projects: await peekProjects(got.bytes) }
      : { ok: true, bytes: 0, note: 'no image stored yet' };
  } catch (err) {
    out.pull = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  out.lastFailure = lastFailure;
  return out;
}
