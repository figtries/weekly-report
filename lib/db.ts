import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import { revalidateTag } from 'next/cache';
import { redisConfigured, redisGet, redisSet } from './storage';
import { activeProject, migrate, type StoredShape, type Workspace } from './workspace';
import type { Database } from './types';
import { assertLegacyWritable, jsonKeyFor, jsonSeedFor } from './legacy-bridge';
import { getActiveProjectId } from './projects';

const SOURCE_PATH = path.join(process.cwd(), 'data', 'db.json');
const IS_VERCEL = !!process.env.VERCEL;
const WRITABLE_PATH = IS_VERCEL ? '/tmp/db.json' : SOURCE_PATH;

// Whole database as one Redis value, gzip+base64 so a ~700KB JSON travels as
// a few dozen KB per read/write.
const DB_KEY = 'weekly-report:db';

let seeded = false;

async function ensureWritable(): Promise<void> {
  if (!IS_VERCEL || seeded) return;
  if (!existsSync(WRITABLE_PATH)) {
    await fs.copyFile(SOURCE_PATH, WRITABLE_PATH);
  }
  seeded = true;
}

let queue: Promise<unknown> = Promise.resolve();

async function readStored(): Promise<StoredShape> {
  if (redisConfigured) {
    const raw = await redisGet(DB_KEY);
    if (raw !== null) {
      return JSON.parse(gunzipSync(Buffer.from(raw, 'base64')).toString('utf-8')) as StoredShape;
    }
    // First run against an empty store — serve the bundled seed data. It
    // becomes durable on the first write (writeWorkspace persists to Redis).
    return JSON.parse(await fs.readFile(SOURCE_PATH, 'utf-8')) as StoredShape;
  }
  await ensureWritable();
  const raw = await fs.readFile(WRITABLE_PATH, 'utf-8');
  return JSON.parse(raw) as StoredShape;
}

/**
 * The whole workspace. Legacy single-project files are wrapped on the way out,
 * never rewritten on read — a file only changes shape once something is saved.
 */
export async function readWorkspace(): Promise<Workspace> {
  return migrate(await readStored());
}

/**
 * The active project.
 *
 * Kept returning `Database` on purpose: roughly forty call sites read it, and
 * multi-project support would have meant touching all of them for no gain. Only
 * code that genuinely needs to see across projects calls `readWorkspace()`.
 */
export async function readDb(): Promise<Database> {
  return activeProject(await readWorkspace());
}

async function writeWorkspace(ws: Workspace): Promise<void> {
  const json = JSON.stringify(ws);
  if (redisConfigured) {
    await redisSet(DB_KEY, gzipSync(Buffer.from(json, 'utf-8')).toString('base64'));
    return;
  }
  await ensureWritable();
  await fs.writeFile(WRITABLE_PATH, json, 'utf-8');
}

/* ------------------------------------------------ one project at a time */

/**
 * One project's JSON record, by workspace key. Null when it has none yet —
 * which is every project that has not saved a daily report, and is a state the
 * callers render rather than an error.
 */
export async function readJsonProject(key: string): Promise<Database | null> {
  const ws = migrate(await readStored());
  return ws.projects[key] ?? null;
}

/**
 * The OPEN project's record, uncached.
 *
 * The read-your-own-writes path: the cached copy in `lib/data.ts` can lag a
 * lambda that has not seen the latest tag purge, and a daily report that was
 * just created must never look missing to the person who created it.
 */
export async function readOpenDb(): Promise<Database | null> {
  const id = await getActiveProjectId();
  if (!id) return null;
  return readJsonProject(jsonKeyFor(id));
}

/**
 * Mutate the OPEN project's record, creating it on the first write.
 *
 * This is what `mutateDb` could never be. `mutateDb` edits whatever the FILE
 * calls active, so it had to be guarded (`assertLegacyWritable`) to stop a
 * daily report being filed under Gundih — the guard was correct and the price
 * was that no other project could keep a daily report at all. Here the project
 * decides the record, so there is nothing to guard against: each one writes
 * into its own.
 */
export async function mutateOpenDb<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
  const id = await getActiveProjectId();
  if (!id) throw new Error('No project is open.');
  const key = jsonKeyFor(id);
  return mutateWorkspace(async (ws) => {
    let project = ws.projects[key];
    if (!project) {
      project = jsonSeedFor(id);
      ws.projects[key] = project;
      if (!ws.order.includes(key)) ws.order.push(key);
    }
    return mutator(project);
  });
}

/** Mutate the active project. Every existing caller keeps working unchanged. */
export function mutateDb<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
  // This edits whatever `db.json` calls active, which is not necessarily the
  // project on screen: projects are chosen in SQLite now. Without the guard,
  // saving a daily report while an app-made project is open would file it under
  // Gundih — a write landing in the wrong project, silently. The screens above
  // already refuse to render for such a project; this is the same rule enforced
  // where the data actually changes.
  assertLegacyWritable();
  return mutateWorkspace(async (ws) => mutator(activeProject(ws)));
}

/** Mutate across projects — switching, creating, deleting, portfolio-wide edits. */
export function mutateWorkspace<T>(mutator: (ws: Workspace) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const ws = migrate(await readStored());
    const result = await mutator(ws);
    await writeWorkspace(ws);
    // Expire immediately (not stale-while-revalidate) so the re-render that
    // follows every mutation sees the fresh data.
    revalidateTag('db', { expire: 0 });
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
