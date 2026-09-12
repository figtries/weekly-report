/**
 * Make a COMPLETE throwaway copy of a SQLite database for a script to work on.
 *
 * `fs.copyFileSync` is the obvious way and it is wrong here. `data/report.db`
 * runs in WAL mode, so recent writes live in `report.db-wal` and a plain file
 * copy silently leaves them behind: the copy is the database as it was some
 * time ago, and how far back depends on when SQLite last checkpointed.
 *
 * That stayed invisible for as long as the missing writes were rows nobody
 * asserted on. It stopped being invisible on 12 Sep 2026, when `projects`
 * gained an `alias` column: the migration landed in the WAL, three scripts
 * copied the main file without it, and two of them died with
 * `no such column: "alias"` — a failure that looks like a bug in the code under
 * test and is not.
 *
 * `serialize()` returns the whole image including the WAL, which is also
 * exactly what `lib/db-snapshot.ts` uploads, so a fixture built this way is the
 * same shape as the one a deployment restores.
 *
 * `scripts/verify-register-seed.ts` had already worked this out for itself and
 * uses `backup()`, with the reason written next to it. It is left alone; this
 * exists so the next script does not have to learn it a third time.
 */
import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

export function copyDbFixture(src: string, dest: string): string {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const source = new Database(src, { readonly: true });
  try {
    fs.writeFileSync(dest, source.serialize());
  } finally {
    source.close();
  }
  return dest;
}
