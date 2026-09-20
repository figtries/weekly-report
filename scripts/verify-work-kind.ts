/**
 * Proves the four claims the taxonomy makes.
 *
 * One: every built-in ladder closes at 100, because a ladder that does not is a
 * row that can never reach its own finish. Two: a row NAMED after one rung of a
 * ladder is a gate, which is the whole reason 110 of Gundih's 218 rows only ever
 * held 0 or 100. Three: a row named after a system takes the whole ladder. Four:
 * a peer the user has already answered for beats any guess, because the user's
 * own correction is the strongest evidence in the project. Five: the count
 * behind that evidence never includes a peer that disagrees with it — a row
 * spelled the same way but answered differently must not inflate a claim about
 * what the user themselves already decided.
 *
 * No database. Everything is built by hand so a failure here is a failure in
 * `lib/work-kind.ts` and nowhere else.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/verify-work-kind.ts
 */
import {
  agreeingPeers,
  BUILT_IN_KINDS,
  gateLadder,
  guessWorkKind,
  normalizeName,
  shapeOf,
  suggestFromPeers,
} from '../lib/work-kind.ts';

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed += 1;
};

/* 1 — every ladder closes at 100 */
for (const k of BUILT_IN_KINDS) {
  const total = k.steps.reduce((s, m) => s + m.weight, 0);
  check(`${k.label} ladder closes at 100`, Math.abs(total - 100) < 1e-9, `got ${total}`);
  const ids = new Set(k.steps.map((s) => s.id));
  check(`${k.label} step ids are unique`, ids.size === k.steps.length);
}

/* 2 — a row named after a rung is a gate */
const gates: Array<[string, string]> = [
  ['IFR', 'engineering'],
  ['AFC', 'engineering'],
  ['Material On Site', 'procurement'],
  ['Process PO', 'procurement'],
  ['RTS', 'procurement'],
  ['QC Inspection', 'construction'],
];
for (const [name, kindId] of gates) {
  const g = guessWorkKind(name, BUILT_IN_KINDS);
  check(`"${name}" guesses ${kindId}/gate`, g?.kindId === kindId && g?.shape === 'gate', JSON.stringify(g));
}

/* 3 — a row named after a system takes the whole ladder */
const ladders: Array<[string, string]> = [
  ['Turbine Air Inlet System Installation', 'construction'],
  ['Dismantle Exhaust System', 'construction'],
  ['Pre-Commissioning TG-100 (G-1201E)', 'commissioning'],
  ['Start Up & Running Test', 'commissioning'],
];
for (const [name, kindId] of ladders) {
  const g = guessWorkKind(name, BUILT_IN_KINDS);
  check(`"${name}" guesses ${kindId}/steps`, g?.kindId === kindId && g?.shape === 'steps', JSON.stringify(g));
}

/* a name the taxonomy has never seen stays unguessed rather than guessing wrong */
check('unknown name yields null', guessWorkKind('Zebra', BUILT_IN_KINDS) === null);

/* 4 — a peer beats a guess */
const peers = [{ name: 'PO Unprice', kindId: 'construction', shape: 'steps' as const }];
const fromPeer = suggestFromPeers('PO Unprice', peers);
check('exact peer wins', fromPeer?.kindId === 'construction' && fromPeer?.shape === 'steps');
check('peer match ignores case and spacing', suggestFromPeers('po  unprice', peers)?.kindId === 'construction');
check('no peer yields null', suggestFromPeers('Something Else', peers) === null);

/* 5 — the suggestion's own peer count never inflates itself with a peer that
   CONTRADICTS the suggestion. `suggestFromPeers` matches on name alone, so
   two rows spelled "PO Unprice" can have been answered differently; the
   count behind the sentence must only include the ones that actually agree,
   or the app cites a disagreeing row as evidence for a guess it contradicts. */
const hit = { kindId: 'procurement', shape: 'gate' as const };

check(
  'agreeingPeers: a peer matching name, kind AND shape is counted',
  agreeingPeers('PO Unprice', hit, [{ name: 'PO Unprice', kindId: 'procurement', shape: 'gate' }]).length === 1
);
check(
  'agreeingPeers: same name and kind but a DIFFERENT shape does not count',
  agreeingPeers('PO Unprice', hit, [{ name: 'PO Unprice', kindId: 'procurement', shape: 'steps' }]).length === 0
);
check(
  'agreeingPeers: same name but a different kind does not count',
  agreeingPeers('PO Unprice', hit, [{ name: 'PO Unprice', kindId: 'construction', shape: 'gate' }]).length === 0
);
check(
  'agreeingPeers: a different name does not count, even with the same kind and shape',
  agreeingPeers('PO Unprice', hit, [{ name: 'Something Else', kindId: 'procurement', shape: 'gate' }]).length === 0
);
check('agreeingPeers: no peers returns empty rather than throwing', agreeingPeers('PO Unprice', hit, []).length === 0);

/* normalize is what makes 18 identical rows one decision */
check('normalize folds case, spaces and punctuation', normalizeName(' PO  Unprice. ') === 'po unprice');

/* a gate ladder is one rung worth everything */
const gl = gateLadder('Material on site');
check('gate ladder is one rung of 100', gl.length === 1 && gl[0].weight === 100 && gl[0].label === 'Material on site');

/* shapeOf is the piece guessWorkKind leans on, checked directly */
const procurement = BUILT_IN_KINDS.find((k) => k.id === 'procurement')!;
check('shapeOf: rung name is a gate', shapeOf('Material On Site', procurement) === 'gate');
check('shapeOf: system name is steps', shapeOf('Compressor Package', procurement) === 'steps');

/* correction 1 — shapeOf matches a rung EXACTLY, never by prefix. "Start Up &
   Running Test" normalizes to "start up running test", which starts with the
   commissioning stage hint "start up " but names the whole ladder, not the rung. */
const commissioning = BUILT_IN_KINDS.find((k) => k.id === 'commissioning')!;
check('shapeOf: prefix of a stage hint is not a gate', shapeOf('Start Up & Running Test', commissioning) === 'steps');

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
