import { promises as fs } from 'fs';
import path from 'path';
import type { Database } from './types';

const DB_PATH = path.join(process.cwd(), 'data', 'db.json');

let queue: Promise<unknown> = Promise.resolve();

export async function readDb(): Promise<Database> {
  const raw = await fs.readFile(DB_PATH, 'utf-8');
  return JSON.parse(raw) as Database;
}

async function writeDb(db: Database): Promise<void> {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
}

export function mutateDb<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}
