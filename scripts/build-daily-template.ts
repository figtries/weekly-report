/**
 * Makes `lib/xlsx/daily-template.ts` from one of the client's real daily workbooks.
 *
 * The template is that workbook with ONE DAY'S DATA taken out and nothing else
 * removed: same merges, styles, widths, conditional formats, page setup, checkboxes
 * and the 111 external links and dead defined names it already carried. Phase 1
 * keeps those on purpose: without Excel on this machine a trimmed package cannot be
 * proven to open cleanly, and the client's own files open with the same "update
 * links" prompt.
 *
 * What it changes:
 *  - blanks the cells an export writes (formulas stay),
 *  - unifies the activity rows: the client edits their merges by hand every day, so
 *    no two files agree; here every row is C:K (today) and M:S (tomorrow), with the
 *    right-edge border styles the other rows already use,
 *  - adds a plain-number copy of the date-formatted "Hari ke-" style,
 *  - drops the six pictures (two logos, two signatures, two photos) and their media.
 *    Checkboxes stay.
 *
 * Run: node --import ./scripts/ts-resolve.mjs scripts/build-daily-template.ts [sample.xlsx]
 */
import fs from 'node:fs';
import JSZip from 'jszip';
import { CELLS, DAY_NO_STYLE } from '../lib/xlsx/daily-cells.ts';
import { SheetXml } from '../lib/xlsx/sheet-xml.ts';

const DEFAULT_SAMPLE =
  'E:/Pa Singgih/44. CPP Gundih_Relokasi Taurus 60 Tanjung & Relokasi Centaur 40 Limau/6. Progress/Daily Report/Maret/PRGG-00-G0-RPT-003_DAILY PROGRESS REPORT 07032026.xlsx';
const src = process.argv[2] ?? DEFAULT_SAMPLE;
const OUT = new URL('../lib/xlsx/daily-template.ts', import.meta.url);

const zip = await JSZip.loadAsync(fs.readFileSync(src));

/* ------------------------------------------------------------- the sheet */

const sheetPath = 'xl/worksheets/sheet1.xml';
const sheet = SheetXml.parse((await zip.file(sheetPath)!.async('string')) as string);

// 1. Blank what an export writes. Formula cells keep their formulas.
const blank: string[] = [
  CELLS.title, CELLS.date, CELLS.dayNo, CELLS.contractor, CELLS.contractNo, CELLS.location, CELLS.client, CELLS.docNo,
  CELLS.progress.date, CELLS.progress.plan, CELLS.progress.actual,
  CELLS.sign.leftCompany, CELLS.sign.leftName, CELLS.sign.rightCompany, CELLS.sign.rightName,
];
for (const r of CELLS.crew.rows) for (const k of ['no', 'name', 'pob', 'prev'] as const) blank.push(CELLS.crew[k] + r);
for (const r of CELLS.nonEffective.rows) for (const k of ['no', 'prev', 'cumm', 'remark'] as const) blank.push(CELLS.nonEffective[k] + r);
for (const r of CELLS.ptw.rows) for (const k of ['no', 'desc', 'type', 'pwtNo', 'pa', 'issued', 'validity', 'status'] as const) blank.push(CELLS.ptw[k] + r);
for (const r of CELLS.hse.rows) for (const k of ['prev', 'today'] as const) blank.push(CELLS.hse[k] + r);
for (const r of CELLS.activities.rows) for (const k of ['todayText', 'tomorrowText'] as const) blank.push(CELLS.activities[k] + r);
for (const r of CELLS.aoc.rows) for (const k of ['no', 'type', 'desc', 'date', 'by', 'status'] as const) blank.push(CELLS.aoc[k] + r);
for (const a of blank) if (sheet.has(a) && sheet.formula(a) === null) sheet.clear(a);

// 2. Unify the activity rows. Styles: interior text cells s308, the right edge of
//    Today s309 (thin), of Tomorrow s312 (the medium frame). Row 32 carried two hand-edit
//    defects (no right border on K, none on S) that this corrects.
const acts = CELLS.activities;
const inActivityRows = (m: string) => {
  const r = Number(/^[A-Z]+(\d+)/.exec(m)?.[1]);
  return r >= 32 && r <= 39;
};
const keep = sheet.merges().filter((m) => !inActivityRows(m));
for (const r of acts.rows) {
  keep.push(`C${r}:K${r}`, `M${r}:S${r}`);
  for (const c of 'CDEFGHIJ') sheet.setStyle(c + r, '308');
  sheet.setStyle('K' + r, '309');
  for (const c of 'MNOPQR') sheet.setStyle(c + r, '308');
  sheet.setStyle('S' + r, '312');
  sheet.setText(acts.todayNo + r, `${acts.rows.indexOf(r) + 1}.`);
  sheet.setText(acts.tomorrowNo + r, `${acts.rows.indexOf(r) + 1}.`);
  sheet.setRowHeight(r, 21);
}
sheet.setMerges(keep);

// 3. "Hari ke-" is a plain number, not a date.
sheet.setStyle(CELLS.dayNo, DAY_NO_STYLE.to);

zip.file(sheetPath, sheet.serialize());

/* --------------------------------------------------------------- styles */

const stylesPath = 'xl/styles.xml';
let styles = (await zip.file(stylesPath)!.async('string')) as string;
const cx = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(styles);
if (!cx) throw new Error('no cellXfs in styles.xml');
const xfs = [...cx[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
if (xfs.length !== Number(cx[1])) throw new Error(`cellXfs count ${cx[1]} but ${xfs.length} parsed`);
if (String(xfs.length) !== DAY_NO_STYLE.to) throw new Error(`the new style id would be ${xfs.length}, not ${DAY_NO_STYLE.to}`);
const dayNoXf = xfs[Number(DAY_NO_STYLE.from)].replace(/numFmtId="\d+"/, 'numFmtId="0"');
styles = styles.replace(cx[0], `<cellXfs count="${xfs.length + 1}">${cx[2]}${dayNoXf}</cellXfs>`);
zip.file(stylesPath, styles);

/* -------------------------------------------------------------- pictures */

const drawingPath = 'xl/drawings/drawing1.xml';
let drawing = (await zip.file(drawingPath)!.async('string')) as string;
const before = (drawing.match(/<xdr:pic>/g) ?? []).length;
drawing = drawing.replace(/<xdr:twoCellAnchor\b(?:(?!<\/xdr:twoCellAnchor>)[\s\S])*?<xdr:pic>[\s\S]*?<\/xdr:twoCellAnchor>/g, '');
const after = (drawing.match(/<xdr:pic>/g) ?? []).length;
if (before !== 6 || after !== 0) throw new Error(`expected to drop 6 pictures, dropped ${before - after} of ${before}`);
zip.file(drawingPath, drawing);
zip.file(
  'xl/drawings/_rels/drawing1.xml.rels',
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
);
for (const name of Object.keys(zip.files)) if (name.startsWith('xl/media/')) zip.remove(name);

/* ------------------------------------------------------------ calc chain */

// The chain lists formula cells, and an export clears the formulas of unused rows.
// Excel treats a chain entry with no formula behind it as damage and offers to
// repair the file; without the part it rebuilds the chain silently. The part, its
// relationship and its content type all go together.
zip.remove('xl/calcChain.xml');
const relsPath = 'xl/_rels/workbook.xml.rels';
zip.file(
  relsPath,
  ((await zip.file(relsPath)!.async('string')) as string).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/, '')
);
zip.file(
  '[Content_Types].xml',
  ((await zip.file('[Content_Types].xml')!.async('string')) as string).replace(/<Override\b[^>]*calcChain[^>]*\/>/, '')
);

/* ----------------------------------------------------------------- write */

const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
const b64 = bytes.toString('base64');
const lines = b64.match(/.{1,120}/g) ?? [];
// An array joined at load, not thousands of `'...' +` operands: that nests the syntax tree
// as deep as the number of pieces and overflows the stack of node's own TypeScript stripper.
fs.writeFileSync(
  OUT,
  `// GENERATED by scripts/build-daily-template.ts from the client's daily workbook. Do not edit.
// ${Math.round(bytes.length / 1024)} KB zipped; regenerate rather than patch.
export const DAILY_TEMPLATE_B64 = [
  '${lines.join("',\n  '")}',
].join('');
`
);
console.log(`template written: ${Math.round(bytes.length / 1024)} KB zipped, ${Math.round(b64.length / 1024)} KB as base64`);
