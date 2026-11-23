/**
 * Proves how the Check screen says WHERE a listed activity sits.
 *
 * A finding on /weekly/[week]/control lists the activities that failed it. The
 * first version printed the last two ancestors under each name and dropped the
 * project unconditionally, which produced three wrongs at once on a real plan
 * (24 Nov 2026): an activity hanging off the root printed no trail at all, so
 * "Backend" the activity and "Backend" the heading read as the same thing; a
 * chain deeper than two was cut with nothing saying it was cut; and the trail
 * repeated under every row of a group.
 *
 * So the trail is now the WHOLE chain, every node is indexed (the two link
 * checks read it too, and they point at nodes that are not leaves), a chain too
 * long to print loses its middle VISIBLY, and the rows are grouped under it.
 *
 * No database. The tree is built by hand so a failure here is a failure in
 * `lib/analysis.ts` and nowhere else.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-check-rows.ts
 */
import type { RollupNode } from '../lib/rollup.ts';
import {
  elideTrail,
  groupFindingRows,
  trailIndex,
  type FindingRow,
} from '../lib/analysis.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

function node(id: string, children: RollupNode[] = []): RollupNode {
  return {
    id,
    parentId: null,
    wbsCode: id,
    deskripsi: id,
    bobot: 0,
    vol: null,
    satuan: null,
    order: 0,
    children,
    isLeaf: children.length === 0,
    depth: 0,
    prevProgressPct: 0,
    prevWF: 0,
    curProgressPct: 0,
    curWF: 0,
    thisWeekProgressPct: 0,
    thisWeekWF: 0,
    targetWF: 0,
    variance: 0,
  } as RollupNode;
}

// P
// ├─ D              a leaf hanging off the root
// └─ A › B › C › L  a leaf four deep
const L = node('L');
const C = node('C', [L]);
const B = node('B', [C]);
const A = node('A', [B]);
const D = node('D');
const P = node('P', [D, A]);

const t = trailIndex([P]);

check('leaf off the root names the project', t.get('D') === 'P', `got ${JSON.stringify(t.get('D'))}`);
check('a branch is indexed too', t.get('A') === 'P', `got ${JSON.stringify(t.get('A'))}`);
check('the chain is whole, root dropped', t.get('L') === 'A › B › C', `got ${JSON.stringify(t.get('L'))}`);

check('three segments print whole', elideTrail('A › B › C') === 'A › B › C');
check('four segments elide the middle', elideTrail('A › B › C › D') === 'A › … › C › D', `got ${elideTrail('A › B › C › D')}`);
check('one segment is untouched', elideTrail('P') === 'P');

const rows: FindingRow[] = [
  { label: 'Server', value: '', trail: 'R › Lucille' },
  { label: 'Payment Gateway', value: '', trail: 'R › Backend' },
  { label: 'Database', value: '', trail: 'R › Lucille' },
  { label: 'Orphan', value: '' },
];
const g = groupFindingRows(rows);

check(
  'group order follows first appearance',
  g.map((x) => x.trail).join('|') === 'R › Lucille|R › Backend|',
  g.map((x) => x.trail).join('|')
);
check('no row is lost or duplicated', g.flatMap((x) => x.rows).length === 4);
check('row order inside a group is kept', g[0].rows.map((r) => r.label).join(',') === 'Server,Database');
check('a row with no trail is still listed', g[2].rows[0].label === 'Orphan');

// Two headings legitimately carry the same description — the WBS does this on
// Gundih ("RTS", "Material On Site"). Grouping is on the WHOLE chain, so they
// must not collapse into one.
const sameLeaf = groupFindingRows([
  { label: 'one', value: '', trail: 'R › A › Work' },
  { label: 'two', value: '', trail: 'R › B › Work' },
]);
check('same last segment, different branch, two groups', sameLeaf.length === 2);

console.log(failed ? `\n${failed} failed` : '\nAll passed');
process.exit(failed ? 1 : 0);
