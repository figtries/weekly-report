import type ExcelJS from 'exceljs';

/**
 * Make a built sheet tidy whatever goes into it (25 Oct 2026): a client's
 * long name in a header, a forty-word title, a contractor called "PT Rekayasa
 * Prima Konstruksi". Nothing is ever cut off.
 *
 * Excel does not fit a row to wrapped text written by a library, and a fixed
 * width is a guess about data nobody has seen yet. So this measures every
 * cell after the sheet is filled, in Arial's own proportions:
 * - a column grows to its widest one-line value, up to `maxWidth`;
 * - a header cell (wrapping) widens its column until it needs at most two
 *   lines, and never splits a word;
 * - anything still wider than its column wraps, and the row grows to hold it.
 * Merged cells are measured across the columns they span; a merge over
 * several rows is left at the height its rows already have.
 *
 * ponytail: widths are estimated from per-character Arial ratios, not a font
 * engine; it errs a few percent wide, which reads as breathing room.
 */

// Arial advance widths in em, by kind of character.
function emOf(ch: string): number {
  if (ch === ' ') return 0.28;
  if ('iljtf.,:;|!\'()[]'.includes(ch)) return 0.3;
  if ('mwMW@%'.includes(ch)) return 0.85;
  if (/[A-Z]/.test(ch)) return 0.68;
  if (/[0-9]/.test(ch)) return 0.56;
  return 0.53;
}

const PX_PER_PT = 96 / 72;
/** One unit of Excel column width, in pixels (the default font's "0" plus padding). */
const PX_PER_UNIT = 7;
const PAD_PX = 8;

function textPx(text: string, size: number, bold: boolean): number {
  let em = 0;
  for (const ch of text) em += emOf(ch);
  return em * size * PX_PER_PT * (bold ? 1.08 : 1);
}

/** Greedy word wrap: how many lines `text` takes in `widthPx`. */
function linesIn(text: string, widthPx: number, size: number, bold: boolean): number {
  let lines = 0;
  for (const para of text.split('\n')) {
    let line = 0;
    lines += 1;
    for (const word of para.split(' ')) {
      const w = textPx(word, size, bold);
      const gap = line === 0 ? 0 : textPx(' ', size, bold);
      if (line > 0 && line + gap + w > widthPx) { lines += 1; line = w; } else line += gap + w;
    }
  }
  return lines;
}

/** What the cell shows, near enough: dates and percents as their formats print them. */
function shown(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return '00 Mmm 00';
  if (typeof v === 'number') {
    if (cell.numFmt?.includes('%')) return `+${(v * 100).toFixed(2)}%`;
    return String(v);
  }
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((r) => r.text).join('');
  return String(v);
}

interface Span { top: number; left: number; bottom: number; right: number }

function mergesOf(ws: ExcelJS.Worksheet): Map<string, Span> {
  const out = new Map<string, Span>();
  const col = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  for (const range of ws.model.merges ?? []) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!m) continue;
    const span = { left: col(m[1]), top: Number(m[2]), right: col(m[3]), bottom: Number(m[4]) };
    out.set(`${span.top}:${span.left}`, span);
  }
  return out;
}

export function fitSheet(ws: ExcelJS.Worksheet, opts: { maxWidth?: number; minRowHeight?: number } = {}): void {
  const maxWidth = opts.maxWidth ?? 48;
  const minRow = opts.minRowHeight ?? 15;
  const merges = mergesOf(ws);
  const covered = new Set<string>();
  for (const s of merges.values()) {
    for (let r = s.top; r <= s.bottom; r += 1) for (let c = s.left; c <= s.right; c += 1) {
      if (r !== s.top || c !== s.left) covered.add(`${r}:${c}`);
    }
  }
  const fontOf = (cell: ExcelJS.Cell) => ({ size: cell.font?.size ?? 11, bold: Boolean(cell.font?.bold) });

  // 1. Widths, from cells that sit in one column.
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const key = `${row.number}:${cell.col}`;
      const span = merges.get(key);
      if (covered.has(key) || (span && span.right > span.left)) return;
      const text = shown(cell);
      if (!text) return;
      const { size, bold } = fontOf(cell);
      const column = ws.getColumn(cell.col);
      const current = column.width ?? 9;
      let needPx: number;
      if (cell.alignment?.wrapText) {
        // A header: two lines at most, and no word broken.
        const longestWord = Math.max(...text.split(/[\s\n]+/).map((w) => textPx(w, size, bold)));
        needPx = Math.max(longestWord, textPx(text, size, bold) / 2);
      } else {
        needPx = textPx(text, size, bold);
      }
      const need = Math.min(maxWidth, (needPx + PAD_PX) / PX_PER_UNIT);
      if (need > current) column.width = Math.ceil(need * 2) / 2;
    });
  });

  // 2. Heights: anything wider than its cell wraps, and the row takes its tallest cell.
  ws.eachRow({ includeEmpty: false }, (row) => {
    let tallest = 0;
    row.eachCell({ includeEmpty: false }, (cell) => {
      const key = `${row.number}:${cell.col}`;
      if (covered.has(key)) return;
      const span = merges.get(key);
      if (span && span.bottom > span.top) return;
      const text = shown(cell);
      if (!text) return;
      let widthUnits = 0;
      for (let c = cell.col; c <= (span?.right ?? cell.col); c += 1) widthUnits += ws.getColumn(c).width ?? 9;
      const { size, bold } = fontOf(cell);
      const lines = linesIn(text, widthUnits * PX_PER_UNIT - PAD_PX, size, bold);
      if (lines > 1 && !cell.alignment?.wrapText) cell.alignment = { ...cell.alignment, wrapText: true };
      tallest = Math.max(tallest, lines * size * 1.3 + 4);
    });
    row.height = Math.max(row.height ?? minRow, minRow, Math.ceil(tallest));
  });
}
