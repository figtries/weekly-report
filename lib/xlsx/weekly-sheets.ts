import { excelSerial, numToCol } from './addr';
import { coverCrop, imageInfo, type PhotoImage } from './daily-photos';
import { SheetXml } from './sheet-xml';
import { WEEKLY_SKIN, type SkinSheet } from './weekly-skin';
import { TABLE } from './weekly-table-styles';
import type { DetailLine, DetailSheetData, PercentRow, WeeklyExportInput, WeeklyPackage } from './weekly-input';
import type { SCurveRow } from '../scurve';
import { r2, shownDiff } from '../figures';

/**
 * One sheet of the weekly workbook at a time, in the sample's look (lib/xlsx/weekly-skin.ts).
 *
 * The sample's own rows are the templates: a row of the kind being written is copied
 * for its styles and height and filled with VALUES, never formulas (the sample's
 * formulas all read `Data Overall`, which does not travel). The row numbers below are
 * the sample's, and they are the whole cell map.
 */

const SUMMARY = { headerLast: 11, data: 12, spacer: 13, tailFirst: 19, tailLast: 22, total: 21, lastSampleData: 18 } as const;
const DETAIL = { headerLast: 14, root: 15, bare: 16, package: 17, heading: 18, activity: 19, total: 300, first: 15 } as const;
/**
 * The S-curve sheet. The figure table sits right of the print area, as in the
 * sample, on rows 6 to 12: all of them the sheet's default height, so the table is
 * one even block whose rows never move the printed page above it (3 Oct 2026).
 */
const SCURVE = {
  last: 35,
  dataCol: 20 /* T */,
  labelCol: 'S',
  titleCell: 'S5',
  row: { week: 6, date: 7, plan: 8, cumPlan: 9, actual: 10, cumActual: 11, deviation: 12 },
} as const;

/** Even columns for the table: a narrow gap, the labels, then one width for every week. */
function tableCols(pre: string, weeks: number): string {
  return pre.replace(/<cols>([\s\S]*?)<\/cols>/, (_, inner: string) => {
    const kept = (inner.match(/<col\b[^>]*\/>/g) ?? []).filter((c) => Number(/\bmax="(\d+)"/.exec(c)?.[1] ?? 0) < 18);
    return (
      '<cols>' +
      kept.join('') +
      '<col min="18" max="18" width="2.6" customWidth="1"/>' +
      '<col min="19" max="19" width="15.6" customWidth="1"/>' +
      `<col min="20" max="${19 + weeks}" width="9.6" customWidth="1"/>` +
      '</cols>'
    );
  });
}

const DOC = { pageRows: 46 } as const;

// ------------------------------------------------------------------ rows

type Value = { t: string } | { n: number } | null;
interface TplCell { col: string; s: string | null }
interface Tpl { attrs: string; cells: TplCell[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tpl(sheet: SkinSheet, row: number): Tpl {
  const xml = sheet.rows[String(row)];
  if (!xml) throw new Error(`the skin has no row ${row}`);
  const attrs = /^<row\b([^>]*?)\/?>/.exec(xml)![1].replace(/\s*\br="\d+"/, '').trim();
  const cells = [...xml.matchAll(/<c\b([^>]*?)(?:\/>|>)/g)].map((m) => ({
    col: /\br="([A-Z]+)\d+"/.exec(m[1])![1],
    s: /\bs="(\d+)"/.exec(m[1])?.[1] ?? null,
  }));
  return { attrs, cells };
}

function cellXml(addr: string, s: string | null, v: Value): string {
  const st = s ? ` s="${s}"` : '';
  if (v && 't' in v) return v.t === '' ? `<c r="${addr}"${st}/>` : `<c r="${addr}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v.t)}</t></is></c>`;
  if (v && 'n' in v && Number.isFinite(v.n)) return `<c r="${addr}"${st}><v>${v.n}</v></c>`;
  return `<c r="${addr}"${st}/>`;
}

/** A template row written at `r`, its cells filled from `values` (by column letter). */
function fillRow(t: Tpl, r: number, values: Record<string, Value> = {}): string {
  const cells = t.cells.map((c) => cellXml(`${c.col}${r}`, c.s, values[c.col] ?? null)).join('');
  return `<row r="${r}"${t.attrs ? ' ' + t.attrs : ''}>${cells}</row>`;
}

/** A skin row as it is (header rows), moved to `r`. */
function moveRow(sheet: SkinSheet, from: number, to: number): string {
  const xml = sheet.rows[String(from)];
  if (!xml) return '';
  return xml
    .replace(/<row\b([^>]*?)\br="\d+"/, `<row$1r="${to}"`)
    .replace(/<c\b([^>]*?)\br="([A-Z]+)\d+"/g, (_, a: string, col: string) => `<c${a}r="${col}${to}"`);
}

const pct = (v: number | null | undefined): Value => (v === null || v === undefined ? null : { n: Number((v / 100).toFixed(8)) });
const txt = (s: string | null | undefined): Value => (s ? { t: s } : null);

function assemble(skin: SkinSheet, rows: string[], lastRow: number, lastCol: string, post?: (p: string) => string): string {
  const firstCol = /<dimension ref="([A-Z]+)\d+/.exec(skin.pre)?.[1] ?? 'A';
  const pre = skin.pre.replace(/<dimension ref="[^"]*"/, `<dimension ref="${firstCol}1:${lastCol}${lastRow}"`);
  return pre + rows.join('') + (post ? post(skin.post) : skin.post);
}

function setMerges(post: string, merges: string[]): string {
  const xml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return /<mergeCells\b[\s\S]*?<\/mergeCells>/.test(post)
    ? post.replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/, xml)
    : post.replace('</sheetData>', `</sheetData>${xml}`);
}

const skinMerges = (s: SkinSheet) => [...s.post.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1]);

export interface WrittenSheet {
  name: string;
  xml: string;
  printArea: string;
  printTitles?: string;
  chart?: ChartSpec;
  photos?: PlacedPhoto[];
}

// ------------------------------------------------------------------ Summary

export function summarySheet(input: WeeklyExportInput): WrittenSheet {
  const sk = WEEKLY_SKIN.sheets.summary;
  const rows: string[] = [];
  for (let r = 1; r <= SUMMARY.headerLast; r += 1) rows.push(moveRow(sk, r, r));
  const data = tpl(sk, SUMMARY.data);
  const spacer = tpl(sk, SUMMARY.spacer);
  const lines = input.summary.rows;
  let r = SUMMARY.data;
  lines.forEach((row, i) => {
    rows.push(fillRow(data, r, {
      A: { n: row.no }, B: txt(row.text), C: pct(row.bobot),
      D: pct(row.prevProgress), E: pct(row.prevWF), F: pct(row.thisProgress), G: pct(row.thisWF),
      H: pct(row.curProgress), I: pct(row.curWF), J: pct(row.target), K: pct(row.variance),
    }));
    if (i < lines.length - 1) rows.push(fillRow(spacer, r + 1));
    r += 2;
  });
  const lastData = SUMMARY.data + 2 * Math.max(0, lines.length - 1);
  const shift = lastData - SUMMARY.lastSampleData;
  const t = input.summary.total;
  for (let s: number = SUMMARY.tailFirst; s <= SUMMARY.tailLast; s += 1) {
    const values: Record<string, Value> = s === SUMMARY.total
      ? { C: pct(t.bobot), E: pct(t.prevWF), G: pct(t.thisWF), I: pct(t.curWF), J: pct(t.target), K: pct(t.variance) }
      : {};
    rows.push(fillRow(tpl(sk, s), s + shift, values));
  }
  const last = SUMMARY.tailLast + shift;
  const sheet = SheetXml.parse(assemble(sk, rows, last, 'K'));
  sheet.setText('A2', `WEEKLY REPORT NO.${input.week}`);
  sheet.setText('A3', input.project.name.toUpperCase());
  sheet.setText('A4', input.periodText);
  return { name: 'Summary Overall', xml: sheet.serialize(), printArea: `$A$1:$K$${last}` };
}

// ------------------------------------------------------------------ Detail

function detailRow(line: DetailLine, r: number): string {
  const sk = WEEKLY_SKIN.sheets.detail;
  const at =
    line.kind === 'root' ? DETAIL.root
    : line.kind === 'package' ? DETAIL.package
    : line.kind === 'heading' ? DETAIL.heading
    : line.figures ? DETAIL.activity : DETAIL.bare;
  const f = line.figures;
  const values: Record<string, Value> = { A: txt(line.wbs), B: txt(line.text), C: pct(line.bobot) };
  if (f) {
    Object.assign(values, {
      D: line.vol === null ? null : { n: line.vol }, E: txt(line.satuan),
      F: pct(f.prevProgress), G: pct(f.prevWF), H: pct(f.thisProgress), I: pct(f.thisWF),
      J: pct(f.curProgress), K: pct(f.curWF), L: pct(f.target), M: pct(f.variance),
    });
  }
  return fillRow(tpl(sk, at), r, values);
}

export function detailSheet(input: WeeklyExportInput, data: DetailSheetData, pkg: WeeklyPackage | null): WrittenSheet {
  const sk = WEEKLY_SKIN.sheets.detail;
  const rows: string[] = [];
  for (let r = 1; r <= DETAIL.headerLast; r += 1) rows.push(moveRow(sk, r, r));
  data.lines.forEach((line, i) => rows.push(detailRow(line, DETAIL.first + i)));
  const totalRow = DETAIL.first + data.lines.length;
  const t: PercentRow = data.total;
  rows.push(fillRow(tpl(sk, DETAIL.total), totalRow, {
    A: { t: 'Grand Total' }, C: pct(t.bobot), G: pct(t.prevWF), I: pct(t.thisWF), K: pct(t.curWF), L: pct(t.target), M: pct(t.variance),
  }));
  const merges = skinMerges(sk).filter((m) => !m.startsWith(`A${DETAIL.total}:`)).concat(`A${totalRow}:B${totalRow}`);
  const xml = assemble(sk, rows, totalRow, 'M', (post) =>
    setMerges(post, merges).replace(/<autoFilter ref="[^"]*"/, `<autoFilter ref="A${DETAIL.headerLast}:M${totalRow - 1}"`)
  );
  const sheet = SheetXml.parse(xml);
  const p = input.project;
  const contracts = pkg
    ? pkg.contractNo ?? ''
    : input.packages.map((x) => x.contractNo).filter(Boolean).join(', ') || p.contractNo;
  sheet.setText('A2', pkg ? `DETAIL PROGRESS ${pkg.contractNo ?? pkg.label}` : 'DETAIL OVERALL PROGRESS');
  sheet.setText('A6', `CONTRACT NO   :  ${contracts}`);
  sheet.setText('A7', `PROJECT NAME  : ${(pkg ? pkg.label : p.name).toUpperCase()}`);
  sheet.setText('A8', `CUSTOMER          : ${p.customer}`);
  sheet.setText('I6', `W${input.week}`);
  sheet.setText('I7', input.periodText);
  return {
    name: pkg ? `Detail ${pkg.sheetSuffix}` : 'Detail Overall',
    xml: sheet.serialize(),
    printArea: `$A$${DETAIL.headerLast}:$M$${totalRow}`,
    printTitles: '$1:$13',
  };
}

// ------------------------------------------------------------------ S-Curve

export interface ChartSpec {
  /** The S-curve's points: week 0 at 0, then every week up to the exported one. */
  points: Array<{ serial: number; plan: number | null; actual: number | null }>;
  /** Cell refs on this sheet (without the sheet name). */
  planTx: string;
  actualTx: string;
  cat: string;
  planVal: string;
  actualVal: string;
}

export function scurveSheet(input: WeeklyExportInput, series: SCurveRow[], pkg: WeeklyPackage | null): WrittenSheet {
  // The numbers the chart reads, first: the table's columns are sized to them.
  const points: ChartSpec['points'] = [{ serial: excelSerial(input.scurve.weekEnds[0])!, plan: 0, actual: 0 }];
  for (const row of series) {
    const end = input.scurve.weekEnds[row.week];
    if (!end) continue;
    points.push({
      serial: excelSerial(end)!,
      plan: row.planPct === null ? null : r2(row.planPct),
      actual: row.actualPct === null ? null : r2(row.actualPct),
    });
  }

  const sk = { ...WEEKLY_SKIN.sheets.scurve, pre: tableCols(WEEKLY_SKIN.sheets.scurve.pre, points.length) };
  const rows: string[] = [];
  for (let r = 1; r <= SCURVE.last; r += 1) rows.push(moveRow(sk, r, r));
  const sheet = SheetXml.parse(assemble(sk, rows, SCURVE.last, 'P'));
  const p = input.project;
  // Named as the project names the work package (3 Oct 2026), not by its code alone.
  const name = pkg ? pkg.label : 'Overall';
  sheet.setText('B1', `PROGRESS S-CURVE ${name.toUpperCase()}`);
  sheet.setText('H3', `W${input.week}`);
  sheet.setNumber('H4', excelSerial(input.periodStart)!);
  sheet.setNumber('K4', excelSerial(input.periodEnd)!);
  sheet.setText('D28', p.signatureLeft.company);
  sheet.setText('L28', p.signatureRight.company);
  sheet.setText('D33', p.signatureLeft.name);
  sheet.setText('L33', p.signatureRight.name);

  // The figure table: one block, every cell bordered alike, a grey header band,
  // the chart's red on the plan rows and its blue on the actual ones. The labels
  // name what each row is; no formula is written into them or into any cell.
  const R = SCURVE.row;
  const xf = TABLE.xf;
  sheet.setText(SCURVE.titleCell, name, xf.title);
  const label = (r: number, text: string, style: string) => sheet.setText(`${SCURVE.labelCol}${r}`, text, style);
  label(R.week, 'Week NO', xf.headLabel);
  label(R.date, 'Week ending', xf.headLabel);
  label(R.plan, 'PLAN', xf.planLabel);
  label(R.cumPlan, 'CUM. PLAN', xf.planLabel);
  label(R.actual, 'ACTUAL', xf.actualLabel);
  label(R.cumActual, 'CUM. ACTUAL', xf.actualLabel);
  label(R.deviation, 'DEVIATION', xf.devLabel);
  const put = (addr: string, v: number | null, style: string) =>
    v === null ? sheet.setStyle(addr, xf.blank) : sheet.setNumber(addr, v, style);
  points.forEach((pt, w) => {
    const col = numToCol(SCURVE.dataCol + w);
    const prev = points[w - 1];
    sheet.setNumber(`${col}${R.week}`, w, xf.headWeek);
    sheet.setNumber(`${col}${R.date}`, pt.serial, xf.headDate);
    const plan = pt.plan;
    const actual = pt.actual;
    put(`${col}${R.plan}`, plan === null ? null : (prev && prev.plan !== null ? shownDiff(plan, prev.plan) : plan) / 100, xf.pct);
    put(`${col}${R.cumPlan}`, plan === null ? null : plan / 100, xf.pct);
    put(`${col}${R.actual}`, actual === null ? null : (prev && prev.actual !== null ? shownDiff(actual, prev.actual) : actual) / 100, xf.pct);
    put(`${col}${R.cumActual}`, actual === null ? null : actual / 100, xf.pct);
    put(`${col}${R.deviation}`, actual === null || plan === null ? null : shownDiff(actual, plan) / 100, xf.dev);
  });
  const lastCol = numToCol(SCURVE.dataCol + points.length - 1);
  const range = (r: number) => `$${numToCol(SCURVE.dataCol)}$${r}:$${lastCol}$${r}`;
  return {
    name: pkg ? `S-Curve ${pkg.sheetSuffix}` : 'S-Curve Overall',
    xml: sheet.serialize().replace(/<dimension ref="[^"]*"/, `<dimension ref="B1:${lastCol}${SCURVE.last}"`),
    printArea: '$B$1:$P$35',
    chart: {
      points,
      planTx: `$S$${R.cumPlan}`,
      actualTx: `$S$${R.cumActual}`,
      cat: range(R.date),
      planVal: range(R.cumPlan),
      actualVal: range(R.cumActual),
    },
  };
}

// ------------------------------------------------------------------ Documentation

export interface PlacedPhoto {
  bytes: Buffer;
  info: PhotoImage;
  /** 0-based cell anchors, EMU offsets. */
  from: { col: number; row: number; colOff: number; rowOff: number };
  to: { col: number; row: number; colOff: number; rowOff: number };
  cx: number;
  cy: number;
  crop: string;
}

const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
const INSET_PX = 12;
const WIDTH_SPREAD = 1.043; // see lib/xlsx/daily-photos.ts
const colPx = (chars: number) => Math.trunc(((256 * chars + Math.trunc(128 / 7)) / 256) * 7);
/** Three bands of two boxes on the sample's page (rows and columns 1-based, inclusive). */
const BOXES = [
  { r1: 9, r2: 21, c1: 1, c2: 5 }, { r1: 9, r2: 21, c1: 6, c2: 10 },
  { r1: 22, r2: 33, c1: 1, c2: 5 }, { r1: 22, r2: 33, c1: 6, c2: 10 },
  { r1: 34, r2: 45, c1: 1, c2: 5 }, { r1: 34, r2: 45, c1: 6, c2: 10 },
];

export function documentationSheet(photos: Buffer[]): WrittenSheet {
  const sk = WEEKLY_SKIN.sheets.documentation;
  const usable = photos
    .map((bytes) => ({ bytes, info: imageInfo(bytes) }))
    .filter((p): p is { bytes: Buffer; info: PhotoImage } => p.info !== null);
  const pages = Math.max(1, Math.ceil(usable.length / BOXES.length));
  const rows: string[] = [];
  for (let page = 0; page < pages; page += 1) {
    for (let r = 1; r <= DOC.pageRows; r += 1) rows.push(moveRow(sk, r, r + page * DOC.pageRows));
  }
  const last = pages * DOC.pageRows;
  const merges = Array.from({ length: pages }, (_, page) =>
    skinMerges(sk).map((m) => m.replace(/\d+/g, (n) => String(Number(n) + page * DOC.pageRows)))
  ).flat();
  const breaks = Array.from({ length: pages - 1 }, (_, i) => (i + 1) * DOC.pageRows);
  const xml = assemble(sk, rows, last, 'J', (post) => {
    let out = setMerges(post, merges);
    // The sample fits its one page to the paper (fitToPage, one tall). Each copy of the
    // page is a page of its own, so the fit is one wide and `pages` tall; fitting the
    // width alone let every page spill its last row of photos onto the next sheet.
    out = out.replace(/<pageSetup\b([^>]*?)\/>/, (_, a: string) => `<pageSetup${a.replace(/\s+fitTo(Width|Height)="\d+"/g, '')} fitToWidth="1" fitToHeight="${pages}"/>`);
    if (breaks.length) {
      out = out.replace(/(<drawing\b|<legacyDrawing\b|<\/worksheet>)/, `<rowBreaks count="${breaks.length}" manualBreakCount="${breaks.length}">${breaks.map((b) => `<brk id="${b}" max="16383" man="1"/>`).join('')}</rowBreaks>$1`);
    }
    return out;
  });
  const sheet = SheetXml.parse(xml);
  const rowHt = (r: number) => sheet.rowHeight(((r - 1) % DOC.pageRows) + 1) ?? 13.2;
  const inset = INSET_PX * EMU_PER_PX;

  const placed: PlacedPhoto[] = usable.map(({ bytes, info }, i) => {
    const down = Math.floor(i / BOXES.length) * DOC.pageRows;
    const b = BOXES[i % BOXES.length];
    let wPx = 0;
    for (let c = b.c1; c <= b.c2; c += 1) wPx += colPx(sheet.colWidth(c));
    let hPt = 0;
    for (let r = b.r1; r <= b.r2; r += 1) hPt += rowHt(r + down);
    const innerW = wPx - 2 * INSET_PX;
    const innerH = (hPt * 96) / 72 - 2 * INSET_PX;
    const drawnW = wPx * WIDTH_SPREAD - 2 * INSET_PX;
    return {
      bytes,
      info,
      from: { col: b.c1 - 1, row: b.r1 - 1 + down, colOff: inset, rowOff: inset },
      to: {
        col: b.c2 - 1,
        row: b.r2 - 1 + down,
        colOff: colPx(sheet.colWidth(b.c2)) * EMU_PER_PX - inset,
        rowOff: Math.round(rowHt(b.r2 + down) * EMU_PER_PT) - inset,
      },
      cx: Math.round(innerW * EMU_PER_PX),
      cy: Math.round(innerH * EMU_PER_PX),
      crop: coverCrop(info.width, info.height, drawnW, innerH),
    };
  });
  return { name: 'Documentation', xml: sheet.serialize(), printArea: `$A$1:$J$${last}`, photos: placed };
}
