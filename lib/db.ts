import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { gzipSync, gunzipSync } from 'zlib';
import { revalidateTag } from 'next/cache';
import { redisConfigured, redisGet, redisSet } from './storage';
import type { Database } from './types';

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

export async function readDb(): Promise<Database> {
  if (redisConfigured) {
    const raw = await redisGet(DB_KEY);
    if (raw !== null) {
      return JSON.parse(gunzipSync(Buffer.from(raw, 'base64')).toString('utf-8')) as Database;
    }
    // First run against an empty store — serve the bundled seed data. It
    // becomes durable on the first write (writeDb persists to Redis).
    return JSON.parse(await fs.readFile(SOURCE_PATH, 'utf-8')) as Database;
  }
  await ensureWritable();
  const raw = await fs.readFile(WRITABLE_PATH, 'utf-8');
  return JSON.parse(raw) as Database;
}

async function writeDb(db: Database): Promise<void> {
  const json = JSON.stringify(db);
  if (redisConfigured) {
    await redisSet(DB_KEY, gzipSync(Buffer.from(json, 'utf-8')).toString('base64'));
    return;
  }
  await ensureWritable();
  await fs.writeFile(WRITABLE_PATH, json, 'utf-8');
}

export function mutateDb<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    // Expire immediately (not stale-while-revalidate) so the re-render that
    // follows every mutation sees the fresh data.
    revalidateTag('db', { expire: 0 });
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
