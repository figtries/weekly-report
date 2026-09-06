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
    return `${currency} ${Math.round(value).toLocaleString('en-GB')}`;
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
    return `${currency} ${Math.round(value).toLocaleString('en-GB')}`;
  }
}
