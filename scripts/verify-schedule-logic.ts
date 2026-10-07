/**
 * Proves the link model and the network analysis behind Projects' links and
 * Gantt (spec: docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md).
 *
 * Writes go to a COPY of data/report.db (see scripts/db-fixture.ts).
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-schedule-logic.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const fixture = path.join(os.tmpdir(), `schedule-logic-${Date.now()}.db`);
copyDbFixture(path.join(process.cwd(), 'data', 'report.db'), fixture);
process.env.REPORT_DB_PATH = fixture;

const { parseLinks, serializeLinks, cleanLink } = await import('../lib/links.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};
const j = (v: unknown) => JSON.stringify(v);

/* --------------------------------------------------------------- the shape */

check('null column means never asked', parseLinks(null) === null);
check('empty string means never asked', parseLinks('') === null);
check('malformed JSON reads as never asked, not an error', parseLinks('{oops') === null);
check('[] means waits for nothing', j(parseLinks('[]')) === '[]');
check(
  'a legacy bare id reads as after it finishes, no wait',
  j(parseLinks('["a"]')) === j([{ id: 'a', type: 'FS', wait: 0 }]),
  j(parseLinks('["a"]'))
);
check(
  'the new shape round-trips',
  j(parseLinks(serializeLinks([{ id: 'a', type: 'SS', wait: 7 }]))) === j([{ id: 'a', type: 'SS', wait: 7 }])
);
check('an unknown way is dropped', cleanLink({ id: 'a', type: 'SF', wait: 0 }) === null);
check('a negative wait is dropped', cleanLink({ id: 'a', type: 'FS', wait: -2 }) === null);
check('a fractional wait is dropped', cleanLink({ id: 'a', type: 'FS', wait: 1.5 }) === null);
check('a missing wait reads as 0', j(cleanLink({ id: 'a', type: 'FF' })) === j({ id: 'a', type: 'FF', wait: 0 }));
check(
  'duplicates keep the first',
  j(parseLinks('[{"id":"a","type":"FS","wait":1},{"id":"a","type":"SS","wait":0}]')) ===
    j([{ id: 'a', type: 'FS', wait: 1 }])
);

/* ==== later tasks append their sections ABOVE this line ==== */

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
