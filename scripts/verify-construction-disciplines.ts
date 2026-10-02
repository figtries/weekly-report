/**
 * Proves the construction disciplines (spec 2026-10-02): every ladder closes,
 * step ids never collide, the guesses a project control engineer would make,
 * today's ladder reading as Other, and the gate rule per discipline.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-construction-disciplines.ts
 */
import { CONSTRUCTION_DISCIPLINES, OTHER, disciplineOf, guessDiscipline } from '../lib/disciplines.ts';
import { BUILT_IN_KINDS, guessWorkKind, shapeOf } from '../lib/work-kind.ts';
import { ladderFor } from '../lib/work-kind-apply.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

check('nine disciplines', CONSTRUCTION_DISCIPLINES.length === 9);
const allIds = CONSTRUCTION_DISCIPLINES.flatMap((d) => d.steps.map((s) => s.id));
check('step ids unique across disciplines', new Set(allIds).size === allIds.length);
for (const d of CONSTRUCTION_DISCIPLINES) {
  const total = d.steps.reduce((s, m) => s + m.weight, 0);
  check(`${d.short} closes at 100`, Math.abs(total - 100) < 1e-9, `got ${total}`);
  check(`${d.short} guards one of its own rungs`, d.steps.some((s) => s.id === d.needs));
  if (d.id !== 'other') check(`${d.short} says when every rung is ticked`, d.steps.every((s) => !!d.tickedWhen[s.id]));
}
const construction = BUILT_IN_KINDS.find((k) => k.id === 'construction')!;
check('Other is today\'s construction ladder', JSON.stringify(OTHER.steps) === JSON.stringify(construction.steps));

const guesses: Array<[string, string, string[]?]> = [
  ['Hydrotest Pipeline (4 Sections)', 'testing'],
  ['Painting Tank T-201', 'painting'],
  ['Painting Pipe Rack', 'painting'],
  ['Pipe Rack Erection', 'steel'],
  ['Piping Erection', 'piping'],
  ['Cable Tray & Cable Laying', 'ei'],
  ['Termination & Insulation Test', 'ei'],
  ['Field Joint Coating', 'pipeline'],
  ['Pondasi Kompresor', 'civil'],
  ['Tie-in Works', 'piping'],
  ['Separator & Vessel Installation', 'mechanical'],
  ['F&G Detector Installation', 'ei'],
  ['Pipe Rack Foundations', 'civil'],
  ['Mobilization and Demobilization', 'other'],
  ['Section 3', 'pipeline', ['Pipeline 6 inch', 'SPK-002 Pipeline and Flowline']],
];
for (const [name, want, ctx] of guesses) {
  const got = guessDiscipline(name, ctx).id;
  check(`"${name}" is ${want}`, got === want, `got ${got}`);
}

check('"Hydrotest" is guessed as Construction', guessWorkKind('Hydrotest', BUILT_IN_KINDS)?.kindId === 'construction');

const pipeline = CONSTRUCTION_DISCIPLINES.find((d) => d.id === 'pipeline')!;
check('"Welding" on the pipeline ladder is a gate', shapeOf('Welding', pipeline) === 'gate');
check('"Lowering & Backfilling" is a gate', shapeOf('Lowering & Backfilling', pipeline) === 'gate');
check('"Pipeline 6 inch KP 0 to KP 4" takes the ladder', shapeOf('Pipeline 6 inch KP 0 to KP 4', pipeline) === 'steps');

const testingLadder = ladderFor('construction', 'steps', 'Hydrotest', BUILT_IN_KINDS, 'testing');
check('ladderFor gives the discipline ladder', testingLadder.map((m) => m.id).join() === 'test-pack,test-fill,test-hold,test-drain');
check('ladderFor without a discipline is unchanged', ladderFor('construction', 'steps', 'X', BUILT_IN_KINDS).map((m) => m.id).join() === 'material,install,connect,qc');
check('ladderFor gate stays a gate', ladderFor('construction', 'gate', 'Welding', BUILT_IN_KINDS, 'pipeline').length === 1);

const stored = (ids: string[]) => ids.map((s) => ({ id: `node-1:${s}` }));
check('disciplineOf reads stored ids', disciplineOf(stored(['test-pack', 'test-fill', 'test-hold', 'test-drain']))?.id === 'testing');
check('today\'s ladder reads as Other', disciplineOf(stored(['material', 'install', 'connect', 'qc']))?.id === 'other');
check('a gate has no discipline', disciplineOf(stored(['done'])) === null);
check('engineering rungs have no discipline', disciplineOf(stored(['ifr', 'ifa', 'afc'])) === null);

import { stageSentence } from '../lib/stage-sentence.ts';
const T = [
  { label: 'Test pack approved', weight: 20 }, { label: 'Filled and pressurized', weight: 30 },
  { label: 'Held and witnessed', weight: 30 }, { label: 'Drained and reinstated', weight: 20 },
];
const s = (actualPct: number, planPct: number) => stageSentence({ steps: T, actualPct, planPct, week: 30 });
check('behind', s(50, 85) === 'Plan has it at Drained and reinstated by week 30. It is at Held and witnessed, one stage behind.', String(s(50, 85)));
check('ahead', s(85, 50) === 'Plan has it at Held and witnessed by week 30. It is already at Drained and reinstated, one stage ahead.', String(s(85, 50)));
check('same stage says nothing', s(55, 70) === null);
check('plan finished', s(50, 100) === 'Plan has it finished by week 30. It is at Held and witnessed, two stages behind.', String(s(50, 100)));
check('not started', s(0, 85) === 'Plan has it at Drained and reinstated by week 30. It has not started, three stages behind.', String(s(0, 85)));
check('plan not started, work ahead', s(25, 0) === 'Plan has not started it by week 30. It is already at Filled and pressurized, one stage ahead.', String(s(25, 0)));
check('finished ahead', s(100, 85) === 'Plan has it at Drained and reinstated by week 30. It is already finished, one stage ahead.', String(s(100, 85)));
check('one rung says nothing', stageSentence({ steps: [T[0]], actualPct: 0, planPct: 100, week: 30 }) === null);
import { forecastChecks } from '../lib/forecast-checks.ts';
import type { WbsItem, WeeklyLeafData } from '../lib/types.ts';
const item = (id: string, parentId: string | null, name: string, extra: Partial<WbsItem> = {}): WbsItem => ({
  id, parentId, wbsCode: id, deskripsi: name, bobot: parentId ? 10 : 0, vol: null, satuan: null, order: Number(id.replace(/\D/g, '')) || 0, ...extra,
});
const rungs = (node: string, ids: string[], w: number[]) => ids.map((s, i) => ({ id: `${node}:${s}`, label: s, weight: w[i] }));
const items: WbsItem[] = [
  item('h1', null, 'Construction'),
  item('n2', 'h1', 'Piping Area A', { workKind: 'construction', progressMethod: 'milestone',
    milestones: rungs('n2', ['piping-erect', 'piping-joint', 'piping-support', 'piping-ndt'], [40, 30, 15, 15]) }),
  item('n3', 'h1', 'Hydrotest Area A', { workKind: 'construction', progressMethod: 'milestone', waitsFor: ['n2'],
    milestones: rungs('n3', ['test-pack', 'test-fill', 'test-hold', 'test-drain'], [20, 30, 30, 20]) }),
];
const run = (pipingDone: string[]) => {
  const leafData: WeeklyLeafData = {
    n2: { cumProgressPct: 0, targetWF: 0, milestonesDone: pipingDone.map((s) => `n2:${s}`) },
    n3: { cumProgressPct: 0, targetWF: 0, milestonesDone: ['n3:test-pack', 'n3:test-fill'] },
  };
  return forecastChecks({ items, leafData, actualByWeek: [], chain: [], leaves: new Map() })
    .filter((c) => c.kind === 'ticked-early');
};
const early = run(['piping-erect']);
check('hydrotest filled while its piping is at 40% is listed', early.length === 1 && early[0].kind === 'ticked-early' && early[0].leafId === 'n3' && early[0].rungLabel === 'test-fill', JSON.stringify(early));
check('not listed once the piping is done', run(['piping-erect', 'piping-joint', 'piping-support', 'piping-ndt']).length === 0);
console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
