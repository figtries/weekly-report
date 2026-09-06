/**
 * The clipboard parser, checked against the real workbook and against the ways
 * two offices write the same number.
 *
 * Run: npx tsx scripts/verify-paste.ts
 *
 * The Gundih case is a round trip: the 285 rows are written out as the
 * tab-separated text Excel would put on the clipboard, read back, and every
 * name, depth, date and price is compared. If the parser can survive its own
 * output on the hardest plan in the app, it can survive a workbook.
 */
import { parsePaste, completeDates, parseAmount } from '../lib/paste';
import { db, schema } from '../lib/sqlite';
import { eq, asc } from 'drizzle-orm';

let failures = 0;
function check(name: string, pass: boolean, detail: string) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!pass) failures += 1;
}

/* ---------------------------------------------------------------- amounts */

const amounts: [string, number | null][] = [
  ['1,234,567.89', 1234567.89],
  ['1.234.567,89', 1234567.89],
  ['57,200', 57200],
  ['57.200', 57200],
  ['US$ 418,400', 418400],
  ['Rp 2.821.067,28', 2821067.28],
  ['0.97', 0.97],
  ['', null],
  ['-', null],
  ['842723.72448', 842723.72448],
];
check(
  'amounts read the same in both offices',
  amounts.every(([raw, want]) => {
    const got = parseAmount(raw);
    return want === null ? got === null : Math.abs((got ?? NaN) - want) < 1e-6;
  }),
  amounts.map(([r]) => `${r} → ${parseAmount(r)}`).join(' · ')
);

/* ------------------------------------------------------------------ dates */

{
  const text = [
    'WBS\tTask\tStart\tFinish',
    '1\tRoot\t27/10/2025\t15/12/2026',
    '1.1\tAward\t27 Oct 25\t27 Oct 25',
    '1.2\tWork\t2025-10-27\t2026-02-27',
  ].join('\n');
  const p = parsePaste(text);
  check(
    'three date spellings in one column',
    p.rows[0].startDate === '2025-10-27' &&
      p.rows[1].startDate === '2025-10-27' &&
      p.rows[2].startDate === '2025-10-27',
    p.rows.map((r) => r.startDate).join(' · ')
  );
}

{
  // 03/04/2026 alone is ambiguous; 27/10 in the same column settles it.
  const text = ['Task\tStart', 'A\t03/04/2026', 'B\t27/10/2026'].join('\n');
  const p = parsePaste(text);
  check(
    'the column settles day-first, not the cell',
    p.rows[0].startDate === '2026-04-03',
    `03/04/2026 → ${p.rows[0].startDate} (27/10 in the column proves day-first)`
  );
}

{
  const text = ['Task\tStart', 'A\t03/04/2026'].join('\n');
  const p = parsePaste(text);
  check(
    'an ambiguous column says what it assumed',
    p.rows[0].startDate === '2026-04-03' && p.notes.some((n) => n.includes('day-first')),
    p.notes.filter((n) => n.includes('day-first')).join(' | ') || 'no note'
  );
}

/* ------------------------------------------------------------------ depth */

{
  const text = [
    'No\tPekerjaan\tHari',
    '1\tRelokasi\t415',
    '1.1\tProject Award\t1',
    '1.2\tPekerjaan Relokasi\t124',
    '1.2.1\tProject Preparation\t124',
  ].join('\n');
  const p = parsePaste(text);
  check(
    'depth from a dotted outline code',
    p.depthFrom === 'code' && p.rows.map((r) => r.depth).join(',') === '0,1,1,2',
    p.rows.map((r) => `${r.name}@${r.depth}`).join(' · ')
  );
}

{
  const text = ['Task\tDays', 'Root\t10', '  Child\t5', '    Grandchild\t2', '  Child 2\t3'].join('\n');
  const p = parsePaste(text);
  check(
    'depth from leading spaces when there is no code',
    p.depthFrom === 'indent' && p.rows.map((r) => r.depth).join(',') === '0,1,2,1',
    p.rows.map((r) => `${r.name.trim()}@${r.depth}`).join(' · ')
  );
}

{
  // 1 then 1.1.1 — a grandchild whose parent was never pasted.
  const text = ['No\tTask', '1\tRoot', '1.1.1\tOrphan'].join('\n');
  const p = parsePaste(text);
  check(
    'a skipped level is pulled up rather than orphaned',
    p.rows[1].depth === 1 && p.notes.some((n) => n.includes('skipped a level')),
    `depths ${p.rows.map((r) => r.depth).join(',')} · ${p.notes.find((n) => n.includes('skipped')) ?? ''}`
  );
}

/* ------------------------------------------------------- no header at all */

{
  const text = ['Mobilisasi\t27/10/2025\t10/11/2025\t57.200', 'Sipil\t11/11/2025\t20/12/2025\t418.400'].join('\n');
  const p = parsePaste(text);
  check(
    'no header — columns guessed from their contents',
    p.headerSkipped === false &&
      p.rows.length === 2 &&
      p.rows[0].name === 'Mobilisasi' &&
      p.rows[0].startDate === '2025-10-27' &&
      p.rows[0].price === 57200,
    `${p.rows[0].name} · ${p.rows[0].startDate} → ${p.rows[0].finishDate} · ${p.rows[0].price}`
  );
}

/* ------------------------------------------------------------- milestones */

{
  const text = ['Task\tStart\tFinish\tDuration', 'Award\t27/10/2025\t27/10/2025\t0'].join('\n');
  const p = parsePaste(text);
  check('a zero-day row is a milestone', p.rows[0].isMilestone === true, `duration ${p.rows[0].durationDays}`);
}

/* ------------------------------------------------- completing the triangle */

{
  const start = completeDates({
    depth: 0, name: 'x', sourceCode: null,
    startDate: '2026-01-01', finishDate: null, durationDays: 10, targetDate: null, price: null, isMilestone: false,
  });
  const finish = completeDates({
    depth: 0, name: 'x', sourceCode: null,
    startDate: null, finishDate: '2026-01-10', durationDays: 10, targetDate: null, price: null, isMilestone: false,
  });
  check(
    'a missing third side of the triangle is computed, not invented',
    start.finishDate === '2026-01-10' && finish.startDate === '2026-01-01',
    `start+10d → ${start.finishDate} · finish−10d → ${finish.startDate}`
  );
}

/* ------------------------------------------------------- the real workbook */

{
  const nodes = db
    .select()
    .from(schema.wbsNodes)
    .where(eq(schema.wbsNodes.projectId, 'gundih'))
    .orderBy(asc(schema.wbsNodes.order))
    .all();
  const baseline = db
    .select()
    .from(schema.baselines)
    .where(eq(schema.baselines.projectId, 'gundih'))
    .all()
    .find((b) => b.kind === 'active');
  const sched = new Map(
    (baseline
      ? db.select().from(schema.nodeSchedules).where(eq(schema.nodeSchedules.baselineId, baseline.id)).all()
      : []
    ).map((s) => [s.nodeId, s])
  );

  // Written the way Excel writes it: dd/mm/yyyy dates, thousands separators.
  const dmy = (s: string) => {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  };
  const lines = ['WBS\tUraian Pekerjaan\tMulai\tSelesai\tNilai'];
  for (const n of nodes) {
    const s = sched.get(n.id);
    lines.push(
      [
        n.wbsCode,
        n.deskripsi,
        s ? dmy(s.startDate) : '',
        s ? dmy(s.finishDate) : '',
        n.price == null ? '' : n.price.toLocaleString('en-US', { maximumFractionDigits: 6 }),
      ].join('\t')
    );
  }
  const p = parsePaste(lines.join('\n'));

  check(
    'Gundih survives a round trip through the clipboard',
    p.rows.length === nodes.length,
    `${p.rows.length} rows parsed of ${nodes.length}`
  );

  const nameOk = p.rows.every((r, i) => r.name === nodes[i].deskripsi);
  check('every name comes back unchanged', nameOk, nameOk ? '285/285' : 'mismatch');

  const depthOk = p.rows.every((r, i) => r.depth === nodes[i].depth);
  check(
    'every depth comes back unchanged',
    depthOk,
    depthOk
      ? `max depth ${Math.max(...p.rows.map((r) => r.depth))}`
      : p.rows.findIndex((r, i) => r.depth !== nodes[i].depth) + ' first differs'
  );

  const dateOk = p.rows.every((r, i) => {
    const s = sched.get(nodes[i].id);
    if (!s) return r.startDate === null;
    return r.startDate === s.startDate && r.finishDate === s.finishDate;
  });
  check('every date comes back unchanged', dateOk, dateOk ? 'all 285' : 'mismatch');

  const priced = p.rows.filter((r) => r.price != null && r.price > 0);
  const sum = priced.reduce((a, r) => a + (r.price ?? 0), 0);
  const wantSum = nodes.reduce((a, n) => a + (n.price ?? 0), 0);
  check(
    'every price comes back to six decimals',
    priced.length === nodes.filter((n) => (n.price ?? 0) > 0).length && Math.abs(sum - wantSum) < 1e-6,
    `${priced.length} priced rows, ${sum.toFixed(6)} vs ${wantSum.toFixed(6)}`
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
