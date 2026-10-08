/**
 * The Gantt PDF's layout, decided before anything is drawn (8 Oct 2026).
 *
 * Pure, because two places ask it the same question: the print page cuts its
 * sheets with it, and the Download PDF pop-up says "about 7 pages" with it
 * before anyone presses. One answer, so the pop-up cannot promise a file the
 * page does not make.
 *
 * NOTHING IS CUT OFF. A task name that does not fit wraps onto another line and
 * its row grows; the dates and the duration always fit their columns. The row
 * heights are worked out HERE, from Inter's widths, and not read back from the
 * browser: the sheets have to be cut on the server, and the bars and arrows sit
 * on the same heights the table does. The widths are rounded up on purpose, so
 * a wrong guess gives a row a little air and never a third line it has no room
 * for.
 */

const MS_PER_DAY = 86_400_000;

export interface PrintRowLite {
  id: string;
  parentId: string | null;
  depth: number;
  name: string;
  code: string;
  isSummary: boolean;
  isReportingUnit: boolean;
  unitLabel: string | null;
  childCount: number;
}

/** A4 landscape at 96 dpi, less the sheet's print padding (12mm sides, 10/9mm top/bottom). */
export const SHEET = {
  /** 273mm, exactly: the frame's right edge has to meet the title rule's. */
  width: 1031.8,
  /** 191mm of page, less a margin for the renderer's rounding. */
  height: 700,
  header: 58,
  axis: 40,
  footer: 30,
  /** "Continued from …" on a sheet that starts inside a heading. */
  continued: 20,
  lineH: 13,
  rowPad: 9,
  taskW: 300,
  durW: 54,
  dateW: 70,
  indent: 12,
  cellPad: 6,
  font: 11,
} as const;

// Inter's advance widths as a share of the em, rounded UP per class.
const NARROW = new Set("iljfrtI.,:;'!|()[]{}/\\`");
const WIDE = new Set('mwMW@%');
function charEm(c: string): number {
  if (c === ' ') return 0.29;
  if (NARROW.has(c)) return 0.36;
  if (WIDE.has(c)) return 0.9;
  if (c >= '0' && c <= '9') return 0.64;
  if (c >= 'A' && c <= 'Z') return 0.72;
  if (c >= 'a' && c <= 'z') return 0.58;
  return 0.7;
}
/** Text width in px at `SHEET.font`, generous by ~6%. */
export function textWidth(text: string, bold = false, font: number = SHEET.font): number {
  let em = 0;
  for (const c of text) em += charEm(c);
  return em * font * (bold ? 1.1 : 1.06);
}

/** How many lines a name takes in `width` px, wrapping at spaces like the browser does. */
export function nameLines(name: string, width: number, bold = false): number {
  const space = textWidth(' ', bold);
  let lines = 1;
  let used = 0;
  for (const word of name.trim().split(/\s+/)) {
    const w = textWidth(word, bold);
    if (w > width) {
      // One word longer than the column breaks inside itself (overflow-wrap: anywhere).
      if (used > 0) lines += 1;
      lines += Math.ceil(w / width) - 1;
      used = w % width;
      continue;
    }
    if (used === 0) used = w;
    else if (used + space + w <= width) used += space + w;
    else {
      lines += 1;
      used = w;
    }
  }
  return lines;
}

/** Width of the outline-code column, from the longest code printed. */
export function codeWidth(rows: { code: string }[]): number {
  const longest = rows.reduce((m, r) => Math.max(m, textWidth(r.code)), 0);
  return Math.ceil(Math.min(96, Math.max(34, longest + SHEET.cellPad * 2 + 2)));
}

export function rowHeight(row: { name: string; isSummary: boolean }, rel: number): number {
  const width = SHEET.taskW - SHEET.cellPad * 2 - rel * SHEET.indent;
  return nameLines(row.name, width, row.isSummary) * SHEET.lineH + SHEET.rowPad;
}

/** The rows a choice prints, each with its depth below the printed root. */
export function scopeRows<T extends PrintRowLite>(rows: T[], scope: string, levels: number): (T & { rel: number })[] {
  let picked: T[] = rows;
  let rootDepth = 0;
  if (scope !== 'all') {
    const start = rows.findIndex((r) => r.id === scope);
    if (start < 0) return [];
    rootDepth = rows[start].depth;
    let end = start + 1;
    while (end < rows.length && rows[end].depth > rootDepth) end++;
    picked = rows.slice(start, end);
  }
  return picked
    .map((r) => ({ ...r, rel: r.depth - rootDepth }))
    .filter((r) => levels <= 0 || r.rel < levels);
}

/** The deepest level in a choice, so the pop-up offers only levels that exist. */
export function levelsIn(rows: PrintRowLite[], scope: string): number {
  return scopeRows(rows, scope, 0).reduce((m, r) => Math.max(m, r.rel + 1), 0);
}

/**
 * What can be printed on its own: the work packages, or, on a plan with none,
 * its top branches (the same fallback the weekly export uses).
 */
export function packagesOf(rows: PrintRowLite[]): { id: string; label: string }[] {
  const units = rows.filter((r) => r.isReportingUnit);
  const picked = units.length ? units : rows.filter((r) => r.depth === 0 && r.childCount > 0);
  if (!units.length && picked.length < 2) return [];
  return picked.map((r) => ({
    id: r.id,
    label: r.unitLabel && !r.name.includes(r.unitLabel) ? `${r.unitLabel} ${r.name}` : r.name,
  }));
}

/**
 * The key is a grid justified edge to edge, so its columns line up from row to
 * row: as many columns as fit across the sheet, at most six, rows balanced.
 * The 20 is `.gantt-key`'s column gap, the 31 a mark plus the mark's gap.
 */
export function legendColumns(labels: string[]): number {
  const w = labels.map((l) => 31 + textWidth(l, false, 10.5));
  for (let cols = Math.min(6, labels.length); cols > 1; cols--) {
    const c = Math.ceil(labels.length / Math.ceil(labels.length / cols));
    let total = (c - 1) * 20;
    for (let j = 0; j < c; j++) {
      let widest = 0;
      for (let i = j; i < w.length; i += c) widest = Math.max(widest, w[i]);
      total += widest;
    }
    if (total <= SHEET.width - SHEET.cellPad * 2) return c;
  }
  return 1;
}

export function legendHeight(labels: string[]): number {
  return labels.length ? Math.ceil(labels.length / legendColumns(labels)) * 18 + 10 : 0;
}

/**
 * Rows to sheets. A heading is never the last row of a sheet when its first
 * child starts the next one: it moves over with it.
 */
export function paginate(heights: number[], isHeading: boolean[], legendH: number): number[][] {
  const budget = SHEET.height - SHEET.header - SHEET.axis - SHEET.footer - SHEET.continued - legendH;
  const pages: number[][] = [];
  let page: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (page.length && used + h > budget) {
      const moved: number[] = [];
      while (page.length > 1 && isHeading[page[page.length - 1]]) moved.unshift(page.pop()!);
      pages.push(page);
      page = moved;
      used = moved.reduce((a, j) => a + heights[j], 0);
    }
    page.push(i);
    used += h;
  });
  if (page.length || !pages.length) pages.push(page);
  return pages;
}

/** Rough page count for the pop-up, with a two-line key. */
export function estimatePages(rows: PrintRowLite[], scope: string, levels: number): { rows: number; pages: number } {
  const picked = scopeRows(rows, scope, levels);
  const pages = paginate(
    picked.map((r) => rowHeight(r, r.rel)),
    picked.map((r) => r.isSummary),
    18 * 2 + 10
  );
  return { rows: picked.length, pages: picked.length ? pages.length : 0 };
}

// ---------------------------------------------------------------- time axis

const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((utc(b) - utc(a)) / MS_PER_DAY);
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export interface Axis {
  start: string;
  days: number;
  pxPerDay: number;
  /** Years, or months when the scale is weeks. */
  top: { x: number; label: string }[];
  /** Months, quarters' months, or week-start days. */
  bottom: { x: number; label: string }[];
  grid: { x: number; strong: boolean }[];
}

/**
 * The calendar across the sheet: whole months from the first start to the last
 * date anything is drawn on, so a bar never runs off the edge. Labels thin out
 * as the plan gets longer (months, then quarters, then years); a plan short
 * enough to give a week 40px is drawn in weeks instead.
 */
export function axisOf(first: string, last: string, width: number): Axis {
  const s = new Date(utc(first));
  const e = new Date(utc(last));
  const start = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), 1);
  const end = Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 1);
  const days = Math.round((end - start) / MS_PER_DAY);
  const pxPerDay = width / days;
  const x = (t: number) => ((t - start) / MS_PER_DAY) * pxPerDay;
  const top: Axis['top'] = [];
  const bottom: Axis['bottom'] = [];
  const grid: Axis['grid'] = [];

  if (pxPerDay * 7 >= 40) {
    for (let t = start; t < end; ) {
      const d = new Date(t);
      top.push({ x: x(t), label: `${MN[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` });
      grid.push({ x: x(t), strong: true });
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
    // Mondays.
    let t = start + ((8 - new Date(start).getUTCDay()) % 7) * MS_PER_DAY;
    for (; t < end; t += 7 * MS_PER_DAY) {
      bottom.push({ x: x(t), label: iso(t).slice(8) });
      grid.push({ x: x(t), strong: false });
    }
    return { start: iso(start), days, pxPerDay, top, bottom, grid };
  }

  const perMonth = pxPerDay * 30.4;
  const step = perMonth >= 26 ? 1 : perMonth >= 11 ? 3 : 12;
  for (let t = start; t < end; ) {
    const d = new Date(t);
    const m = d.getUTCMonth();
    if (m === 0 || t === start) top.push({ x: x(t), label: String(d.getUTCFullYear()) });
    if (m % step === 0 || (step === 1 && t === start)) bottom.push({ x: x(t), label: step === 12 ? '' : MN[m] });
    if (perMonth >= 6 || m % 3 === 0) grid.push({ x: x(t), strong: m === 0 });
    t = Date.UTC(d.getUTCFullYear(), m + 1, 1);
  }
  return { start: iso(start), days, pxPerDay, top, bottom: bottom.filter((b) => b.label), grid };
}

/** `09 Mar 26`, the planner's own format. */
export function fmtDay(isoDate: string | null): string {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d} ${MN[Number(m) - 1]} ${y.slice(2)}`;
}
