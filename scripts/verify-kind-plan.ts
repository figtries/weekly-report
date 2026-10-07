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
const { setWorkKindSqlite } = await import('../lib/progress-sqlite.ts');

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

// Every OTHER row's ticks, counted before anything changes kind. A kind change
// once deleted every tick in every week the row had a figure in (7 Oct 2026).
const othersTicks = (touched: string[]) =>
  (
    sqlite
      .prepare(
        `select count(*) c from milestone_progress mp join milestones m on m.id = mp.milestone_id
         where m.node_id not in (${touched.map(() => '?').join(',') || "''"})`
      )
      .get(...touched) as { c: number }
  ).c;

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

// The plan never says which part of construction (8 Oct 2026): not from the
// steps a client sends, not from a sibling. Data Overall writes it.
const partOf = (id: string) => (sqlite.prepare('select work_part p from wbs_nodes where id = ?').get(id) as { p: string | null }).p;
const piping = findDiscipline('piping');
if (piping) {
  applyKindInPlan(P, 'kD', 'construction', 'steps', piping.steps.map((s) => ({ ...s })));
  check('the plan writes construction with no part and no stages', partOf('kD') === null && rungs('kD').length === 0);
  setWorkKindSqlite('kD', 'construction', 'milestone', { milestones: piping.steps.map((s) => ({ ...s })) }, 'piping');
  check('Data Overall writes the part with its stages', partOf('kD') === 'piping' && disciplineOf(rungs('kD'))?.id === 'piping');
  add('kF', 'kN', 'New task', true);
  inheritKind(P, 'kF');
  check(
    'a new construction row does not take a sibling part',
    kindOf('kF') === 'construction' && partOf('kF') === null && rungs('kF').length === 0
  );
} else {
  check('piping discipline exists', false);
}

// Other on a row already climbing the generic ladder is an answer: the part
// is written and the ticks stay.
const generic = sqlite
  .prepare(
    `select n.id from wbs_nodes n join milestones m on m.node_id = n.id join milestone_progress mp on mp.milestone_id = m.id
     where n.project_id = ? and n.work_kind = 'construction' and n.progress_method = 'milestone'
     group by n.id limit 1`
  )
  .get(P) as { id: string } | undefined;
const other = findDiscipline('other');
if (generic && other && disciplineOf(rungs(generic.id))?.id === 'other') {
  const ticks = (id: string) =>
    (sqlite.prepare('select count(*) c from milestone_progress mp join milestones m on m.id = mp.milestone_id where m.node_id = ?').get(id) as { c: number }).c;
  const before = ticks(generic.id);
  setWorkKindSqlite(generic.id, 'construction', 'milestone', { milestones: other.steps.map((s) => ({ ...s })) }, 'other');
  check('Other on the generic ladder keeps every tick', ticks(generic.id) === before && before > 0, `${before} -> ${ticks(generic.id)}`);
  check('and records the answer', partOf(generic.id) === 'other');
}

// Construction from the plan carries no part (8 Oct 2026): Data Overall asks
// it, so the plan writes no stages and keeps the figure.
add('kG', null, 'Mechanical works', false);
add('kG1', 'kG', 'Pump installation', true);
applyKindInPlan(P, 'kG', 'construction', 'manual', []);
check(
  'construction from the plan has no stages yet',
  kindOf('kG1') === 'construction' && rungs('kG1').length === 0 && method('kG1') === 'lumpsum',
  `${method('kG1')} ${rungs('kG1').length} rungs`
);
add('kG2', 'kG', 'New task', true);
inheritKind(P, 'kG2');
check('a new construction row with no part beside it has no stages', kindOf('kG2') === 'construction' && rungs('kG2').length === 0);

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
  const before = othersTicks([done100.id]);
  applyKindInPlan(P, done100.id, 'engineering', 'steps', eng);
  check('a finished row stays finished', pctOf(done100.id) >= 100, `${pctOf(done100.id)}`);
  const after = othersTicks([done100.id]);
  check("one row's kind change leaves every other row's ticks", before === after && before > 0, `${before} -> ${after}`);
}
// A real heading with recorded ticks under it, changed twice.
const heading = sqlite
  .prepare(
    `select p.id from wbs_nodes p join wbs_nodes c on c.parent_id = p.id
     join milestones m on m.node_id = c.id join milestone_progress mp on mp.milestone_id = m.id
     where p.project_id = ? group by p.id order by count(*) desc limit 1`
  )
  .get(P) as { id: string } | undefined;
if (heading) {
  const under = (sqlite.prepare('select id from wbs_nodes where parent_id = ?').all(heading.id) as { id: string }[]).map((r) => r.id);
  const before = othersTicks([heading.id, ...under]);
  applyKindInPlan(P, heading.id, 'commissioning', 'steps', com);
  const after = othersTicks([heading.id, ...under]);
  check('a heading kind change leaves rows outside it alone', before === after && before > 0, `${before} -> ${after}`);
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

const ticked = sqlite
  .prepare(
    `select n.id, max(lp.cum_progress_pct) p from wbs_nodes n join leaf_progress lp on lp.node_id = n.id
     where n.project_id = ? and n.progress_method = 'milestone' and n.is_leaf = 1
     group by n.id having p > 0 limit 1`
  )
  .get(P) as { id: string; p: number } | undefined;
if (ticked) {
  applyKindInPlan(P, ticked.id, 'construction', 'manual', []);
  check('a ticked row made construction keeps its figure exactly', Math.abs(pctOf(ticked.id) - ticked.p) < 1e-9, `${ticked.p} -> ${pctOf(ticked.id)}`);
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('all passed');
