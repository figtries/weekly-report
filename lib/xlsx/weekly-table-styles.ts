import { WEEKLY_SKIN } from './weekly-skin';

/**
 * The S-curve sheet's figure table, drawn in ONE style set (3 Oct 2026).
 *
 * The table beside the chart used the sample's styles cell by cell: 8pt rotated
 * dates beside 9pt figures, borders on some cells and not on the gaps between the
 * blocks, and two date columns that Excel could only show as "######". He asked for
 * it neat and even: "semua sama designnya rata ... border border semua". So these
 * few styles are the app's own, appended to the sample's stylesheet (whose
 * existing indices stay where they are, so nothing else in the workbook moves):
 * one thin light-grey border on every cell, a grey header band, the chart's red
 * on the plan labels and its blue on the actual ones, and a deviation that turns
 * red below zero.
 */

const FONTS = {
  body: '<font><sz val="10"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
  bold: '<font><b/><sz val="10"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
  title: '<font><b/><sz val="12"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
  // The chart's own colours: plan red, actual blue (lib/xlsx/weekly-export.ts).
  plan: '<font><b/><sz val="10"/><color rgb="FFC00000"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
  actual: '<font><b/><sz val="10"/><color rgb="FF0070C0"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>',
};

const HEADER_FILL = '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>';
const LINE = '<color rgb="FFBFBFBF"/>';
const GRID =
  `<border><left style="thin">${LINE}</left><right style="thin">${LINE}</right>` +
  `<top style="thin">${LINE}</top><bottom style="thin">${LINE}</bottom><diagonal/></border>`;

/** The sample's own en-US date picture; the skin pins the Week ending dates to it too. */
const DATE_FMT = '[$-409]dd\\-mmm\\-yy;@';
const DEVIATION_FMT = '0.00%;[Red]\\-0.00%';

function count(xml: string, tag: string): number {
  const m = new RegExp(`<${tag}\\b[^>]*\\bcount="(\\d+)"`).exec(xml);
  if (!m) throw new Error(`styles.xml has no <${tag} count>`);
  return Number(m[1]);
}

/** Appends `items` to the `<tag>` list, bumping its count; returns the first new index. */
function append(xml: string, tag: string, items: string[]): { xml: string; first: number } {
  const first = count(xml, tag);
  const out = xml
    .replace(new RegExp(`(<${tag}\\b[^>]*\\bcount=")(\\d+)(")`), (_, a: string, n: string, b: string) => `${a}${Number(n) + items.length}${b}`)
    .replace(`</${tag}>`, `${items.join('')}</${tag}>`);
  return { xml: out, first };
}

function build(base: string) {
  let xml = base;
  const ids = [...xml.matchAll(/numFmtId="(\d+)" formatCode/g)].map((m) => Number(m[1]));
  const dateFmt = /<numFmt numFmtId="(\d+)" formatCode="\[\$-409\]dd\\-mmm\\-yy;@"\/>/.exec(xml)?.[1];
  let dateId = dateFmt ? Number(dateFmt) : 0;
  const devId = Math.max(164, ...ids) + 1;
  const fmts = [`<numFmt numFmtId="${devId}" formatCode="${DEVIATION_FMT}"/>`];
  if (!dateId) {
    dateId = devId + 1;
    fmts.push(`<numFmt numFmtId="${dateId}" formatCode="${DATE_FMT}"/>`);
  }
  ({ xml } = append(xml, 'numFmts', fmts));

  const f = append(xml, 'fonts', [FONTS.body, FONTS.bold, FONTS.title, FONTS.plan, FONTS.actual]);
  xml = f.xml;
  const font = { body: f.first, bold: f.first + 1, title: f.first + 2, plan: f.first + 3, actual: f.first + 4 };
  const fl = append(xml, 'fills', [HEADER_FILL]);
  xml = fl.xml;
  const b = append(xml, 'borders', [GRID]);
  xml = b.xml;

  const xf = (fontId: number, opts: { fill?: boolean; border?: boolean; fmt?: number; h: 'left' | 'center'; v?: 'center' | 'bottom' }) =>
    `<xf numFmtId="${opts.fmt ?? 0}" fontId="${fontId}" fillId="${opts.fill ? fl.first : 0}" borderId="${opts.border === false ? 0 : b.first}" xfId="0"` +
    `${opts.fmt ? ' applyNumberFormat="1"' : ''} applyFont="1"${opts.fill ? ' applyFill="1"' : ''} applyBorder="1" applyAlignment="1">` +
    `<alignment horizontal="${opts.h}" vertical="${opts.v ?? 'center'}"${opts.h === 'left' ? ' indent="1"' : ''}/></xf>`;

  const order = [
    ['title', xf(font.title, { border: false, h: 'left', v: 'bottom' })],
    ['headLabel', xf(font.bold, { fill: true, h: 'left' })],
    ['headWeek', xf(font.bold, { fill: true, h: 'center' })],
    ['headDate', xf(font.body, { fill: true, fmt: dateId, h: 'center' })],
    ['planLabel', xf(font.plan, { h: 'left' })],
    ['actualLabel', xf(font.actual, { h: 'left' })],
    ['devLabel', xf(font.bold, { h: 'left' })],
    ['pct', xf(font.body, { fmt: 10, h: 'center' })],
    ['dev', xf(font.body, { fmt: devId, h: 'center' })],
    ['blank', xf(font.body, { h: 'center' })],
  ] as const;
  const x = append(xml, 'cellXfs', order.map(([, s]) => s));
  xml = x.xml;
  const index = Object.fromEntries(order.map(([k], i) => [k, String(x.first + i)])) as Record<(typeof order)[number][0], string>;
  return { styles: xml, xf: index };
}

/** The workbook's stylesheet: the sample's, plus the table's styles at the end. */
export const TABLE = build(WEEKLY_SKIN.styles);
