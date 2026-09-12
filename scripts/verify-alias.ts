/**
 * Checks the project alias derivation against the names it was designed for.
 *
 * The first case is the real one: the user's own workbook,
 * "Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah".
 * He chose initials over the alternatives with that exact output in front of
 * him, so the expected value below is a decision, not a guess.
 *
 * Run: node scripts/verify-alias.ts
 */
import { deriveAlias, ALIAS_MAX_LENGTH } from '../lib/alias.ts';

const CASES: Array<[name: string, expected: string]> = [
  ['Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah', 'JPICSPUCS'],
  ['Relocation of 2 GTG units', 'RGU'],
  ['CPP Gundih', 'CG'],
  // Punctuation is stripped before the first letter is taken, so a bracket
  // never becomes the alias.
  ['(Phase 2) Retrofit C-4500', 'PRC'],
  // Nothing to derive from is not an error. The field is optional, and an
  // empty alias means the UI falls back to the full name.
  ['', ''],
  ['   ', ''],
  // Stopwords go, in both languages this app is typed in.
  ['Perbaikan dan Penggantian Pipa', 'PPP'],
  // Runs of whitespace are one separator, not several empty tokens.
  ['Alpha    Bravo', 'AB'],
];

let failed = 0;
for (const [name, expected] of CASES) {
  const got = deriveAlias(name);
  if (got === expected) continue;
  failed += 1;
  console.error(
    `✗ ${JSON.stringify(name)}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(got)}`
  );
}

// The cap is a separate property from the mapping: fourteen significant words
// must not produce a fourteen-character "short" label.
const long = deriveAlias(
  'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November'
);
if (long.length !== ALIAS_MAX_LENGTH) {
  failed += 1;
  console.error(`✗ cap: expected ${ALIAS_MAX_LENGTH} characters, got ${long.length} (${long})`);
}
if (long !== 'ABCDEFGHIJKL') {
  failed += 1;
  console.error(`✗ cap: expected ABCDEFGHIJKL, got ${long}`);
}

if (failed) {
  console.error(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log(
  `✓ ${CASES.length} names derive as decided, and the ${ALIAS_MAX_LENGTH}-character cap holds.`
);
