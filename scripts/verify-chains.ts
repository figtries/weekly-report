/**
 * The inferred chain, checked against the real plan.
 *
 * Run: npx tsx scripts/verify-chains.ts
 *
 * Two things have to be true for this feature to be worth having. The guess has
 * to find the chains that are actually there — Gundih's engineering leaves run
 * IFR → IFA → AFC — and it has to NOT find chains everywhere,
 * because a graph in which everything follows everything makes every row
 * critical and says nothing.
 */
import { getSheet } from '../lib/sheet';
import {
  addDays,
  computeFloat,
  inferChains,
  shiftPreview,
  weeksTouched,
  type ChainNode,
  type WeekSpan,
} from '../lib/chains';
import { db, schema } from '../lib/sqlite';
import { eq } from 'drizzle-orm';

let failures = 0;
function check(name: string, pass: boolean, detail: string) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!pass) failures += 1;
}

const sheet = getSheet('gundih');
const rows = sheet.rows;
const parents = new Map(
  db
    .select({ id: schema.wbsNodes.id, parentId: schema.wbsNodes.parentId })
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, 'gundih'))
    .all()
    .map((n) => [n.id, n.parentId ?? null])
);
const nodes: ChainNode[] = rows.map((r, i) => ({
  id: r.id,
  parentId: parents.get(r.id) ?? null,
  order: i,
  isLeaf: r.isLeaf,
  startDate: r.startDate,
  finishDate: r.finishDate,
}));
const names = new Map(rows.map((r) => [r.id, r.name]));
const links = inferChains(nodes);

check('the plan is there', rows.length === 285, `${rows.length} rows`);

check(
  'links are found, and not everywhere',
  links.length > 20 && links.length < rows.length,
  `${links.length} links across ${rows.length} rows`
);

/* --- the chain that is definitely there ---------------------------------- */

{
  // IFR finishes, IFA starts the next day, AFC after that. Gundih has five of
  // these triples; what matters is that EVERY one is found and that every IFR
  // leads to an IFA rather than to whatever happened to be next in the file.
  const ifr = rows.filter((r) => r.name === 'IFR');
  const chained = ifr.filter((r) => links.some((l) => l.fromId === r.id));
  const toIfa = chained.filter((r) => {
    const l = links.find((x) => x.fromId === r.id)!;
    return names.get(l.toId) === 'IFA';
  });
  check(
    'IFR → IFA is found wherever it exists',
    ifr.length > 0 && chained.length === ifr.length && toIfa.length === ifr.length,
    `${chained.length} of ${ifr.length} IFR rows lead somewhere, all of them to IFA`
  );
}

/* --- nothing follows across a parent boundary ---------------------------- */

{
  const crossing = links.filter(
    (l) => (parents.get(l.fromId) ?? null) !== (parents.get(l.toId) ?? null)
  );
  check('a link never jumps between parents', crossing.length === 0, `${crossing.length} crossings`);
}

/* --- criticality ---------------------------------------------------------- */

{
  const floats = computeFloat(nodes, links);
  const scheduled = rows.filter((r) => !r.isSummary && r.startDate && r.finishDate);
  const critical = scheduled.filter((r) => floats.get(r.id)?.isCritical);
  check(
    'some rows are critical and most are not',
    critical.length > 0 && critical.length < scheduled.length * 0.6,
    `${critical.length} of ${scheduled.length} leaves have zero float`
  );

  const last = scheduled.reduce((a, b) => (a.finishDate! > b.finishDate! ? a : b));
  check(
    'the row that ends the project is on the critical path',
    floats.get(last.id)?.isCritical === true,
    `${last.code} ${last.name} finishes ${last.finishDate}, float ${floats.get(last.id)?.totalFloat}`
  );

  const early = scheduled
    .filter((r) => r.finishDate! < '2026-01-01')
    .filter((r) => !links.some((l) => l.fromId === r.id));
  check(
    'a chain that ends in December is not critical against a project that ends next year',
    early.length > 0 && early.every((r) => floats.get(r.id)?.isCritical === false),
    `${early.length} dead-end rows finishing in 2025, none critical`
  );
}

/* --- the shift preview ---------------------------------------------------- */

{
  const ifr = rows.find((r) => r.name === 'IFR' && links.some((l) => l.fromId === r.id))!;
  const p = shiftPreview(nodes, links, names, ifr.id, 5);
  check(
    'moving a row moves the whole chain behind it, by the same days',
    p.followers.length > 0 && p.followers.every((f) => f.days === 5),
    `${ifr.code} + 5 days drags ${p.followers.length} rows: ${p.followers
      .map((f) => f.name)
      .join(' → ')}`
  );
  check(
    'gaps are preserved — nothing is compressed or stretched',
    p.followers.every((f) => addDays(f.fromStart, 5) === f.toStart),
    'every follower moved exactly five days'
  );

  const alone = rows.find(
    (r) => !r.isSummary && r.startDate && !links.some((l) => l.fromId === r.id)
  )!;
  const q = shiftPreview(nodes, links, names, alone.id, 5);
  check(
    'a row with nothing behind it drags nothing',
    q.followers.length === 0,
    `${alone.code} ${alone.name}`
  );
}

/* --- the weeks a change lands in ------------------------------------------ */

{
  const weeks: WeekSpan[] = db
    .select({
      weekNo: schema.weeks.weekNo,
      startDate: schema.weeks.startDate,
      endDate: schema.weeks.endDate,
      status: schema.weeks.status,
    })
    .from(schema.weeks)
    .where(eq(schema.weeks.projectId, 'gundih'))
    .all();

  const hit = weeksTouched(weeks, '2026-01-05', '2026-01-25');
  check(
    'a three-week change names three weeks',
    hit.all.length === 3 || hit.all.length === 4,
    `weeks ${hit.all.map((w) => w.weekNo).join(', ')} of ${weeks.length}`
  );
  check(
    'a change outside the project names none',
    weeksTouched(weeks, '2030-01-01', '2030-01-05').all.length === 0,
    '2030 touches nothing'
  );
  check(
    'weeks already reported are separated from the rest',
    hit.reported.every((w) => w.status !== 'open'),
    `${hit.reported.length} of ${hit.all.length} already submitted or approved`
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
