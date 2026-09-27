/**
 * Proves what a person tells the forecast is kept, read back, and refused when
 * it is wrong (27 Sep 2026): the date someone outside the app gave for an
 * activity, and what the activity waits for. Both live on `wbs_nodes`, never
 * on a week's progress row, so saving one must not mark the activity as filled
 * in for the week.
 *
 * Works on a throwaway copy of data/report.db.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-forecast-store.ts
 */
import os from 'node:os';
import path from 'node:path';

import { copyDbFixture } from './db-fixture.ts';

const work = path.join(os.tmpdir(), `verify-forecast-store-${process.pid}.db`);
copyDbFixture('data/report.db', work);
process.env.REPORT_DB_PATH = work;

const { db, schema } = await import('../lib/sqlite.ts');
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const { setLeafForecastSqlite, setWaitsForSqlite } = await import('../lib/progress-sqlite.ts');

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};
const refuses = (fn: () => void) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const nodes = db.select().from(schema.wbsNodes).all();
const parents = new Set(nodes.map((n) => n.parentId).filter(Boolean));
const byProject = new Map<string, typeof nodes>();
for (const n of nodes) byProject.set(n.projectId, [...(byProject.get(n.projectId) ?? []), n]);
const [projectId, rows] = [...byProject].sort((a, b) => b[1].length - a[1].length)[0];
const leaves = rows.filter((n) => !parents.has(n.id));
const other = nodes.find((n) => n.projectId !== projectId && !parents.has(n.id));
const [a, b, c] = leaves;
console.log(`project ${projectId}: ${leaves.length} activities`);

const progressRows = () => db.select().from(schema.leafProgress).all().length;
const before = progressRows();

setLeafForecastSqlite(projectId, a.id, { date: '2027-04-11', source: 'vendor', rungId: null }, 38);
setWaitsForSqlite(projectId, b.id, [a.id, c.id, a.id]);

const read = buildProjectDashboardData(projectId)!.db.wbsItems;
const ra = read.find((i) => i.id === a.id)!;
const rb = read.find((i) => i.id === b.id)!;
check('the date is read back with who gave it and when', JSON.stringify(ra.forecast) === JSON.stringify({ date: '2027-04-11', source: 'vendor', rungId: null, week: 38 }), JSON.stringify(ra.forecast));
check('the links are read back once each', rb.waitsFor?.join() === [a.id, c.id].join(), rb.waitsFor?.join());
check('neither wrote a progress row', progressRows() === before, `${before} -> ${progressRows()}`);

setLeafForecastSqlite(projectId, a.id, null, 39);
setWaitsForSqlite(projectId, b.id, []);
const cleared = buildProjectDashboardData(projectId)!.db.wbsItems;
check('back to plan clears the date', cleared.find((i) => i.id === a.id)!.forecast === undefined);
check('no links clears the links', cleared.find((i) => i.id === b.id)!.waitsFor === undefined);

check('refuses a date that is not one', refuses(() => setLeafForecastSqlite(projectId, a.id, { date: '11/04/2027', source: 'vendor', rungId: null }, 38)));
check('refuses a source that is not vendor, site or client', refuses(() => setLeafForecastSqlite(projectId, a.id, { date: '2027-04-11', source: 'rumour', rungId: null }, 38)));
check('refuses a stage that is not on the activity', refuses(() => setLeafForecastSqlite(projectId, a.id, { date: '2027-04-11', source: 'vendor', rungId: 'nope' }, 38)));
check('refuses waiting for itself', refuses(() => setWaitsForSqlite(projectId, a.id, [a.id])));
check('refuses an id from another project', !other || refuses(() => setWaitsForSqlite(projectId, a.id, [other.id])));
const heading = rows.find((n) => parents.has(n.id));
check('refuses a heading', !heading || refuses(() => setWaitsForSqlite(projectId, heading.id, [a.id])));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
