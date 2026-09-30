import { parseAddr, parseRange } from './addr';
import { CELLS, PHOTOS_PER_PAGE } from './daily-cells';
import type { SheetXml } from './sheet-xml';

/**
 * The day's photos, placed in the client's photo boxes: six to a page, and a copy of the
 * photo page below for every six more.
 *
 * Each picture is a `twoCellAnchor` spanning its box, inset from the border so the photo
 * has room to breathe, and COVER-cropped with `a:srcRect` to that shape: the crop the
 * app's preview shows, so nobody frames a photo against a shape the report never uses.
 * The crop is DrawingML's, not ours, so the whole image is still in the file and Excel's
 * Crop tool can move it.
 *
 * Pure: it edits a `SheetXml` and takes the template's drawing and its relationships as
 * text, returning them with the pictures added plus the media parts to write
 * (`daily-export.ts` zips them).
 */

const EMU_PER_PX = 9525;
const EMU_PER_PT = 12700;
/** White space between a photo and its box, every side. 3 px read as jammed against the lines. */
const INSET_PX = 18;
/** Drawing object ids; the four weather checkboxes hold 1025-1028. */
const FIRST_ID = 2001;
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const IMAGE_REL = `${R_NS}/image`;

/** Excel's own column width to pixels, at the workbook's Calibri 11 (a 7 px digit). */
const colPx = (chars: number) => Math.trunc(((256 * chars + Math.trunc(128 / 7)) / 256) * 7);

/**
 * A column is not one width. Measured 30 Sep 2026 in Excel 365 on this template: the
 * C:K box is 2.4% wider on screen than the 96-dpi formula above, and 6.6% wider when
 * printed to PDF, while row heights are exact points everywhere. The anchor stretches
 * the picture to whatever the box really is, so the crop is aimed between the two:
 * cropped for the formula alone, every printed photo came out 7% too wide.
 */
const WIDTH_SPREAD = 1.043;

export interface PhotoImage {
  /** The extension the template's content types already cover. */
  ext: 'jpeg' | 'png';
  width: number;
  height: number;
}

/** Type and pixel size from the file's own header; null for anything Excel is not sure to open. */
export function imageInfo(bytes: Buffer): PhotoImage | null {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { ext: 'png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes.readUInt16BE(0) === 0xffd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i += 1; // fill byte
        continue;
      }
      // Start of frame (every SOFn; C4, C8 and CC are other segments), which carries the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = bytes.readUInt16BE(i + 5);
        const width = bytes.readUInt16BE(i + 7);
        return width > 0 && height > 0 ? { ext: 'jpeg', width, height } : null;
      }
      i += 2 + bytes.readUInt16BE(i + 2);
    }
  }
  return null;
}

/** `a:srcRect` attributes that crop an image to the box's shape, centred (1/1000 of a percent). */
export function coverCrop(imgW: number, imgH: number, boxW: number, boxH: number): string {
  const img = imgW / imgH;
  const box = boxW / boxH;
  if (Math.abs(img - box) < 1e-3) return '';
  if (img > box) {
    const cut = Math.round(((1 - box / img) / 2) * 100000);
    return ` l="${cut}" r="${cut}"`;
  }
  const cut = Math.round(((1 - img / box) / 2) * 100000);
  return ` t="${cut}" b="${cut}"`;
}

const PAGE_ROWS = CELLS.photoPage.last - CELLS.photoPage.first + 1;

/**
 * Copies of the form's photo page below it until there are `pages`, each after a page
 * break of its own: rows (styles, heights, the frame), their merges, the breaks and the
 * used range. Returns the last row the print area has to reach.
 */
export function addPhotoPages(sheet: SheetXml, pages: number): number {
  const { first, last } = CELLS.photoPage;
  if (pages <= 1) return last;
  const end = last + (pages - 1) * PAGE_ROWS;
  for (let p = 1; p < pages; p++) sheet.copyRows(first, last, first + p * PAGE_ROWS);

  const rowsOf = (m: string) => parseRange(m);
  const own = sheet.merges().filter((m) => rowsOf(m).r1 >= first && rowsOf(m).r2 <= last);
  const kept = sheet.merges().filter((m) => rowsOf(m).r2 <= last || rowsOf(m).r1 > end);
  const shift = (m: string, by: number) => m.replace(/\d+/g, (n) => String(Number(n) + by));
  const copies = Array.from({ length: pages - 1 }, (_, i) => own.map((m) => shift(m, (i + 1) * PAGE_ROWS))).flat();
  sheet.setMerges([...kept, ...copies]);

  // The form's own break before the photo page, then one before every copy.
  const breaks = sheet.rowBreaks().filter((b) => b < first);
  for (let p = 1; p < pages; p++) breaks.push(last + (p - 1) * PAGE_ROWS);
  sheet.setRowBreaks(breaks);
  sheet.extendDimension(end);
  return end;
}

export interface PlacedPhotos {
  drawing: string;
  rels: string;
  media: Array<{ path: string; bytes: Buffer }>;
  /** Photos that went into a box. */
  placed: number;
  /** The sheet's last printed row, past the form's own when pages were added. */
  lastRow: number;
}

/**
 * Every photo, in order, six to a page, adding the pages the sheet needs first. Files
 * that are not a JPEG or PNG are passed over.
 */
export function placePhotos(sheet: SheetXml, drawing: string, rels: string, photos: Buffer[]): PlacedPhotos {
  const usable = photos
    .map((bytes) => ({ bytes, info: imageInfo(bytes) }))
    .filter((p): p is { bytes: Buffer; info: PhotoImage } => p.info !== null);
  if (usable.length === 0) return { drawing, rels, media: [], placed: 0, lastRow: CELLS.photoPage.last };
  const lastRow = addPhotoPages(sheet, Math.ceil(usable.length / PHOTOS_PER_PAGE));

  const inset = INSET_PX * EMU_PER_PX;
  const media: PlacedPhotos['media'] = [];
  const anchors: string[] = [];
  const links: string[] = [];

  usable.forEach(({ bytes, info }, i) => {
    const down = Math.floor(i / PHOTOS_PER_PAGE) * PAGE_ROWS;
    const box = CELLS.photos[i % PHOTOS_PER_PAGE];
    const from = parseAddr(box.from);
    const to = parseAddr(box.to);
    from.row += down;
    to.row += down;
    let wPx = 0;
    for (let c = from.colNum; c <= to.colNum; c++) wPx += colPx(sheet.colWidth(c));
    let hPt = 0;
    for (let r = from.row; r <= to.row; r++) hPt += sheet.rowHeight(r) ?? 13.2;
    const innerW = wPx - 2 * INSET_PX;
    const innerH = (hPt * 96) / 72 - 2 * INSET_PX;
    // Only the columns spread; the inset is a fixed offset.
    const drawnW = wPx * WIDTH_SPREAD - 2 * INSET_PX;

    const rid = `rIdPhoto${i + 1}`;
    const name = `image${i + 1}.${info.ext}`;
    media.push({ path: `xl/media/${name}`, bytes });
    links.push(`<Relationship Id="${rid}" Type="${IMAGE_REL}" Target="../media/${name}"/>`);

    const toColOff = colPx(sheet.colWidth(to.colNum)) * EMU_PER_PX - inset;
    const toRowOff = Math.round((sheet.rowHeight(to.row) ?? 13.2) * EMU_PER_PT) - inset;
    anchors.push(
      '<xdr:twoCellAnchor editAs="oneCell">' +
        `<xdr:from><xdr:col>${from.colNum - 1}</xdr:col><xdr:colOff>${inset}</xdr:colOff><xdr:row>${from.row - 1}</xdr:row><xdr:rowOff>${inset}</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${to.colNum - 1}</xdr:col><xdr:colOff>${toColOff}</xdr:colOff><xdr:row>${to.row - 1}</xdr:row><xdr:rowOff>${toRowOff}</xdr:rowOff></xdr:to>` +
        '<xdr:pic>' +
        `<xdr:nvPicPr><xdr:cNvPr id="${FIRST_ID + i}" name="Photo ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
        `<xdr:blipFill><a:blip r:embed="${rid}"/><a:srcRect${coverCrop(info.width, info.height, drawnW, innerH)}/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
        `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(innerW * EMU_PER_PX)}" cy="${Math.round(innerH * EMU_PER_PX)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
        '</xdr:pic><xdr:clientData/></xdr:twoCellAnchor>'
    );
  });

  // The template's drawing only ever held checkboxes, so its root declares no `r:` prefix.
  const rootEnd = drawing.indexOf('>', drawing.indexOf('<xdr:wsDr'));
  let out = drawing;
  if (!drawing.slice(0, rootEnd).includes('xmlns:r=')) out = out.replace('<xdr:wsDr ', `<xdr:wsDr xmlns:r="${R_NS}" `);
  out = out.replace('</xdr:wsDr>', `${anchors.join('')}</xdr:wsDr>`);
  return {
    drawing: out,
    rels: rels.replace('</Relationships>', `${links.join('')}</Relationships>`),
    media,
    placed: usable.length,
    lastRow,
  };
}
