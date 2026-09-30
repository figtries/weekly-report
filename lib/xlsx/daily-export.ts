import JSZip from 'jszip';
import { CELLS } from './daily-cells';
import { fillDailySheet, type Condition, type DailyExportInput, type Overflow } from './daily-fill';
import { placePhotos } from './daily-photos';
import { DAILY_TEMPLATE_B64 } from './daily-template';
import { SheetXml } from './sheet-xml';

const SHEET = 'xl/worksheets/sheet1.xml';
const VML = 'xl/drawings/vmlDrawing1.vml';
const DRAWING = 'xl/drawings/drawing1.xml';
const DRAWING_RELS = 'xl/drawings/_rels/drawing1.xml.rels';
const WORKBOOK = 'xl/workbook.xml';

export interface DailyWorkbook {
  bytes: Buffer;
  overflow: Overflow[];
}

/**
 * The client's own daily workbook, filled from a report.
 *
 * The template is the workbook itself with one day's data taken out, and every part
 * of it that is not written to below is copied through untouched. That is the whole
 * point of patching the package instead of building a sheet: merges, styles, widths,
 * conditional formats, page setup and the form controls stay exactly the client's.
 */
export async function buildDailyWorkbook(
  input: DailyExportInput,
  /** The report's stored photos, in slot order with the empty slots left out. */
  photos: Buffer[] = []
): Promise<DailyWorkbook> {
  const zip = await JSZip.loadAsync(Buffer.from(DAILY_TEMPLATE_B64, 'base64'));
  const sheet = SheetXml.parse((await zip.file(SHEET)!.async('string')) as string);
  const { overflow, weather } = fillDailySheet(sheet, input);
  await tickWeather(zip, weather);

  if (photos.length > 0) {
    const placed = placePhotos(
      sheet,
      (await zip.file(DRAWING)!.async('string')) as string,
      (await zip.file(DRAWING_RELS)!.async('string')) as string,
      photos
    );
    zip.file(DRAWING, placed.drawing);
    zip.file(DRAWING_RELS, placed.rels);
    for (const m of placed.media) zip.file(m.path, m.bytes);
    // Pages of photos past the form's own: the print area reaches down to them.
    if (placed.lastRow > CELLS.photoPage.last) {
      const wb = (await zip.file(WORKBOOK)!.async('string')) as string;
      const area = /(<definedName name="_xlnm\.Print_Area" localSheetId="0">[^<]*?\$[A-Z]+\$)(\d+)(<\/definedName>)/;
      if (!area.test(wb)) throw new Error('The template has no print area to extend');
      zip.file(WORKBOOK, wb.replace(area, `$1${placed.lastRow}$3`));
    }
  }
  zip.file(SHEET, sheet.serialize());
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, overflow };
}

/**
 * The four weather checkboxes are form controls. Excel reads a control's state from
 * its ctrlProp part (`checked="Checked"`) and older readers from the VML shape
 * (`<x:Checked>1</x:Checked>`); both are set, so they cannot disagree.
 */
async function tickWeather(zip: JSZip, picked: Record<Condition, boolean>) {
  let vml = (await zip.file(VML)!.async('string')) as string;
  for (const key of Object.keys(CELLS.weather) as Condition[]) {
    const { ctrl, shape } = CELLS.weather[key];
    const propPath = `xl/ctrlProps/ctrlProp${ctrl}.xml`;
    const prop = (await zip.file(propPath)!.async('string')) as string;
    const clean = prop.replace(/\schecked="[^"]*"/, '');
    zip.file(propPath, picked[key] ? clean.replace(/objectType="CheckBox"/, 'objectType="CheckBox" checked="Checked"') : clean);

    // The shape whose id is _x0000_s<shape>; its ClientData is the first one after it.
    const start = vml.indexOf(`id="_x0000_s${shape}"`);
    if (start < 0) throw new Error(`VML shape ${shape} not found`);
    const end = vml.indexOf('</v:shape>', start);
    let block = vml.slice(start, end).replace(/\s*<x:Checked>\d+<\/x:Checked>/, '');
    if (picked[key]) block = block.replace('<x:NoThreeD/>', '<x:Checked>1</x:Checked>\n   <x:NoThreeD/>');
    vml = vml.slice(0, start) + block + vml.slice(end);
  }
  zip.file(VML, vml);
}
