/**
 * Lifts the LOOK of the client's weekly workbook into lib/xlsx/weekly-skin.ts.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/build-weekly-skin.ts "<path to contoh.xlsx>"
 *
 * The sample (`...\Weekly Report\W45\contoh.xlsx`, 3 Oct 2026) is the reference for
 * how the weekly export looks; its CONTENT is never used. Kept: the styles and theme,
 * and for the four sheet kinds the export writes (Documentation, Summary, S-Curve,
 * Detail) the sheet's own setup (columns, views, print setup, merges) and the rows the
 * writer copies its row styles from. Dropped: every picture (the logos belong to one
 * company), `Data Overall`, the hidden sheets, the 106 external links, the defined
 * names, `calcChain`, formulas, conditional formats and data validations (they read
 * sheets the export does not have). The S-curve chart is kept as a template with its
 * references and caches cut out.
 */
import fs from 'node:fs';
import JSZip from 'jszip';

const src = process.argv[2];
if (!src || !fs.existsSync(src)) throw new Error('Pass the path to contoh.xlsx');
const zip = await JSZip.loadAsync(fs.readFileSync(src));
const read = async (p: string) => {
  const f = zip.file(p);
  if (!f) throw new Error(`${p} missing from the sample`);
  return f.async('string');
};

// ---------------------------------------------------------------- sheets by name
const workbook = await read('xl/workbook.xml');
const rels = await read('xl/_rels/workbook.xml.rels');
const sheetPath = (name: string) => {
  const rid = new RegExp(`<sheet name="${name}"[^>]*r:id="([^"]+)"`).exec(workbook)?.[1];
  const target = rid && new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  if (!target) throw new Error(`sheet ${name} not found`);
  return `xl/${target.replace(/^\/?xl\//, '')}`;
};

// ---------------------------------------------------------------- shared strings
const sst = await read('xl/sharedStrings.xml');
const strings = [...sst.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
  [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')
);

const colNum = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/**
 * The sample's fixed labels, in English (3 Oct 2026: "aku maunya semua pakai bahasa
 * inggris ya, ini kan appnya bahasa inggris"). Keyed by the label exactly as the sample
 * spells it, spacing included, so the colons and line breaks stay where they were. Only
 * the LOOK's own words: anything the writer fills in comes from the app.
 */
const ENGLISH: Record<string, string> = {
  DESKRIPSI: 'DESCRIPTION',
  'BOBOT\r\n (%)': 'WEIGHT\r\n (%)',
  'MINGGU LALU': 'LAST WEEK',
  'MINGGU INI': 'THIS WEEK',
  'CUMM. MINGGU INI': 'CUM. THIS WEEK',
  'PERIODE      : ': 'PERIOD       : ',
  SATUAN: 'UNIT',
};

/** A cell as the writer wants it: shared strings inlined, formulas replaced by their cached value. */
function cleanCell(cell: string): string {
  const attrs = /^<c\b([^>]*?)\/?>/.exec(cell)![1];
  const type = /\bt="(\w+)"/.exec(attrs)?.[1];
  const v = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
  const base = attrs.replace(/\s+t="\w+"/, '').replace(/\s+cm="\d+"/, '');
  let text: string | null = null;
  if (type === 's' && v !== undefined) text = strings[Number(v)];
  else if ((type === 'str' || type === 'inlineStr') && v !== undefined) text = v;
  else if (type === 'inlineStr') text = /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell)?.[1] ?? null;
  if (text !== null) {
    if (text.trim() === '') return `<c${base}/>`;
    text = ENGLISH[text] ?? text;
    return `<c${base} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
  }
  if (type === 'e' || v === undefined) return `<c${base}/>`;
  return `<c${base}><v>${v}</v></c>`;
}

interface SkinSheet {
  /** The worksheet up to and including `<sheetData>`. */
  pre: string;
  /** Each kept row's XML, by its row number in the sample. */
  rows: Record<string, string>;
  /** From `</sheetData>` to the end. */
  post: string;
}

async function lift(name: string, keepRow: (r: number) => boolean, c1: number, c2: number): Promise<SkinSheet> {
  const xml = await read(sheetPath(name));
  const open = xml.indexOf('>', xml.indexOf('<sheetData')) + 1;
  let pre = xml.slice(0, open);
  let post = xml.slice(xml.indexOf('</sheetData>'));

  pre = pre
    .replace(/\s+codeName="[^"]*"/, '')
    .replace(/\s+tabSelected="1"/, '')
    .replace(/(<sheetView\b[^>]*?)\s+topLeftCell="[^"]*"/g, '$1')
    // A frozen pane MUST name its top-left cell: without it Excel refuses the whole
    // file ("Unable to get the Open property"). It is the first cell past the split,
    // never where the sample's author last scrolled to.
    .replace(/<pane\b([^>]*?)\/>/g, (_, a: string) => {
      const x = Number(/xSplit="(\d+)"/.exec(a)?.[1] ?? 0);
      const y = Number(/ySplit="(\d+)"/.exec(a)?.[1] ?? 0);
      let col = '';
      for (let n = x + 1; n > 0; n = Math.floor((n - 1) / 26)) col = String.fromCharCode(65 + ((n - 1) % 26)) + col;
      return `<pane${a.replace(/\s+topLeftCell="[^"]*"/, '')} topLeftCell="${col}${y + 1}"/>`;
    })
    .replace(/<selection\b[^>]*\/>/g, '');

  const rows: Record<string, string> = {};
  for (const m of xml.slice(open, xml.indexOf('</sheetData>')).matchAll(/<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = Number(/\br="(\d+)"/.exec(m[1])![1]);
    if (!keepRow(r)) continue;
    const attrs = m[1].replace(/\s+spans="[^"]*"/, '').replace(/\s+x14ac:dyDescent="[^"]*"/, '');
    const cells = [...(m[3] ?? '').matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)]
      .map((c) => c[0])
      .filter((c) => {
        const n = colNum(/\br="([A-Z]+)\d+"/.exec(c)![1]);
        return n >= c1 && n <= c2;
      })
      .map(cleanCell);
    rows[String(r)] = `<row${attrs}>${cells.join('')}</row>`;
  }

  const inRange = (ref: string) => {
    const [a, b = a] = ref.split(':');
    const [, ca, ra] = /([A-Z]+)(\d+)/.exec(a)!;
    const [, cb, rb] = /([A-Z]+)(\d+)/.exec(b)!;
    return keepRow(Number(ra)) && keepRow(Number(rb)) && colNum(ca) >= c1 && colNum(cb) <= c2;
  };
  const merges = [...post.matchAll(/<mergeCell ref="([^"]+)"\/>/g)].map((m) => m[1]).filter(inRange);
  post = post
    .replace(/<mergeCells\b[\s\S]*?<\/mergeCells>/, merges.length ? `<mergeCells count="${merges.length}">${merges.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '')
    .replace(/<conditionalFormatting\b[\s\S]*?<\/conditionalFormatting>/g, '')
    .replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/g, '')
    .replace(/<ignoredErrors\b[\s\S]*?<\/ignoredErrors>/g, '')
    .replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/g, '')
    .replace(/<colBreaks\b[\s\S]*?<\/colBreaks>/g, '')
    .replace(/<drawing\b[^>]*\/>/g, '')
    .replace(/<legacyDrawing\b[^>]*\/>/g, '')
    .replace(/<picture\b[^>]*\/>/g, '')
    .replace(/<extLst>[\s\S]*?<\/extLst>(?=<\/worksheet>)/, '')
    .replace(/(<pageSetup\b[^>]*?)\s+r:id="[^"]*"/, '$1');
  return { pre, rows, post };
}

const between = (a: number, b: number) => (r: number) => r >= a && r <= b;
const documentation = await lift('Documentation', between(1, 46), 1, 10);
const summary = await lift('Summary Overall', between(1, 22), 1, 11);
const scurve = await lift('S-Curve Overall', between(1, 35), 2, 16);
const detail = await lift('Detail Overall', (r) => r <= 20 || r === 300, 1, 13);

// ---------------------------------------------------------------- S-curve data styles
const scurveXml = await read(sheetPath('S-Curve Overall'));
const styleAt = (addr: string) => new RegExp(`<c r="${addr}"[^>]*?\\bs="(\\d+)"`).exec(scurveXml)?.[1] ?? '0';
const dataStyles = { group: styleAt('R6'), label: styleAt('S8'), week: styleAt('U3'), date: styleAt('U5'), pct: styleAt('U8') };

// ---------------------------------------------------------------- the chart
const drawingRels = await read('xl/worksheets/_rels/' + sheetPath('S-Curve Overall').split('/').pop() + '.rels');
const drawingTarget = /Target="\.\.\/drawings\/([^"]+)"/.exec(drawingRels)![1];
const drawing = await read(`xl/drawings/${drawingTarget}`);
const chartAnchor = /<xdr:twoCellAnchor\b[\s\S]*?<\/xdr:twoCellAnchor>/.exec(drawing)![0];
const chartTarget = /Target="\.\.\/charts\/([^"]+)"/.exec(await read(`xl/drawings/_rels/${drawingTarget}.rels`))![1];
let chart = await read(`xl/charts/${chartTarget}`);
const sheetRef = "'S-Curve Overall'!";
chart = chart
  .replace(/<c:dPt>[\s\S]*?<\/c:dPt>/g, '')
  .replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, '')
  .replace(/<c:strCache>[\s\S]*?<\/c:strCache>/g, '')
  .replace(/<c:externalData\b[\s\S]*?<\/c:externalData>/g, '')
  .replace(/<c:userShapes\b[^>]*\/>/g, '')
  .split(`<c:f>${sheetRef}$S$11</c:f>`).join('<c:f>{{ACTUAL_TX}}</c:f>')
  .split(`<c:f>${sheetRef}$S$8</c:f>`).join('<c:f>{{PLAN_TX}}</c:f>')
  .split(`<c:f>${sheetRef}$T$5:$CB$5</c:f>`).join('<c:f>{{CAT}}</c:f>')
  .split(`<c:f>${sheetRef}$T$11:$CB$11</c:f>`).join('<c:f>{{ACTUAL_VAL}}</c:f>')
  .split(`<c:f>${sheetRef}$T$8:$CB$8</c:f>`).join('<c:f>{{PLAN_VAL}}</c:f>')
  .replace(/<c:dLbl><c:idx val="\d+"\/>/g, '<c:dLbl><c:idx val="{{CALLOUT}}"/>');
// The actual line took its blue from per-point formatting (green markers on the first
// 34 points, the rest left to Excel's default). With the points gone it is set once,
// on the series: blue line, blue markers, as the app draws actual.
const BLUE = '<a:solidFill><a:srgbClr val="0070C0"/></a:solidFill>';
chart = chart
  .replace('<c:spPr><a:ln w="22225"/></c:spPr>', `<c:spPr><a:ln w="22225" cap="rnd">${BLUE}<a:round/></a:ln><a:effectLst/></c:spPr>`)
  .replace('<c:spPr><a:ln w="3175"/></c:spPr></c:marker>', `<c:spPr>${BLUE}<a:ln w="9525">${BLUE}</a:ln></c:spPr></c:marker>`);
for (const token of ['{{ACTUAL_TX}}', '{{PLAN_TX}}', '{{CAT}}', '{{ACTUAL_VAL}}', '{{PLAN_VAL}}', '{{CALLOUT}}']) {
  if (!chart.includes(token)) throw new Error(`chart template lost ${token}`);
}
if (chart.includes(sheetRef)) throw new Error('chart template still points at the sample');

// ---------------------------------------------------------------- dates in English
// The Week ending dates read in English whatever language Excel runs in. The sample's
// date cells use built-in format 15, whose month names follow the reader's Excel, so an
// Indonesian Excel shows "Agu" and "Okt". The sample carries its own [$-409] format,
// the same picture with the language pinned, and the date style is pointed at it.
let styles = await read('xl/styles.xml');
const enDate = /<numFmt numFmtId="(\d+)" formatCode="\[\$-409\]dd\\-mmm\\-yy;@"\/>/.exec(styles)?.[1];
if (!enDate) throw new Error('the sample lost its en-US date format');
{
  const open = styles.indexOf('<cellXfs');
  const close = styles.indexOf('</cellXfs>', open);
  let n = -1;
  const body = styles.slice(open, close).replace(/<xf\b[^>]*>/g, (xf) => {
    n += 1;
    return String(n) === dataStyles.date ? xf.replace(/numFmtId="\d+"/, `numFmtId="${enDate}"`) : xf;
  });
  styles = styles.slice(0, open) + body + styles.slice(close);
}

const skin = {
  styles,
  theme: await read('xl/theme/theme1.xml'),
  sheets: { documentation, summary, scurve, detail },
  dataStyles,
  chart,
  chartAnchor,
};

const json = JSON.stringify(skin);
const out =
  '// GENERATED by scripts/build-weekly-skin.ts from the client\'s weekly workbook (contoh.xlsx,\n' +
  '// 3 Oct 2026). Do not edit: change the script and run it again. Its content is the\n' +
  '// LOOK of the sample (styles, sheet setup, row styles, the S-curve chart) and nothing\n' +
  '// of its data; see the script for what was dropped and why.\n' +
  'export interface SkinSheet { pre: string; rows: Record<string, string>; post: string }\n' +
  'export interface WeeklySkin {\n' +
  '  styles: string;\n  theme: string;\n' +
  '  sheets: { documentation: SkinSheet; summary: SkinSheet; scurve: SkinSheet; detail: SkinSheet };\n' +
  '  dataStyles: { group: string; label: string; week: string; date: string; pct: string };\n' +
  '  chart: string;\n  chartAnchor: string;\n}\n' +
  `export const WEEKLY_SKIN: WeeklySkin = ${json};\n`;
fs.writeFileSync('lib/xlsx/weekly-skin.ts', out);

const dropped = Object.keys(zip.files).filter((p) => /media|externalLink|calcChain|vbaProject|comments|vmlDrawing/.test(p)).length;
console.log(`weekly-skin.ts: ${(out.length / 1024).toFixed(0)} KB; parts not carried over: ${dropped}`);
console.log('rows kept:', Object.fromEntries(Object.entries(skin.sheets).map(([k, s]) => [k, Object.keys(s.rows).length])));
console.log('data styles:', dataStyles);
