/**
 * Proves the Redis snapshot round trip against a fake Upstash REST server.
 *
 * Four things must hold. The first push on an empty store writes the image and
 * its version in one MSET. A read check whose version has not moved costs ONE
 * GET and downloads nothing, which is the whole reason the snapshot left Blob
 * (1 Oct 2026, 10,000 conditional GETs in nineteen days). A write from another
 * instance is adopted on the next check. And the health route's download never
 * records a version it did not adopt, or the next real change would be skipped.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-snapshot-redis.ts
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

import { copyDbFixture } from './db-fixture.ts';

const store = new Map<string, string>();
const calls: string[] = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const [cmd, ...args] = JSON.parse(body) as string[];
    calls.push(cmd);
    let result: unknown = null;
    if (cmd === 'GET') result = store.get(args[0]) ?? null;
    else if (cmd === 'MGET') result = args.map((k) => store.get(k) ?? null);
    else if (cmd === 'MSET') {
      for (let i = 0; i < args.length; i += 2) store.set(args[i], args[i + 1]);
      result = 'OK';
    } else {
      res.writeHead(400).end(JSON.stringify({ error: `unsupported ${cmd}` }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
  });
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

const work = path.join(os.tmpdir(), `snapshot-redis-${Date.now()}.db`);
copyDbFixture(path.join(process.cwd(), 'data', 'seed.db'), work);
process.env.REPORT_DB_PATH = work;
process.env.REPORT_DB_SNAPSHOT = '1';
process.env.KV_REST_API_URL = `http://127.0.0.1:${port}`;
process.env.KV_REST_API_TOKEN = 'redis-probe';

const snap = await import('../lib/db-snapshot.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed += 1;
};
const IMG = 'weekly-report:sqlite:img';
const VER = 'weekly-report:sqlite:ver';
const since = (n: number) => calls.slice(n).join(',');

check('snapshot path is live for this run', snap.snapshotConfigured === true);

// 1. Cold start on an empty store, then the first write.
await snap.restoreDbSnapshot();
const imageA = Buffer.alloc(200_000, 'A');
let held: Buffer = imageA;
const adopted: Buffer[] = [];
snap.registerConnection({
  serialize: () => held,
  replace: (b) => {
    adopted.push(b);
    held = b;
  },
});
let n = calls.length;
snap.scheduleSnapshotPush();
await snap.flushDbSnapshot();
check('first push writes image and version in one MSET', since(n) === 'MSET', since(n));
const stored = store.get(IMG);
check(
  'stored image is the gzipped bytes',
  !!stored && gunzipSync(Buffer.from(stored, 'base64')).equals(imageA),
  `${stored?.length ?? 0} chars for ${imageA.length} bytes`
);

// 2. Nothing moved: one GET, no download.
n = calls.length;
const moved = await snap.ensureFreshDb(true);
check('unchanged check is one GET and adopts nothing', since(n) === 'GET' && !moved && adopted.length === 0, since(n));

// 3. Another instance writes.
const imageB = Buffer.alloc(150_000, 'B');
store.set(IMG, gzipSync(imageB).toString('base64'));
store.set(VER, 'from-another-instance');
n = calls.length;
const movedB = await snap.ensureFreshDb(true);
check(
  'another instance\'s write is adopted',
  movedB && adopted.at(-1)?.equals(imageB) === true,
  since(n)
);

// 4. The health route downloads without adopting; the next check must still see the change.
const imageC = Buffer.alloc(100_000, 'C');
store.set(IMG, gzipSync(imageC).toString('base64'));
store.set(VER, 'third');
await snap.snapshotDiagnostics();
const movedC = await snap.ensureFreshDb(true);
check(
  'a health-route download does not hide the next change',
  movedC && adopted.at(-1)?.equals(imageC) === true
);

// No process.exit(): exiting while fetch's keep-alive sockets are closing
// trips a libuv assertion on Windows and turns a pass into exit 127. The
// server is closed and the loop drains on its own.
server.closeAllConnections();
server.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
