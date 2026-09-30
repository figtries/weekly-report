import { colToNum, numToCol, parseAddr, parseRange } from './addr';

/**
 * A worksheet's XML, patched in place.
 *
 * NOT a general XML library, and on purpose. The client's workbook has form
 * controls, a legacy drawing, conditional formats and a 5,000-name defined-names
 * table that ExcelJS drops or rewrites; the only way to keep them is to leave
 * every byte we do not mean to change exactly as Excel wrote it. So this parses
 * just enough of `sheetData` to find a row or a cell, keeps each row and each
 * cell as its ORIGINAL text, and re-emits only what was edited. Parsing and
 * serialising without an edit returns the input unchanged.
 *
 * It relies on what Excel writes: `<row ...>` holding `<c ...>` (or `<c .../>`),
 * no CDATA, no comments inside sheetData.
 */

interface Cell {
  addr: string;
  colNum: number;
  /** Attribute name/value pairs, in the order they were written. */
  attrs: Array<[string, string]>;
  /** What sits between <c ...> and </c>, or null for a self-closing cell. */
  inner: string | null;
  /** The original text, reused while the cell is untouched. */
  raw: string | null;
}

interface Row {
  num: number;
  /** The original attribute string of <row ...>, without the brackets. */
  attrs: string;
  cells: Cell[];
  raw: string | null;
  /** True when the row has no cells and was written as <row .../>. */
  selfClosing: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrOf = (attrs: Array<[string, string]>, k: string) => attrs.find(([n]) => n === k)?.[1];

function setAttr(attrs: Array<[string, string]>, k: string, v: string | null) {
  const i = attrs.findIndex(([n]) => n === k);
  if (v === null) {
    if (i >= 0) attrs.splice(i, 1);
    return;
  }
  if (i >= 0) attrs[i][1] = v;
  else attrs.push([k, v]);
}

function parseAttrs(s: string): Array<[string, string]> {
  return [...s.matchAll(/([\w:.-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]] as [string, string]);
}

function cellXml(c: Cell): string {
  if (c.raw !== null) return c.raw;
  const a = c.attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
  return c.inner === null || c.inner === '' ? `<c${a}/>` : `<c${a}>${c.inner}</c>`;
}

function rowXml(r: Row): string {
  if (r.raw !== null) return r.raw;
  const inner = r.cells.map(cellXml).join('');
  return inner ? `<row ${r.attrs.trim()}>${inner}</row>` : `<row ${r.attrs.trim()}/>`;
}

export class SheetXml {
  private pre: string;
  private rows: Row[];
  private post: string;

  // Plain fields, not parameter properties: the verify scripts run this file under
  // node's strip-only TypeScript, which rejects the shorthand.
  private constructor(pre: string, rows: Row[], post: string) {
    this.pre = pre;
    this.rows = rows;
    this.post = post;
  }

  static parse(xml: string): SheetXml {
    const start = xml.indexOf('<sheetData');
    const open = xml.indexOf('>', start) + 1;
    const end = xml.indexOf('</sheetData>');
    const pre = xml.slice(0, open);
    const post = xml.slice(end);
    const body = xml.slice(open, end);
    const rows: Row[] = [];
    for (const m of body.matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
      const attrs = m[1];
      const num = Number(/\br="(\d+)"/.exec(attrs)?.[1]);
      const cells: Cell[] = [];
      if (m[3] !== undefined) {
        for (const c of m[3].matchAll(/<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g)) {
          const a = parseAttrs(c[1]);
          const addr = attrOf(a, 'r') as string;
          cells.push({ addr, colNum: parseAddr(addr).colNum, attrs: a, inner: c[3] ?? null, raw: c[0] });
        }
      }
      rows.push({ num, attrs, cells, raw: m[0], selfClosing: m[2] === '/>' });
    }
    return new SheetXml(pre, rows, post);
  }

  serialize(): string {
    return this.pre + this.rows.map(rowXml).join('') + this.post;
  }

  /* ------------------------------------------------------------- lookup */

  private rowOf(n: number): Row | undefined {
    return this.rows.find((r) => r.num === n);
  }

  private cellOf(addr: string): Cell | undefined {
    const { row } = parseAddr(addr);
    return this.rowOf(row)?.cells.find((c) => c.addr === addr);
  }

  /** Every cell address that exists in the sheet, in document order. */
  addresses(): string[] {
    return this.rows.flatMap((r) => r.cells.map((c) => c.addr));
  }

  has(addr: string): boolean {
    return !!this.cellOf(addr);
  }

  style(addr: string): string | undefined {
    const c = this.cellOf(addr);
    return c ? attrOf(c.attrs, 's') : undefined;
  }

  /** The formula element's text (`8*E17`), or null. Shared-formula children have none. */
  formula(addr: string): string | null {
    const c = this.cellOf(addr);
    const m = c?.inner ? /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(c.inner) : null;
    return m ? m[1] : null;
  }

  /** The raw <v> text of a cell (a number, or an index into the shared strings), or null. */
  rawValue(addr: string): string | null {
    const c = this.cellOf(addr);
    const m = c?.inner ? /<v>([\s\S]*?)<\/v>/.exec(c.inner) : null;
    return m ? m[1] : null;
  }

  /** An inline string's text, or null. Shared strings are not resolved here. */
  inlineText(addr: string): string | null {
    const c = this.cellOf(addr);
    if (!c?.inner || attrOf(c.attrs, 't') !== 'inlineStr') return null;
    return [...c.inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
      .map((m) => m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'))
      .join('');
  }

  /* ---------------------------------------------------------- creation */

  /**
   * The cell, made if it is missing (in column order, in a row made if needed).
   * A new cell takes `style` when given.
   */
  private ensure(addr: string, style?: string): Cell {
    const { row, colNum } = parseAddr(addr);
    let r = this.rowOf(row);
    if (!r) {
      r = { num: row, attrs: `r="${row}"`, cells: [], raw: null, selfClosing: true };
      const at = this.rows.findIndex((x) => x.num > row);
      if (at < 0) this.rows.push(r);
      else this.rows.splice(at, 0, r);
    }
    let c = r.cells.find((x) => x.addr === addr);
    if (!c) {
      c = { addr, colNum, attrs: [['r', addr]], inner: null, raw: null };
      if (style !== undefined) c.attrs.push(['s', style]);
      const at = r.cells.findIndex((x) => x.colNum > colNum);
      if (at < 0) r.cells.push(c);
      else r.cells.splice(at, 0, c);
    }
    r.raw = null;
    r.selfClosing = false;
    c.raw = null;
    return c;
  }

  /* ------------------------------------------------------------ writing */

  /** Text, as an inline string, so the shared string table stays untouched. */
  setText(addr: string, text: string, style?: string): void {
    if (text === '') return this.clear(addr);
    const c = this.ensure(addr, style);
    setAttr(c.attrs, 't', 'inlineStr');
    const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
    c.inner = `<is><t${space}>${esc(text)}</t></is>`;
  }

  /**
   * Rich text as an inline string: each run keeps its own font (`props` is the raw
   * `<rPr>...</rPr>`, copied from the workbook's own runs). The title cell needs it:
   * "DAILY REPORT" is underlined and the work description under it is not.
   */
  setRich(addr: string, runs: Array<{ text: string; props: string }>, style?: string): void {
    const c = this.ensure(addr, style);
    setAttr(c.attrs, 't', 'inlineStr');
    c.inner = `<is>${runs.map((r) => `<r>${r.props}<t xml:space="preserve">${esc(r.text)}</t></r>`).join('')}</is>`;
  }

  setNumber(addr: string, n: number, style?: string): void {
    const c = this.ensure(addr, style);
    setAttr(c.attrs, 't', null);
    c.inner = `<v>${n}</v>`;
  }

  /** Empties the cell but keeps its style, so the printed grid does not change. */
  clear(addr: string): void {
    const c = this.cellOf(addr);
    if (!c) return;
    const r = this.rowOf(parseAddr(addr).row) as Row;
    r.raw = null;
    c.raw = null;
    setAttr(c.attrs, 't', null);
    c.inner = null;
  }

  /**
   * Replaces a formula cell's cached value and keeps its <f> exactly, including a
   * shared formula's ref/si. A viewer that does not recalculate (a phone preview)
   * shows this number, so it has to be the right one.
   */
  setCached(addr: string, value: number | string): void {
    const c = this.ensure(addr);
    const f = c.inner ? /<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/.exec(c.inner)?.[0] : undefined;
    if (!f) throw new Error(`${addr} has no formula to cache a value for`);
    if (typeof value === 'number') {
      setAttr(c.attrs, 't', null);
      c.inner = `${f}<v>${value}</v>`;
    } else {
      setAttr(c.attrs, 't', 'str');
      c.inner = `${f}<v>${esc(value)}</v>`;
    }
  }

  /** Changes a formula's text and keeps its attributes (a shared master's ref and si). */
  setFormulaText(addr: string, text: string): void {
    const c = this.ensure(addr);
    if (!c.inner || !/<f\b/.test(c.inner)) throw new Error(`${addr} has no formula`);
    c.inner = c.inner.replace(/(<f\b[^>]*>)[\s\S]*?(<\/f>)/, `$1${esc(text)}$2`);
  }

  /**
   * Replaces the cell's formula element with a plain `<f>text</f>` (dropping a shared
   * formula's ref/si) and keeps its cached value. A shared group is only safe to
   * replace whole, which is what the HSE cumulative column does.
   */
  setFormula(addr: string, text: string): void {
    const c = this.ensure(addr);
    const f = `<f>${esc(text)}</f>`;
    const inner = c.inner ?? '';
    const re = /<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/;
    c.inner = re.test(inner) ? inner.replace(re, f) : f + inner;
  }

  setStyle(addr: string, style: string): void {
    const c = this.ensure(addr);
    setAttr(c.attrs, 's', style);
  }

  /* --------------------------------------------------------------- rows */

  rowHeight(row: number): number | undefined {
    const r = this.rowOf(row);
    const m = r ? /\bht="([\d.]+)"/.exec(r.attrs) : null;
    return m ? Number(m[1]) : undefined;
  }

  setRowHeight(row: number, ht: number): void {
    const r = this.rowOf(row);
    if (!r) return;
    const v = String(Math.round(ht * 100) / 100);
    let a = r.attrs;
    a = /\bht="[^"]*"/.test(a) ? a.replace(/\bht="[^"]*"/, `ht="${v}"`) : `${a} ht="${v}"`;
    a = /\bcustomHeight="[^"]*"/.test(a) ? a.replace(/\bcustomHeight="[^"]*"/, 'customHeight="1"') : `${a} customHeight="1"`;
    r.attrs = a;
    r.raw = null;
  }

  rowHidden(row: number): boolean {
    return /\bhidden="(1|true)"/.test(this.rowOf(row)?.attrs ?? '');
  }

  /** Excel's own `hidden="1"`: the row's cells, height and every reference to it stay as they are. */
  setRowHidden(row: number): void {
    const r = this.rowOf(row);
    if (!r) return;
    r.attrs = /\bhidden="[^"]*"/.test(r.attrs) ? r.attrs.replace(/\bhidden="[^"]*"/, 'hidden="1"') : `${r.attrs} hidden="1"`;
    r.raw = null;
  }

  /**
   * Copies rows `first`..`last` to start at row `to`, cells and all (styles, heights,
   * borders), replacing whatever rows were there. Merges are the caller's. A formula is
   * refused: its references would need moving too, and a silent copy would point back.
   */
  copyRows(first: number, last: number, to: number): void {
    const shift = to - first;
    const xml = this.rows.filter((r) => r.num >= first && r.num <= last).map(rowXml).join('');
    if (/<f\b/.test(xml)) throw new Error(`rows ${first}-${last} hold a formula; a copy would not move its references`);
    const moved = xml
      .replace(/<row\b([^>]*?)\br="(\d+)"/g, (_, a: string, n: string) => `<row${a}r="${Number(n) + shift}"`)
      .replace(/<c\b([^>]*?)\br="([A-Z]+)(\d+)"/g, (_, a: string, col: string, n: string) => `<c${a}r="${col}${Number(n) + shift}"`);
    const copies = SheetXml.parse(`<sheetData>${moved}</sheetData>`).rows;
    const end = to + (last - first);
    this.rows = this.rows.filter((r) => r.num < to || r.num > end);
    const at = this.rows.findIndex((r) => r.num > end);
    this.rows.splice(at < 0 ? this.rows.length : at, 0, ...copies);
  }

  /** The rows a manual page break follows. */
  rowBreaks(): number[] {
    return [...this.post.matchAll(/<brk\b[^>]*?\bid="(\d+)"/g)].map((m) => Number(m[1]));
  }

  /** Replaces the manual page breaks, keeping the column extent (`max`) the sheet's own breaks use. */
  setRowBreaks(ids: number[]): void {
    const max = /<brk\b[^>]*?\bmax="(\d+)"/.exec(this.post)?.[1] ?? '16383';
    const xml = `<rowBreaks count="${ids.length}" manualBreakCount="${ids.length}">${ids.map((id) => `<brk id="${id}" max="${max}" man="1"/>`).join('')}</rowBreaks>`;
    this.post = /<rowBreaks\b[\s\S]*?<\/rowBreaks>/.test(this.post)
      ? this.post.replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/, xml)
      : this.post.replace(/(<drawing\b|<legacyDrawing\b|<\/worksheet>)/, `${xml}$1`);
  }

  /** Stretches the used-range record (`<dimension>`) down to `row` when the sheet grew past it. */
  extendDimension(row: number): void {
    this.pre = this.pre.replace(/(<dimension ref="[A-Z]+\d+:[A-Z]+)(\d+)"/, (m, head: string, n: string) =>
      Number(n) >= row ? m : `${head}${row}"`
    );
  }

  /* ------------------------------------------------------ columns, merges */

  /** Width in characters of each column, from <cols>; the sheet default elsewhere. */
  colWidth(colNum: number): number {
    for (const m of this.pre.matchAll(/<col\b([^>]*?)\/>/g)) {
      const a = parseAttrs(m[1]);
      const min = Number(attrOf(a, 'min'));
      const max = Number(attrOf(a, 'max'));
      if (colNum >= min && colNum <= max) return Number(attrOf(a, 'width'));
    }
    return Number(/defaultColWidth="([\d.]+)"/.exec(this.pre)?.[1] ?? 8.43);
  }

  merges(): string[] {
    return [...this.post.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1]);
  }

  setMerges(refs: string[]): void {
    const xml = `<mergeCells count="${refs.length}">${refs.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>`;
    this.post = this.post.replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/, xml);
  }

  /** The merged range whose top-left is `addr`, if any. */
  mergeAt(addr: string): string | undefined {
    return this.merges().find((m) => m.split(':')[0] === addr);
  }

  /** Total character width of a merged range (or a single cell). */
  widthOf(ref: string): number {
    const { c1, c2 } = parseRange(ref);
    let w = 0;
    for (let c = c1; c <= c2; c++) w += this.colWidth(c);
    return w;
  }
}

export { colToNum, numToCol };
