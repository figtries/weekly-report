/**
 * One search rule for every search box in the app (8 Oct 2026).
 *
 * A row matches when EVERY word typed appears somewhere in its fields, in any
 * order, ignoring case, accents and the separators people type differently
 * ("mrb gpf 001" finds MRB-GPF-IN-RPT-001). Callers pass a row's headings as
 * fields too: "ci" then finds every document filed under Civil, where a
 * title-only search showed an empty list, and "civil foundation" narrows it.
 */
export function searchWords(query: string): string[] {
  return fold(query).split(' ').filter(Boolean);
}

/** True when every word is in the fields; no words matches everything. */
export function matchesSearch(words: string[], ...fields: (string | null | undefined)[]): boolean {
  if (words.length === 0) return true;
  const hay = fields.map((f) => (f ? fold(f) : '')).join(' ');
  return words.every((w) => hay.includes(w));
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}
