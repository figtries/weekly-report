/**
 * One activity waiting for another: the shape stored in `wbs_nodes.waits_for`
 * on the activity that WAITS, and the one parser every reader goes through.
 *
 * Three ways, in the code's own short names (never on screen — see WAY_LABEL):
 *   FS  B starts after A finishes      B.start  ≥ A.finish + 1 + wait
 *   SS  B starts after A starts        B.start  ≥ A.start + wait
 *   FF  B finishes after A finishes    B.finish ≥ A.finish + wait
 * No start-to-finish and no negative wait (decided 7 Oct 2026, spec
 * docs/superpowers/specs/2026-10-07-projects-links-gantt-design.md).
 *
 * NULL means nobody was asked yet (suggestions are offered); [] means "waits
 * for nothing". A bare string id is how links were stored before 7 Oct 2026
 * and reads as FS with no wait. Anything malformed reads as never asked,
 * never as an error.
 */

export type LinkType = 'FS' | 'SS' | 'FF';

export interface StoredLink {
  id: string;
  type: LinkType;
  /** Whole calendar days, 0 or more. */
  wait: number;
}

export const LINK_TYPES: readonly LinkType[] = ['FS', 'SS', 'FF'];

/** What a person reads. The codes never reach the screen. */
export const WAY_LABEL: Record<LinkType, string> = {
  FS: 'After it finishes',
  SS: 'After it starts',
  FF: 'Finishes after it finishes',
};

export const MAX_WAIT = 3650;

export function cleanLink(x: unknown): StoredLink | null {
  if (typeof x === 'string') return x ? { id: x, type: 'FS', wait: 0 } : null;
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) return null;
  if (!LINK_TYPES.includes(o.type as LinkType)) return null;
  const wait = o.wait === undefined ? 0 : o.wait;
  if (typeof wait !== 'number' || !Number.isInteger(wait) || wait < 0 || wait > MAX_WAIT) return null;
  return { id: o.id, type: o.type as LinkType, wait };
}

export function parseLinks(raw: string | null | undefined): StoredLink[] | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out: StoredLink[] = [];
  for (const x of v) {
    const l = cleanLink(x);
    if (!l || seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out;
}

export function serializeLinks(links: StoredLink[]): string {
  return JSON.stringify(links.map((l) => ({ id: l.id, type: l.type, wait: l.wait })));
}
