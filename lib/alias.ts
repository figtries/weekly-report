/**
 * A short name for a project, derived from its long one.
 *
 * EPC project names are sentences. The user's own is seventy characters:
 * "Jasa Pengadaan Instrument dan Control System PHSS Unit C-4500 Samberah".
 * A project list, a sidebar and a page title all need a handle for that, and
 * asking for one without offering an answer is how an optional field ends up
 * empty on every project.
 *
 * So the app guesses, and the guess is INITIALS. Two other rules were put in
 * front of the user with their real outputs shown (distinctive tokens, which
 * would have given "PHSS C-4500"; and the first three words, "Jasa Pengadaan
 * Instrument") and he chose initials knowing it produces "JPICSPUCS". It is a
 * guess he can overwrite in the same breath, which is the only reason a guess
 * this blunt is safe: the field is pre-filled, not decided.
 *
 * Pure, and deliberately importing nothing. That is what lets
 * `node scripts/verify-alias.ts` run it with no loader, and what lets
 * `NewProjectDialog` import it on the client without pulling server code in.
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

/** Past this it stops being a short label and starts being a second name. */
export const ALIAS_MAX_LENGTH = 12;

export function deriveAlias(name: string): string {
  return name
    .split(/\s+/)
    // Punctuation first, so "(Phase" contributes P rather than an open
    // bracket and "C-4500" contributes C.
    .map((token) => token.replace(/[^a-z0-9]/gi, ''))
    .filter((token) => token !== '')
    .filter((token) => !STOPWORDS.has(token.toLowerCase()))
    // A token that is only digits is a COUNT, not an identity: the "2" in
    // "Relocation of 2 GTG units" says nothing about which project this is.
    .filter((token) => !/^\d+$/.test(token))
    .map((token) => token[0]!.toUpperCase())
    .join('')
    .slice(0, ALIAS_MAX_LENGTH);
}
