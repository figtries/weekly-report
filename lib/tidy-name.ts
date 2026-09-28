/**
 * A name typed in capitals, shown the way every other name on the screen
 * reads. "CONSTRUCTION & INSTALLATION" sat among "Engineering" and
 * "Procurement" on the dashboard as the one line shouting (28 Sep 2026).
 *
 * DISPLAY ONLY, and only a name with no lower-case letter at all: one somebody
 * typed in mixed case is theirs and is left exactly as typed. The stored name
 * is never touched, so the planner edits what was typed and the printed report,
 * which is the client's own format, prints it as typed. Every matcher in the
 * app lowercases first (`normalizeName`), so nothing that reads a name for its
 * meaning sees a difference.
 *
 * Acronyms survive: a word of three letters or fewer, or with no vowel in it
 * (RTS, HSE, PO, PHSS), stays in capitals. Joining words go lower case after
 * the first word, in English and in Indonesian, because both turn up in these
 * plans.
 */

const JOINING = new Set([
  'a', 'an', 'and', 'or', 'of', 'the', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'dan', 'atau', 'di', 'ke', 'dari', 'untuk', 'yang',
]);

export function tidyName(name: string): string {
  if (!/\p{Lu}/u.test(name) || /\p{Ll}/u.test(name)) return name;
  let first = true;
  return name.replace(/\p{L}+/gu, (word, at: number) => {
    const lower = word.toLowerCase();
    const isFirst = first;
    first = false;
    if (!isFirst && JOINING.has(lower)) return lower;
    // "PRE-COMMISSIONING": a short word hyphened onto another is a prefix.
    const prefix = /^-\p{L}/u.test(name.slice(at + word.length));
    if (!prefix && (word.length <= 3 || !/[AEIOUY]/.test(word))) return word;
    return word.charAt(0) + lower.slice(1);
  });
}
