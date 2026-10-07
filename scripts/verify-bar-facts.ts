/**
 * The planner's bars must say what Data Overall says: every leaf's done
 * percentage and forecast finish, read through the same functions, on the
 * largest plan in the database.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-bar-facts.ts
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbFixture } from './db-fixture.ts';

const work = join(tmpdir(), `bar-facts-${Date.now()}.db`);
copyDbFixture('data/report.db', work);
process.env.REPORT_DB_PATH = work;

const { sqlite } = await import('../lib/sqlite.ts');
const { getBarFacts } = await import('../lib/bar-facts.ts');
const { buildProjectDashboardData } = await import('../lib/dashboard-db.ts');
const { currentWeekOf } = await import('../lib/current-week.ts');
const { resolveLeafProgress } = await import('../lib/progress.ts');
const { buildForecastView } = await import('../lib/forecast-view.ts');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
  if (!ok) failed += 1;
};

const { project_id: projectId } = sqlite
  .prepare('select project_id, count(*) n from wbs_nodes group by project_id order by n desc limit 1')
  .get() as { project_id: string };
const today = new Date();
const { week, facts } = getBarFacts(projectId, today);
const db = buildProjectDashboardData(projectId)!.db;
const w = currentWeekOf(db, today);
const meta = db.weeks.find((x) => x.week === w);
const view = buildForecastView(db, w);
const parents = new Set(db.wbsItems.map((i) => i.parentId).filter(Boolean));
const ids = new Set(
  (sqlite.prepare('select id from wbs_nodes where project_id = ?').all(projectId) as { id: string }[]).map((r) => r.id)
);

check('reads the current week', week === w, `${week} vs ${w}`);
check('every key is a row of this project', Object.keys(facts).every((k) => ids.has(k)), `${Object.keys(facts).length} rows`);

let leaves = 0;
let doneOff = 0;
let finishOff = 0;
let kinds = 0;
for (const item of db.wbsItems) {
  const f = facts[item.id];
  if (parents.has(item.id)) {
    if (f.rungs.length !== 0) doneOff += 1;
    continue;
  }
  leaves += 1;
  if (f.kindId) kinds += 1;
  if (f.donePct !== resolveLeafProgress(item, meta?.leafData[item.id])) doneOff += 1;
  if (f.forecastFinish !== (view?.leaves[item.id]?.finish ?? null)) finishOff += 1;
  const solid = f.rungs.filter((r) => r.done).reduce((a, r) => a + r.weight, 0);
  const total = f.rungs.reduce((a, r) => a + r.weight, 0);
  if (f.rungs.length && Math.abs((solid / total) * 100 - f.donePct) > 1e-6 && item.progressMethod === 'milestone') {
    doneOff += 1;
  }
}
check('done % equals Data Overall for every leaf', doneOff === 0, `${leaves} leaves, ${doneOff} off`);
check('forecast finish equals Data Overall for every leaf', finishOff === 0, `${finishOff} off`);
check('kinds are carried', kinds > 0, `${kinds} leaves with a kind`);
const late = Object.values(facts).filter((f) => f.reason);
check('a late bar says why', late.every((f) => f.forecastFinish! > f.planFinish!), `${late.length} late`);

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
