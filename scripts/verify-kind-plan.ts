/**
 * The kind of work, set in the plan: a heading hands it to the rows that have
 * none of their own or still carry its previous one, spares the rest, and a
 * new row takes it. Progress already recorded is restated, never zeroed.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-kind-plan.ts
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyDbFixture } from './db-fixture.ts';

const work = join(tmpdir(), `kind-plan-${Date.now()}.db`);
copyDbFixture('data/report.db', work);
process.env.REPORT_DB_PATH = work;

const { sqlite } = await import('../lib/sqlite.ts');
const { applyKindInPlan, inheritKind } = await import('../lib/kind-plan.ts');
const { BUILT_IN_KINDS } = await import('../lib/work-kind.ts');
const { findDiscipline, disciplineOf } = await import('../lib/disciplines.ts');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  ${detail}`);
  if (!ok) failed += 1;
};

const { project_id: P } = sqlite
  .prepare('select project_id, count(*) n from wbs_nodes group by project_id order by n desc limit 1')
  .get() as { project_id: string };

const insert = sqlite.prepare(
  `insert into wbs_nodes (id, project_id, parent_id, wbs_code, deskripsi, sort_order, depth, is_leaf, progress_method, work_kind)
   values (?, ?, ?, ?, ?, ?, ?, ?, 'lumpsum', ?)`
);
let order = 90000;
const add = (id: string, parent: string | null, name: string, leaf: boolean, kind: string | null = null) =>
  insert.run(id, P, parent, `~${id}`, name, order++, parent ? 1 : 0, leaf ? 1 : 0, kind);

add('kH', null, 'Engineering', false);
add('kA', 'kH', 'Pipe stress analysis', true);
add('kB', 'kH', 'IFR', true);
add('kC', 'kH', 'Valve datasheet PO', true, 'procurement');
add('kN', 'kH', 'Site works', false, 'construction');
add('kD', 'kN', 'Spool erection', true);

const kindOf = (id: string) => (sqlite.prepare('select work_kind k from wbs_nodes where id = ?').get(id) as { k: string | null }).k;
const rungs = (id: string) =>
  sqlite.prepare('select id, label from milestones where node_id = ? order by sort_order').all(id) as { id: string; label: string }[];
const method = (id: string) =>
  (sqlite.prepare('select progress_method m from wbs_nodes where id = ?').get(id) as { m: string }).m;

const eng = BUILT_IN_KINDS.find((k) => k.id === 'engineering')!.steps;
const written = applyKindInPlan(P, 'kH', 'engineering', 'steps', eng);
check('heading takes the kind', kindOf('kH') === 'engineering');
check('a row with no kind follows', kindOf('kA') === 'engineering' && rungs('kA').length === 3, `${rungs('kA').length} rungs`);
check('a row named for one stage is that stage', kindOf('kB') === 'engineering' && rungs('kB').length === 1 && rungs('kB')[0].label === 'IFR');
check('ladders are milestone rows', method('kA') === 'milestone' && method('kB') === 'milestone');
check('a row with its own kind is spared', kindOf('kC') === 'procurement');
check('a heading with its own kind is spared, and its rows', kindOf('kN') === 'construction' && kindOf('kD') === null);
check('written = heading + reached rows', written.length === 3, written.join(','));

const com = BUILT_IN_KINDS.find((k) => k.id === 'commissioning')!.steps;
applyKindInPlan(P, 'kH', 'commissioning', 'steps', com);
check('rows carrying the old kind follow the new one', kindOf('kA') === 'commissioning' && kindOf('kB') === 'commissioning');
check('the row with its own kind is still spared', kindOf('kC') === 'procurement');

add('kE', 'kH', 'New task', true);
inheritKind(P, 'kE');
check('a new row takes its heading kind', kindOf('kE') === 'commissioning' && rungs('kE').length === 4, `${rungs('kE').length} rungs`);

const piping = findDiscipline('piping');
if (piping) {
  applyKindInPlan(P, 'kD', 'construction', 'steps', piping.steps.map((s) => ({ ...s })));
  add('kF', 'kN', 'New task', true);
  inheritKind(P, 'kF');
  check(
    'a new construction row takes a sibling discipline',
    kindOf('kF') === 'construction' && disciplineOf(rungs('kF'))?.id === 'piping',
    disciplineOf(rungs('kF'))?.id ?? 'none'
  );
} else {
  check('piping discipline exists', false);
}

check(
  'quantity is refused on a heading',
  (() => {
    try {
      applyKindInPlan(P, 'kH', 'construction', 'qty', []);
      return false;
    } catch {
      return true;
    }
  })()
);

// Progress already recorded: restated in the new terms, never zeroed.
const pctOf = (id: string) =>
  (sqlite.prepare('select max(cum_progress_pct) p from leaf_progress where node_id = ?').get(id) as { p: number | null }).p ?? 0;
const done100 = sqlite
  .prepare(
    `select n.id from wbs_nodes n join leaf_progress lp on lp.node_id = n.id
     where n.project_id = ? and n.progress_method = 'lumpsum' and n.is_leaf = 1
     group by n.id having max(lp.cum_progress_pct) >= 100 limit 1`
  )
  .get(P) as { id: string } | undefined;
if (done100) {
  applyKindInPlan(P, done100.id, 'engineering', 'steps', eng);
  check('a finished row stays finished', pctOf(done100.id) >= 100, `${pctOf(done100.id)}`);
}
const partial = sqlite
  .prepare(
    `select n.id, max(lp.cum_progress_pct) p from wbs_nodes n join leaf_progress lp on lp.node_id = n.id
     where n.project_id = ? and n.progress_method = 'lumpsum' and n.is_leaf = 1
     group by n.id having p > 0 and p < 100 limit 1`
  )
  .get(P) as { id: string; p: number } | undefined;
if (partial) {
  applyKindInPlan(P, partial.id, 'engineering', 'steps', eng);
  const after = pctOf(partial.id);
  check('a part-done row is never raised', after <= partial.p + 1e-9, `${partial.p} -> ${after}`);
  check('a part-done row keeps every stage it reached', partial.p < 50 || after >= 50, `${partial.p} -> ${after}`);
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
