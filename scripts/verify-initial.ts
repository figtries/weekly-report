/**
 * Checks the project initial derivation against the names it was designed for.
 *
 * Two cases are the user's own words rather than a guess. "Gundih" -> "GDH" is
 * the example he gave when he asked for three letters, and it is why the
 * one-or-two-word branch exists at all: initials of a single word is one
 * letter. "Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500
 * Samberah" -> "JPI" replaces the twelve-character "JPICSPUCS" the first
 * version produced, which is what made him ask for the cap.
 *
 * Run: node scripts/verify-initial.ts
 */
import { deriveInitial, INITIAL_LENGTH } from '../lib/initial.ts';

const CASES: Array<[name: string, expected: string]> = [
  // One word: first letter, then the last two consonants.
  ['Gundih', 'GDH'],
  ['Samberah', 'SRH'],
  // Two words go down the same branch, on the letters of both.
  ['CPP Gundih', 'CDH'],
  // Three or more: the initials.
  ['Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah', 'JPI'],
  ['Relocation of 2 GTG units', 'RGU'],
  ['Perbaikan dan Penggantian Pipa', 'PPP'],
  // Punctuation is stripped before the first letter is taken, so a bracket
  // never becomes the initial, and a digit-only token is not an identity.
  ['(Phase 2) Retrofit C-4500', 'PRC'],
  // Too short to hold three consonants: its own letters, not an invented one.
  ['Go', 'GO'],
  // Nothing to derive from is not an error. The field is optional, and an
  // empty initial means the UI falls back to the full name.
  ['', ''],
  ['   ', ''],
];

let failed = 0;
for (const [name, expected] of CASES) {
  const got = deriveInitial(name);
  if (got === expected) continue;
  failed += 1;
  console.error(
    `✗ ${JSON.stringify(name)}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(got)}`
  );
}

// The cap is a separate property from the mapping, and it is the whole reason
// this was rewritten: fourteen significant words must not produce a fourteen
// letter "initial".
const long = deriveInitial(
  'Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliett Kilo Lima Mike November'
);
if (long !== 'ABC') {
  failed += 1;
  console.error(`✗ cap: expected ABC, got ${JSON.stringify(long)}`);
}

// Nothing, on any input, may exceed three.
for (const [name] of CASES) {
  const got = deriveInitial(name);
  if (got.length <= INITIAL_LENGTH) continue;
  failed += 1;
  console.error(`✗ ${JSON.stringify(name)} produced ${got.length} letters: ${got}`);
}

if (failed) {
  console.error(`\n${failed} case(s) failed.`);
  process.exit(1);
}
console.log(
  `✓ ${CASES.length} names derive as decided, and nothing exceeds ${INITIAL_LENGTH} letters.`
);
