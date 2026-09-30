/** A1-style addresses and Excel date serials. Pure. */

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToCol(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface Addr {
  col: string;
  colNum: number;
  row: number;
}

export function parseAddr(a: string): Addr {
  const m = /^([A-Z]+)(\d+)$/.exec(a);
  if (!m) throw new Error(`Bad cell address: ${a}`);
  return { col: m[1], colNum: colToNum(m[1]), row: Number(m[2]) };
}

export interface Range {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

/** "C32:K32" (or a single "C32") as numbers. */
export function parseRange(ref: string): Range {
  const [a, b] = ref.split(':');
  const p = parseAddr(a);
  const q = b ? parseAddr(b) : p;
  return { c1: p.colNum, r1: p.row, c2: q.colNum, r2: q.row };
}

const EPOCH = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

/** "2026-03-12" to the serial Excel stores for that date (46093). Null when it is not an ISO date. */
export function excelSerial(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.round((t - EPOCH) / DAY_MS);
}
