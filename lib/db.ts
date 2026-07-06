import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { revalidateTag } from 'next/cache';
import type { Database } from './types';

const SOURCE_PATH = path.join(process.cwd(), 'data', 'db.json');
const IS_VERCEL = !!process.env.VERCEL;
const WRITABLE_PATH = IS_VERCEL ? '/tmp/db.json' : SOURCE_PATH;

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
  await ensureWritable();
  const raw = await fs.readFile(WRITABLE_PATH, 'utf-8');
  return JSON.parse(raw) as Database;
}

async function writeDb(db: Database): Promise<void> {
  await ensureWritable();
  await fs.writeFile(WRITABLE_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export function mutateDb<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    // Expire immediately (not stale-while-revalidate) so the router.refresh()
    // that follows every mutation re-renders with the fresh data.
    revalidateTag('db', { expire: 0 });
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
