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

/* ------------------------------------------------------------- the network */

const { analyseNetwork, conflictMoves, whySentence, wouldLoop } = await import('../lib/chains.ts');
type NetNode = import('../lib/chains.ts').NetNode;

const node = (id: string, s: string | null, f: string | null, links: NetNode['links'] = null, extra: Partial<NetNode> = {}): NetNode => ({
  id, isLeaf: true, isMilestone: false, startDate: s, finishDate: f, links, ...extra,
});
// The session's 7-row example: A=PFD, B=H&MB (SS+7 from A), C=P&ID (FS from A),
// D=Datasheet (FS from B, starts too early), E=HAZOP (FF+6 from C), M=IFC (FS from E).
const plan: NetNode[] = [
  { id: 'S', isLeaf: false, isMilestone: false, startDate: '2026-03-09', finishDate: '2026-05-16', links: [{ id: 'A', type: 'FS', wait: 0 }] },
  node('A', '2026-03-09', '2026-04-12'),
  node('B', '2026-03-16', '2026-04-19', [{ id: 'A', type: 'SS', wait: 7 }]),
  node('C', '2026-04-13', '2026-05-10', [{ id: 'A', type: 'FS', wait: 0 }]),
  node('D', '2026-04-08', '2026-05-03', [{ id: 'B', type: 'FS', wait: 0 }]),
  node('E', '2026-04-27', '2026-05-16', [{ id: 'C', type: 'FF', wait: 6 }]),
  node('M', '2026-05-16', '2026-05-16', [{ id: 'E', type: 'FS', wait: 0 }], { isMilestone: true }),
];
const net = analyseNetwork(plan);
const r = (id: string) => net.rows.get(id)!;

check('a group row carries no links, even if stored', !net.links.some((l) => l.toId === 'S' || l.fromId === 'S'));
check('after it finishes, 0 slack, sets the date', j(r('C').setsDateBy) === j(['A']), j(r('C').incoming));
check('after it starts + 7, 0 slack, sets the date', j(r('B').setsDateBy) === j(['A']), j(r('B').incoming));
check('finishes after it finishes + 6 sets the date', j(r('E').setsDateBy) === j(['C']), j(r('E').incoming));
check('a milestone may sit on its predecessor finish day', j(r('M').setsDateBy) === j(['E']), j(r('M').incoming));
check('starting too early is a conflict of the exact size', r('D').conflicts.length === 1 && r('D').conflicts[0].slack === -12, j(r('D').conflicts));
check('the project finish is the latest leaf finish', net.projectFinish === '2026-05-16');
check(
  'the finishing chain sets the project finish',
  ['A', 'C', 'E', 'M'].every((id) => r(id).setsProjectFinish),
  j(['A', 'C', 'E', 'M'].map((id) => r(id).canSlip))
);
check('a row nothing waits for gets no figure', r('D').canSlip === null && !r('D').reachesFinish);
check('a row whose only follower does not reach the finish gets no figure', r('B').canSlip === null);

const two = analyseNetwork([
  node('P', '2026-01-01', '2026-01-10'),
  node('Q', '2026-01-05', '2026-01-10'),
  node('R', '2026-01-11', '2026-01-20', [{ id: 'P', type: 'FS', wait: 0 }, { id: 'Q', type: 'FS', wait: 0 }]),
]);
check('two predecessors can both set the date', j(two.rows.get('R')!.setsDateBy) === j(['P', 'Q']));

const branches = (wait: number) =>
  analyseNetwork([
    node('A', '2026-01-01', '2026-01-10'),
    node('B', '2026-01-11', '2026-01-30', [{ id: 'A', type: 'FS', wait: 0 }]),
    node('C', '2026-01-11', '2026-01-20', [{ id: 'A', type: 'FS', wait: 0 }]),
    node('D', '2026-01-31', '2026-02-05', [{ id: 'B', type: 'FS', wait: 0 }, { id: 'C', type: 'FS', wait }]),
  ]);
check('a branch with room can slip by its room', branches(0).rows.get('C')!.canSlip === 10, String(branches(0).rows.get('C')!.canSlip));
check('the longest branch cannot slip', branches(0).rows.get('B')!.canSlip === 0 && branches(0).rows.get('B')!.setsProjectFinish);
check('a wait eats the room', branches(4).rows.get('C')!.canSlip === 6, String(branches(4).rows.get('C')!.canSlip));

const loopNet = analyseNetwork([
  node('A', '2026-01-01', '2026-01-10', [{ id: 'C', type: 'FS', wait: 0 }]),
  node('B', '2026-01-11', '2026-01-20', [{ id: 'A', type: 'FS', wait: 0 }]),
  node('C', '2026-01-21', '2026-01-30', [{ id: 'B', type: 'FS', wait: 0 }]),
]);
check('a stored loop is ignored, one link only', loopNet.ignored.length === 1, j(loopNet.ignored));
const ab = [node('A', '2026-01-01', '2026-01-10'), node('B', '2026-01-11', '2026-01-20', [{ id: 'A', type: 'FS', wait: 0 }])];
check('wouldLoop names the way round', j(wouldLoop(ab, 'B', 'A')) === j(['B', 'A', 'B']), j(wouldLoop(ab, 'B', 'A')));
check('wouldLoop refuses itself', j(wouldLoop(ab, 'A', 'A')) === j(['A', 'A']));
check('no loop, no path', wouldLoop(ab, 'A', 'B') === null);

const names = new Map(plan.map((n) => [n.id, n.id]));
const moves = conflictMoves(plan.map((n) => (n.id === 'A' ? { ...n, finishDate: '2026-04-20' } : n)), ['A'], names);
const mv = new Map(moves.map((m) => [m.id, m]));
check('a later predecessor moves its follower by exactly the overrun', mv.get('C')?.days === 8, j(mv.get('C')));
check('the move cascades', mv.get('E')?.days === 8 && mv.get('M')?.days === 8, j(moves));
check('a follower with room is not moved', !mv.has('B'));
check('a duration is kept', mv.get('C')?.toFinish === '2026-05-18', j(mv.get('C')));
check(
  'nothing is ever moved earlier',
  conflictMoves(plan.map((n) => (n.id === 'A' ? { ...n, finishDate: '2026-04-01' } : n)), ['A'], names).length === 0
);

const nodeMap = new Map(plan.map((n) => [n.id, n]));
const why = (id: string) => whySentence(id, net, nodeMap, names);
check('why: after it finishes', why('C').text === 'Starts 13 Apr because A finishes 12 Apr.', why('C').text);
check('why: after it starts + wait', why('B').text === 'Starts 16 Mar, 7 days after A starts.', why('B').text);
check('why: finishes after it finishes + wait', why('E').text === 'Finishes 16 May, 6 days after C finishes.', why('E').text);
check('why: a conflict is red', why('D').conflict && why('D').text === 'Starts 8 Apr, before B finishes (19 Apr).', why('D').text);
check('why: no links', why('A').text === 'Not linked yet. Its dates are typed.', why('A').text);
const pair = (b: NetNode) => new Map([['A', node('A', '2026-01-01', '2026-01-10')], ['B', b]]);
const ssB = node('B', '2026-01-01', '2026-01-05', [{ id: 'A', type: 'SS', wait: 0 }]);
const ss0 = analyseNetwork([...pair(ssB).values()]);
check('why: after it starts, no wait', whySentence('B', ss0, pair(ssB), new Map([['A', 'A']])).text === 'Starts 1 Jan, when A starts.', whySentence('B', ss0, pair(ssB), new Map([['A', 'A']])).text);
const roomB = node('B', '2026-01-20', '2026-01-25', [{ id: 'A', type: 'FS', wait: 0 }]);
const room = analyseNetwork([...pair(roomB).values()]);
check('why: room', whySentence('B', room, pair(roomB), new Map([['A', 'A']])).text === 'Starts 20 Jan; A would allow 11 Jan.', whySentence('B', room, pair(roomB), new Map([['A', 'A']])).text);

// Budget: the planner reruns this on every date change.
const big: NetNode[] = Array.from({ length: 300 }, (_, i) =>
  node(
    `n${i}`,
    `2026-${String(1 + (i % 12)).padStart(2, '0')}-01`,
    `2026-${String(1 + (i % 12)).padStart(2, '0')}-20`,
    i ? [{ id: `n${Math.floor(i / 2)}`, type: (['FS', 'SS', 'FF'] as const)[i % 3], wait: i % 5 }] : null
  )
);
const t0 = performance.now();
for (let k = 0; k < 100; k += 1) analyseNetwork(big);
const avg = (performance.now() - t0) / 100;
check('analyseNetwork on 300 rows stays under 2 ms', avg < 2, `${avg.toFixed(2)} ms`);

/* --------------------------------------------------- rows carry their links */

const { db, schema } = await import('../lib/sqlite.ts');
const { getSheet } = await import('../lib/sheet.ts');
const { eq } = await import('drizzle-orm');
const linked = db.select().from(schema.wbsNodes).all().find((n) => n.waitsFor && n.waitsFor !== '[]');
if (!linked) throw new Error('the fixture has no linked row; the local database had ten on 7 Oct 2026');
const sheet = getSheet(linked.projectId);
const row = sheet.rows.find((x) => x.id === linked.id)!;
check('a legacy row reads its links in the new shape', Array.isArray(row.links) && row.links.every((l) => l.type === 'FS' && l.wait === 0), j(row.links));
check('a group row never carries links', sheet.rows.filter((x) => x.isSummary).every((x) => x.links === null));
check('no contract yet', sheet.contract === null && sheet.rows.every((x) => x.contractStart === null));
check('a group row has no can-slip figure', sheet.rows.filter((x) => x.isSummary).every((x) => x.totalFloat === null && !x.isCritical));

/* ------------------------------------------------------------ writing links */

const { setLinksSqlite, saveRowLinksSqlite, pruneLinks } = await import('../lib/links-sqlite.ts');
const proj = linked.projectId;
const dated = sheet.rows.filter((x) => x.isLeaf && x.startDate);
if (dated.length < 3) throw new Error('the linked project needs three scheduled activities');
const [L1, L2, L3] = dated;
const branch = sheet.rows.find((x) => x.isSummary)!;
const stored = (id: string) => db.select().from(schema.wbsNodes).where(eq(schema.wbsNodes.id, id)).all()[0].waitsFor;
const refuses = (fn: () => void, word: string) => {
  try {
    fn();
    return false;
  } catch (e) {
    return String((e as Error).message).toLowerCase().includes(word);
  }
};
// Start clean: these three may already hold links in the fixture.
for (const x of [L1, L2, L3]) db.update(schema.wbsNodes).set({ waitsFor: null }).where(eq(schema.wbsNodes.id, x.id)).run();

setLinksSqlite(proj, L2.id, [{ id: L1.id, type: 'SS', wait: 3 }]);
check('a link is stored in the new shape', stored(L2.id) === JSON.stringify([{ id: L1.id, type: 'SS', wait: 3 }]), stored(L2.id) ?? '');
check('itself is refused', refuses(() => setLinksSqlite(proj, L1.id, [{ id: L1.id, type: 'FS', wait: 0 }]), 'itself'));
check('a group row is refused', refuses(() => setLinksSqlite(proj, L1.id, [{ id: branch.id, type: 'FS', wait: 0 }]), 'group'));
check('a loop is refused and named', refuses(() => setLinksSqlite(proj, L1.id, [{ id: L2.id, type: 'FS', wait: 0 }]), 'loop'));
check('an unknown id is refused', refuses(() => setLinksSqlite(proj, L1.id, [{ id: 'nope', type: 'FS', wait: 0 }]), 'not found'));

saveRowLinksSqlite(proj, L2.id, [{ id: L1.id, type: 'FS', wait: 0 }], [{ id: L3.id, type: 'FF', wait: 2 }]);
check('holds up writes into the follower', (parseLinks(stored(L3.id)) ?? []).some((l) => l.id === L2.id && l.type === 'FF' && l.wait === 2), stored(L3.id) ?? '');
saveRowLinksSqlite(proj, L2.id, [{ id: L1.id, type: 'FS', wait: 0 }], []);
check('dropping it from holds up removes it from the follower', !(parseLinks(stored(L3.id)) ?? []).some((l) => l.id === L2.id), stored(L3.id) ?? '');

db.update(schema.wbsNodes).set({ waitsFor: JSON.stringify([{ id: 'gone', type: 'FS', wait: 0 }, { id: L1.id, type: 'FS', wait: 0 }]) }).where(eq(schema.wbsNodes.id, L3.id)).run();
pruneLinks(proj);
check('prune drops a link to a row that no longer exists', j(parseLinks(stored(L3.id))) === j([{ id: L1.id, type: 'FS', wait: 0 }]), stored(L3.id) ?? '');
db.update(schema.wbsNodes).set({ waitsFor: JSON.stringify([{ id: L1.id, type: 'FS', wait: 0 }]) }).where(eq(schema.wbsNodes.id, branch.id)).run();
pruneLinks(proj);
check('prune clears links on a group row', stored(branch.id) === null, String(stored(branch.id)));

/* ==== later tasks append their sections ABOVE this line ==== */

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nall passed');
