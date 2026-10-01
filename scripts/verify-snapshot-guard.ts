/**
 * Proves an instance that never read the stored database never uploads over it.
 *
 * 1 Oct 2026: the Blob store was paused (free tier, Simple Requests), every
 * pull answered 403, and each lambda fell back to `data/seed.db` — two test
 * projects. The image in the store, the real data, was intact; but the push
 * path uploaded whatever the instance held, so the first write anywhere on the
 * deployment would have replaced it with the seed.
 *
 * Runs against a Redis URL nothing listens on, so the pull fails exactly as a
 * suspended store does (it throws; it does not answer "no image"). The probe is `serialize()`: the
 * upload path calls it before anything touches the network, so a guarded flush
 * never calls it at all.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-snapshot-guard.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const work = path.join(os.tmpdir(), `snapshot-guard-${Date.now()}.db`);
copyDbFixture(path.join(process.cwd(), 'data', 'seed.db'), work);
process.env.REPORT_DB_PATH = work;
process.env.REPORT_DB_SNAPSHOT = '1';
process.env.KV_REST_API_URL = 'http://127.0.0.1:9';
process.env.KV_REST_API_TOKEN = 'guard-probe';

const snap = await import('../lib/db-snapshot.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};

check('snapshot path is live for this run', snap.snapshotConfigured === true);

// Cold start against a store that refuses to answer.
await snap.restoreDbSnapshot();

let serialized = 0;
snap.registerConnection({
  serialize: () => {
    serialized += 1;
    return Buffer.from('seed bytes');
  },
  replace: () => {},
});

// A write lands on this instance, then the push runs.
snap.scheduleSnapshotPush();
await snap.flushDbSnapshot();

check('a write after a failed pull uploads nothing', serialized === 0, `serialize() called ${serialized}x`);

// And the pre-write refresh failing too changes nothing.
await snap.beforeWrite();
snap.scheduleSnapshotPush();
await snap.flushDbSnapshot();
check('still nothing after a failed pre-write refresh', serialized === 0, `serialize() called ${serialized}x`);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
process.exit(0);
