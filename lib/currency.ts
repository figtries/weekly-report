/**
 * Money, formatted one way.
 *
 * Four screens were each formatting it themselves, and one of them printed a
 * USD contract through a rupiah formatter — $5.92M came out as "Rp 5.920.000".
 * A figure with the wrong symbol is not a formatting bug, it is a wrong number.
 *
 * Kept out of `lib/project-actions.ts` deliberately: a `'use server'` file may
 * only export async functions, so a plain list there fails the build.
 */

export interface Currency {
  code: string;
  label: string;
  /** What people here call it, in their own words. */
  local: string;
}

/**
 * Short on purpose. A picker with two hundred entries is a picker nobody
 * scrolls, and this is an Indonesian EPC contractor: work is priced in rupiah,
 * and the contracts that are not — Gundih is USD — are dollars.
 */
export const CURRENCIES: Currency[] = [
  { code: 'IDR', label: 'Indonesian Rupiah', local: 'Rupiah' },
  { code: 'USD', label: 'US Dollar', local: 'Dolar AS' },
  { code: 'SGD', label: 'Singapore Dollar', local: 'Dolar Singapura' },
  { code: 'EUR', label: 'Euro', local: 'Euro' },
];

export function isKnownCurrency(code: string): boolean {
  return CURRENCIES.some((c) => c.code === code.toUpperCase());
}

/**
 * Whole units, never cents.
 *
 * A rupiah contract runs to ten digits and its last two are noise; a dollar one
 * is quoted to the dollar. Showing 5,920,000.01 in either invites someone to
 * reconcile a rounding artefact against a signed figure.
 *
 * **Money is grouped with COMMAS**, `SGD 5,920,000`, the way a search engine, a
 * bank statement and every spreadsheet write it. It was regrouped to SI for a
 * while (a narrow space, `SGD 5 920 000`) and on 25 Sep 2026 that was sent
 * back: a price with gaps in it reads as three numbers, not one. The decimal
 * marker is still a point, so a comma here can only ever mean thousands. Plain
 * counts and percentages (`fmtNum` / `fmtPct` in `lib/analysis.ts`) keep SI;
 * this is money only.
 */
export function formatMoney(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // An unknown code must not take the page down with it.
    return `${currency} ${groupThousands(String(Math.round(value)))}`;
  }
}

/** Compact, for a card or a strip where the full figure would crowd everything else. */
export function formatMoneyShort(value: number | null | undefined, currency: string): string {
  if (value == null || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${currency} ${groupThousands(String(Math.round(value)))}`;
  }
}

/** Commas every three digits of a whole number, `5920000` to `5,920,000`. */
function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/* ------------------------------------------- SI grouping, for counts only */

/**
 * The SI thousands separator: a narrow no-break space, never a comma or a dot.
 *
 * SI is explicit that groups of three are separated by a SPACE, precisely
 * because a comma means "decimal point" to half the world and a dot means it to
 * the other half — `5.000` is five thousand in Jakarta and five in London. A
 * space cannot be misread by either.
 *
 * It is no-break so a figure never wraps across a line, and narrow so
 * `5 000 000 000` reads as one number rather than four.
 */
export const SI_SPACE = '\u202f';

/**
 * SI also says a four-digit group is left alone — `1234`, not `1 234` — because
 * isolating a single digit gains nothing and costs a glance. Five digits and up
 * are grouped.
 */
function siGroupWhole(whole: string): string {
  if (whole.replace(/\D/g, '').length <= 4) return whole;
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, SI_SPACE);
}

/** Turn an `en-GB` formatted figure into SI grouping, decimal point untouched. */
export function toSi(formatted: string): string {
  const [whole, ...rest] = formatted.split('.');
  return [siGroupWhole(whole.replace(/,/g, '')), ...rest].join('.');
}

/* ------------------------------------------------------- typing an amount */

/**
 * Thousands separators WHILE the number is being typed.
 *
 * `5000000000` in a box is unreadable — nobody counts ten digits by eye, and
 * the figure printed under it on the same screen already reads US$5,000,000,000.
 * A field that shows one and prints the other is a field people re-check, so
 * the box groups with the same commas `formatMoney` prints, four digits included.
 *
 * The decimal part is left exactly as typed — including a lone trailing dot, so
 * `5000.` does not fight the person about to type the cents.
 */
export function groupAmount(raw: string): string {
  const clean = String(raw ?? '').replace(/[^\d.]/g, '');
  if (clean === '') return '';
  const dot = clean.indexOf('.');
  const whole = dot < 0 ? clean : clean.slice(0, dot);
  const rest = dot < 0 ? '' : clean.slice(dot);
  return groupThousands(whole) + rest;
}

/**
 * Back to something `Number()` accepts, and the separators come straight out.
 *
 * **A DOT FOLLOWED BY EXACTLY THREE DIGITS IS A THOUSANDS SEPARATOR**, provided
 * every dot in the string looks like that. This is an Indonesian contractor:
 * 28.081 is twenty-eight thousand and eighty-one, and reading it as twenty-eight
 * dollars is not a rounding difference, it is three orders of magnitude.
 *
 * It cost a real figure on 14 Sep 2026. A price typed as `28.081` was stored as
 * 28.081, and against a US$1,403,528 contract that row weighed 0.0020% and
 * printed as "0.00% of project" — a row that read as never filled in. Nothing on
 * screen could have caught it either, because `formatMoney` is pinned to
 * `maximumFractionDigits: 0` and this app therefore NEVER DISPLAYS A FRACTION OF
 * A UNIT anywhere. A box that accepts what the rest of the app refuses to show
 * is a box that can only lose information.
 *
 * The rule is all-or-nothing across the string, and that is what keeps the
 * importer's own figures intact: Gundih's contract value `5920000.006405` has
 * six digits after its dot and `842723.7244800002` has ten, so neither matches
 * and both keep every decimal they arrived with. So does `0.97`, and so does a
 * half-typed `5000.`.
 *
 * It also has to hold WHILE SOMEONE IS TYPING, because `MoneyInput` re-reads the
 * box on every keystroke. `1.403.528` collapses to `1403` the moment its first
 * group closes, and the second group is then read against THAT, which is why
 * the leading run is `\d+` and not the `\d{1,3}` a properly formatted number would
 * have. Demanding the canonical form would break the very case this was written
 * for, at the second dot.
 */
export function stripAmount(raw: string): string {
  const clean = String(raw ?? '').replace(/[^\d.]/g, '');
  if (/^\d+(\.\d{3})+$/.test(clean)) return clean.replace(/\./g, '');
  // Otherwise only the first dot is a decimal point; a second one is a typo,
  // not a separator we failed to strip.
  const dot = clean.indexOf('.');
  return dot < 0 ? clean : clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '');
}

/** How many of the characters that survive grouping sit left of the caret. */
export function digitsBeforeCaret(text: string, caret: number): number {
  return (text.slice(0, caret).match(/[\d.]/g) ?? []).length;
}

/**
 * Where the caret belongs after regrouping.
 *
 * Counted in DIGITS rather than characters: inserting a comma to the left of
 * the caret would otherwise push it one place right on every third keystroke,
 * and a ten-digit figure would come out scrambled.
 */
export function caretAfterGrouping(grouped: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < grouped.length; i += 1) {
    if (/[\d.]/.test(grouped[i])) seen += 1;
    if (seen >= digitsBefore) return i + 1;
  }
  return grouped.length;
}
