/**
 * The two signature blocks on a printed report, and the one shape that knows
 * how they are stored.
 *
 * `projects.signature_left` and `projects.signature_right` each hold a JSON
 * `{ company, name }` rather than two columns apiece, because a signature
 * block is two strings and never a relation. Three places need to agree about
 * that: the action that writes one half at a time, the dialog that shows the
 * halves, and `lib/dashboard-db.ts`, which reads the block into the printed
 * report header. It lives here so they cannot drift.
 *
 * Pure, and importing nothing — `lib/project-actions.ts` is a `'use server'`
 * module where every export has to be an async function, so the readers could
 * not live there.
 *
 * Until 12 Sep 2026 these columns were dead weight. `dashboard-db.ts`
 * fabricated a block from `contractorName` and `clientName`, which dropped the
 * signatory's name entirely and put the two sides the wrong way round against
 * the convention the imported project actually prints by: client on the left,
 * contractor on the right.
 */

export interface SignatureBlockValue {
  company: string;
  name: string;
}

/** Which JSON column each editable half lives in, and which key of it. */
export const SIGNATURE_PARTS = {
  signatureLeftCompany: { column: 'signatureLeft', part: 'company' },
  signatureLeftName: { column: 'signatureLeft', part: 'name' },
  signatureRightCompany: { column: 'signatureRight', part: 'company' },
  signatureRightName: { column: 'signatureRight', part: 'name' },
} as const;

export type SignatureField = keyof typeof SIGNATURE_PARTS;

/** The stored block, or an empty one. Malformed JSON reads as empty. */
export function readBlock(raw: string | null): SignatureBlockValue {
  if (!raw) return { company: '', name: '' };
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    return { company: String(v?.company ?? ''), name: String(v?.name ?? '') };
  } catch {
    // A column somebody edited by hand is not worth taking a report down for.
    return { company: '', name: '' };
  }
}

/**
 * The stored block, or null when there is nothing usable in it.
 *
 * Null, malformed, and empty on both halves all mean the same thing to a
 * caller: fall back. A block with a company and no name is legitimate, since
 * the company signs and the person writes their name on the printed rule.
 */
export function parseSignature(raw: string | null): SignatureBlockValue | null {
  const block = readBlock(raw);
  return block.company || block.name ? block : null;
}

/** One half, for a form to show. */
export function signaturePart(
  project: { signatureLeft: string | null; signatureRight: string | null },
  field: SignatureField
): string {
  const { column, part } = SIGNATURE_PARTS[field];
  const block = readBlock(column === 'signatureLeft' ? project.signatureLeft : project.signatureRight);
  return part === 'company' ? block.company : block.name;
}

/** One half written back into the whole block, ready to store. `null` = no block. */
export function mergeSignature(
  current: string | null,
  field: SignatureField,
  value: string
): string | null {
  const { part } = SIGNATURE_PARTS[field];
  const merged = { ...readBlock(current), [part]: value };
  // Both halves empty means "no block", and null is how every reader already
  // asks that question.
  return merged.company || merged.name ? JSON.stringify(merged) : null;
}
