import JSZip from 'jszip';
import { OVERALL, weeklyFileName, type WeeklyExportInput, type WeeklySelection } from './weekly-input';
import { detailSheet, documentationSheet, scurveSheet, summarySheet, type ChartSpec, type PlacedPhoto, type WrittenSheet } from './weekly-sheets';
import { WEEKLY_SKIN } from './weekly-skin';

/**
 * The weekly report as ONE workbook in the look of the client's own (contoh.xlsx), with
 * the app's figures (3 Oct 2026, spec 2026-10-03-weekly-excel-export-design.md).
 *
 * Unlike the daily export this one is BUILT, not patched: the weekly workbook is not a
 * fixed form (Detail grows with the WBS, the per-package sheets with the packages), so
 * the package is written from scratch and only the look comes from the sample, through
 * lib/xlsx/weekly-skin.ts. Every cell is a value.
 */

const NS = {
  main: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  pkg: 'http://schemas.openxmlformats.org/package/2006/relationships',
  xdr: 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
};
const REL = {
  doc: `${NS.r}/officeDocument`,
  sheet: `${NS.r}/worksheet`,
  styles: `${NS.r}/styles`,
  theme: `${NS.r}/theme`,
  drawing: `${NS.r}/drawing`,
  chart: `${NS.r}/chart`,
  image: `${NS.r}/image`,
};
const CT = {
  workbook: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  sheet: 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
  styles: 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  drawing: 'application/vnd.openxmlformats-officedocument.drawing+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
};
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const quoted = (name: string) => `'${name.replace(/'/g, "''")}'`;

export interface WeeklyWorkbook {
  bytes: Buffer;
  fileName: string;
  sheets: string[];
}

/** The sheets the selection asks for, in the sample's order. */
export function writeSheets(input: WeeklyExportInput, sel: WeeklySelection, photos: Buffer[]): WrittenSheet[] {
  const out: WrittenSheet[] = [];
  const pkgs = input.packages;
  if (sel.documentation) out.push(documentationSheet(photos));
  if (sel.summary) out.push(summarySheet(input));
  if (sel.scurve.includes(OVERALL)) out.push(scurveSheet(input, input.scurve.overall, null));
  if (sel.detail.includes(OVERALL)) out.push(detailSheet(input, input.detail.overall, null));
  for (const p of pkgs) {
    const data = input.detail.byPackage.get(p.key);
    if (sel.detail.includes(p.key) && data) out.push(detailSheet(input, data, p));
  }
  for (const p of pkgs) {
    const series = input.scurve.byPackage.get(p.key);
    if (sel.scurve.includes(p.key) && series) out.push(scurveSheet(input, series, p));
  }
  return out;
}

function chartXml(sheetName: string, spec: ChartSpec): string {
  const ref = (cells: string) => `${quoted(sheetName)}!${cells}`;
  const str = (text: string) => `<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>${esc(text)}</c:v></c:pt></c:strCache>`;
  const num = (format: string, values: Array<number | null>) =>
    `<c:numCache><c:formatCode>${format}</c:formatCode><c:ptCount val="${values.length}"/>` +
    values.map((v, i) => (v === null ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('') +
    '</c:numCache>';
  // Pinned to en-US like the Week ending cells, so the axis reads Aug and Oct in any Excel.
  const cat = num('[$-409]dd\\-mmm\\-yy', spec.points.map((p) => p.serial));
  const fill = (token: string, f: string, cache: string) => (xml: string) =>
    xml.split(`<c:f>${token}</c:f>`).join(`<c:f>${esc(f)}</c:f>${cache}`);
  let xml = WEEKLY_SKIN.chart;
  xml = fill('{{ACTUAL_TX}}', ref(spec.actualTx), str('CUM. ACTUAL'))(xml);
  xml = fill('{{PLAN_TX}}', ref(spec.planTx), str('CUM. PLAN'))(xml);
  xml = fill('{{CAT}}', ref(spec.cat), cat)(xml);
  xml = fill('{{ACTUAL_VAL}}', ref(spec.actualVal), num('0.00%', spec.points.map((p) => (p.actual === null ? null : p.actual / 100))))(xml);
  xml = fill('{{PLAN_VAL}}', ref(spec.planVal), num('0.00%', spec.points.map((p) => (p.plan === null ? null : p.plan / 100))))(xml);
  return xml.split('{{CALLOUT}}').join(String(spec.points.length - 1));
}

function photoDrawing(photos: PlacedPhoto[], firstImage: number): { xml: string; rels: string; media: Array<{ path: string; bytes: Buffer }> } {
  const anchors: string[] = [];
  const links: string[] = [];
  const media: Array<{ path: string; bytes: Buffer }> = [];
  photos.forEach((p, i) => {
    const rid = `rId${i + 1}`;
    const file = `image${firstImage + i}.${p.info.ext}`;
    media.push({ path: `xl/media/${file}`, bytes: p.bytes });
    links.push(`<Relationship Id="${rid}" Type="${REL.image}" Target="../media/${file}"/>`);
    anchors.push(
      '<xdr:twoCellAnchor editAs="oneCell">' +
        `<xdr:from><xdr:col>${p.from.col}</xdr:col><xdr:colOff>${p.from.colOff}</xdr:colOff><xdr:row>${p.from.row}</xdr:row><xdr:rowOff>${p.from.rowOff}</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${p.to.col}</xdr:col><xdr:colOff>${p.to.colOff}</xdr:colOff><xdr:row>${p.to.row}</xdr:row><xdr:rowOff>${p.to.rowOff}</xdr:rowOff></xdr:to>` +
        '<xdr:pic>' +
        `<xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Photo ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${rid}"/><a:srcRect${p.crop}/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${p.cx}" cy="${p.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        '</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>'
    );
  });
  return {
    xml: `${XML}<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}">${anchors.join('')}</xdr:wsDr>`,
    rels: `${XML}<Relationships xmlns="${NS.pkg}">${links.join('')}</Relationships>`,
    media,
  };
}

function chartDrawing(): { xml: string; rels: (chartFile: string) => string } {
  const anchor = WEEKLY_SKIN.chartAnchor.replace(/r:id="[^"]*"/, 'r:id="rId1"');
  return {
    xml: `${XML}<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">${anchor}</xdr:wsDr>`,
    rels: (chartFile) => `${XML}<Relationships xmlns="${NS.pkg}"><Relationship Id="rId1" Type="${REL.chart}" Target="../charts/${chartFile}"/></Relationships>`,
  };
}

export async function buildWeeklyWorkbook(
  input: WeeklyExportInput,
  sel: WeeklySelection,
  /** The week's photos, read in the order of `input.photos`. */
  photos: Buffer[] = []
): Promise<WeeklyWorkbook> {
  const sheets = writeSheets(input, sel, photos);
  if (sheets.length === 0) throw new Error('Nothing selected to export');

  const zip = new JSZip();
  const overrides: string[] = [
    `<Override PartName="/xl/workbook.xml" ContentType="${CT.workbook}"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="${CT.styles}"/>`,
    `<Override PartName="/xl/theme/theme1.xml" ContentType="${CT.theme}"/>`,
  ];
  const wbRels: string[] = [];
  const sheetTags: string[] = [];
  const names: string[] = [];
  let drawings = 0;
  let charts = 0;
  let images = 1;

  sheets.forEach((s, i) => {
    const n = i + 1;
    let xml = s.xml;
    if (i === 0) xml = xml.replace(/<sheetView\b/, '<sheetView tabSelected="1"');
    const drawing = s.chart ? chartDrawing() : s.photos?.length ? photoDrawing(s.photos, images) : null;
    if (drawing) {
      drawings += 1;
      const dFile = `drawing${drawings}.xml`;
      xml = xml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
      zip.file(`xl/worksheets/_rels/sheet${n}.xml.rels`, `${XML}<Relationships xmlns="${NS.pkg}"><Relationship Id="rId1" Type="${REL.drawing}" Target="../drawings/${dFile}"/></Relationships>`);
      zip.file(`xl/drawings/${dFile}`, drawing.xml);
      overrides.push(`<Override PartName="/xl/drawings/${dFile}" ContentType="${CT.drawing}"/>`);
      if (s.chart) {
        charts += 1;
        const cFile = `chart${charts}.xml`;
        zip.file(`xl/charts/${cFile}`, chartXml(s.name, s.chart));
        zip.file(`xl/drawings/_rels/${dFile}.rels`, (drawing as ReturnType<typeof chartDrawing>).rels(cFile));
        overrides.push(`<Override PartName="/xl/charts/${cFile}" ContentType="${CT.chart}"/>`);
      } else {
        const d = drawing as ReturnType<typeof photoDrawing>;
        zip.file(`xl/drawings/_rels/${dFile}.rels`, d.rels);
        d.media.forEach((m) => zip.file(m.path, m.bytes));
        images += d.media.length;
      }
    }
    zip.file(`xl/worksheets/sheet${n}.xml`, xml);
    overrides.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${CT.sheet}"/>`);
    wbRels.push(`<Relationship Id="rId${n}" Type="${REL.sheet}" Target="worksheets/sheet${n}.xml"/>`);
    sheetTags.push(`<sheet name="${esc(s.name)}" sheetId="${n}" r:id="rId${n}"/>`);
    names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${i}">${esc(quoted(s.name))}!${s.printArea}</definedName>`);
    if (s.printTitles) names.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${esc(quoted(s.name))}!${s.printTitles}</definedName>`);
    const filter = /<autoFilter ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/.exec(xml);
    if (filter) names.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(quoted(s.name))}!$${filter[1]}$${filter[2]}:$${filter[3]}$${filter[4]}</definedName>`);
  });

  const k = sheets.length;
  wbRels.push(`<Relationship Id="rId${k + 1}" Type="${REL.styles}" Target="styles.xml"/>`);
  wbRels.push(`<Relationship Id="rId${k + 2}" Type="${REL.theme}" Target="theme/theme1.xml"/>`);

  zip.file(
    '[Content_Types].xml',
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      `${overrides.join('')}</Types>`
  );
  zip.file('_rels/.rels', `${XML}<Relationships xmlns="${NS.pkg}"><Relationship Id="rId1" Type="${REL.doc}" Target="xl/workbook.xml"/></Relationships>`);
  zip.file(
    'xl/workbook.xml',
    `${XML}<workbook xmlns="${NS.main}" xmlns:r="${NS.r}">` +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300" activeTab="0"/></bookViews>' +
      `<sheets>${sheetTags.join('')}</sheets>` +
      `<definedNames>${names.join('')}</definedNames>` +
      '<calcPr calcId="191029"/></workbook>'
  );
  zip.file('xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${NS.pkg}">${wbRels.join('')}</Relationships>`);
  zip.file('xl/styles.xml', WEEKLY_SKIN.styles);
  zip.file('xl/theme/theme1.xml', WEEKLY_SKIN.theme);

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return {
    bytes,
    fileName: weeklyFileName(input.project.documentNoWeekly, input.week, input.periodEnd),
    sheets: sheets.map((s) => s.name),
  };
}
