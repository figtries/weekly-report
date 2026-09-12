/**
 * A project's INITIAL: three letters, derived from its name.
 *
 * EPC project names are sentences. The user's own is seventy characters:
 * "Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah".
 * A project list, a sidebar and a page title all need a handle for that, and
 * asking for one without offering an answer is how an optional field ends up
 * empty on every project.
 *
 * THREE LETTERS, never more. The first version of this allowed twelve and
 * produced "JPICSPUCS" for that name, which is not a handle, it is a second
 * name that happens to be unpronounceable. Three is the length people already
 * write by hand.
 *
 * Two rules, because two shapes of name arrive:
 *
 *   three or more words   the initials of the first three
 *                         "Jasa Pengadaan Instrument …"  -> JPI
 *                         "Relocation of 2 GTG units"    -> RGU
 *
 *   one or two words      the first letter, then the last two consonants
 *                         "Gundih"                       -> GDH
 *                         "CPP Gundih"                    -> CDH
 *
 * The second rule exists because the first has nothing to work with on a
 * one-word name: initials of "Gundih" is "G". Squeezing the vowels out is how
 * people abbreviate a single word anyway, and GDH is the answer the user gave
 * when asked what Gundih should look like.
 *
 * Pure, and deliberately importing nothing. That is what lets
 * `node scripts/verify-initial.ts` run it with no loader, and what lets
 * `NewProjectDialog` import it on the client without pulling server code in.
 *
 * Stored in `projects.alias`. The column keeps that name on purpose: renaming
 * it would mean a second migration through the snapshot-restore path for a
 * word, and `drizzle-kit` has eaten child rows in this repo before when it
 * chose to rebuild a table rather than alter it.
 */

/**
 * Words that carry no identity. Both languages this app is typed in, because
 * the project names are Indonesian and the app around them is English.
 */
const STOPWORDS = new Set([
  'dan',
  'di',
  'ke',
  'untuk',
  'pada',
  'atau',
  'and',
  'of',
  'the',
  'for',
  'in',
  'on',
  'at',
  'to',
]);

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

/** Three. An initial longer than this stops being one. */
export const INITIAL_LENGTH = 3;

export function deriveInitial(name: string): string {
  const tokens = name
    .split(/\s+/)
    // Punctuation first, so "(Phase" contributes P rather than an open
    // bracket and "C-4500" contributes C.
    .map((token) => token.replace(/[^a-z0-9]/gi, ''))
    .filter((token) => token !== '')
    .filter((token) => !STOPWORDS.has(token.toLowerCase()))
    // A token that is only digits is a COUNT, not an identity: the "2" in
    // "Relocation of 2 GTG units" says nothing about which project this is.
    .filter((token) => !/^\d+$/.test(token));

  if (tokens.length === 0) return '';

  if (tokens.length >= INITIAL_LENGTH) {
    return tokens
      .slice(0, INITIAL_LENGTH)
      .map((token) => token[0]!.toUpperCase())
      .join('');
  }

  const letters = tokens.join('').toUpperCase();
  const consonants = [...letters].filter((c) => /[A-Z]/.test(c) && !VOWELS.has(c));
  const built = letters[0]! + consonants.slice(-(INITIAL_LENGTH - 1)).join('');
  // A name too short to hold three consonants gets its own first letters
  // rather than an invented one: "Go" is "GO", not "GOO".
  return built.length >= INITIAL_LENGTH ? built : letters.slice(0, INITIAL_LENGTH);
}
