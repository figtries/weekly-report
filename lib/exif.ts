/**
 * Reading a photo's own capture metadata.
 *
 * This is what separates a delay register that is evidence from one that is an
 * assertion. Without it, a photo's date rests on whoever uploaded it, and the
 * other side of an extension-of-time claim only has to point that out.
 *
 * Hand-rolled rather than pulled from a package: we need three tags out of a
 * JPEG's APP1 segment, and the parsers that do this ship a full TIFF reader.
 * The format is fixed and forty years old, so the risk here is low and the
 * dependency is not worth carrying to a phone on site.
 */

export interface PhotoMeta {
  /** ISO string of DateTimeOriginal, in the camera's own local time. */
  takenAt?: string;
  lat?: number;
  lon?: number;
  make?: string;
  model?: string;
}

const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const GPS_LAT_REF = 0x0001;
const GPS_LAT = 0x0002;
const GPS_LON_REF = 0x0003;
const GPS_LON = 0x0004;

export function readPhotoMeta(buf: Buffer): PhotoMeta {
  try {
    return parse(buf);
  } catch {
    // A photo with unreadable or absent EXIF is normal (screenshots, WhatsApp
    // re-encodes, Android gallery strips). It must never fail an upload — the
    // caller records "unverified" instead.
    return {};
  }
}

function parse(buf: Buffer): PhotoMeta {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return {}; // not a JPEG

  // Walk the marker segments looking for APP1/Exif.
  let offset = 2;
  let tiffStart = -1;
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) break;
    const marker = buf.readUInt16BE(offset);
    if (marker === 0xffda) break; // start of scan — no EXIF before the image data
    const size = buf.readUInt16BE(offset + 2);
    if (marker === 0xffe1 && buf.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') {
      tiffStart = offset + 10;
      break;
    }
    offset += 2 + size;
  }
  if (tiffStart < 0 || tiffStart + 8 > buf.length) return {};

  const le = buf.toString('ascii', tiffStart, tiffStart + 2) === 'II';
  const u16 = (p: number) => (le ? buf.readUInt16LE(p) : buf.readUInt16BE(p));
  const u32 = (p: number) => (le ? buf.readUInt32LE(p) : buf.readUInt32BE(p));

  if (u16(tiffStart + 2) !== 0x2a) return {};
  const ifd0 = tiffStart + u32(tiffStart + 4);

  const meta: PhotoMeta = {};
  const readIfd = (start: number, handler: (tag: number, type: number, count: number, valOff: number) => void) => {
    if (start + 2 > buf.length) return;
    const n = u16(start);
    // A corrupt count could otherwise walk us off the end for thousands of
    // iterations; EXIF IFDs are small by construction.
    if (n > 512) return;
    for (let i = 0; i < n; i++) {
      const e = start + 2 + i * 12;
      if (e + 12 > buf.length) return;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = byteSize(type) * count;
      const valOff = size > 4 ? tiffStart + u32(e + 8) : e + 8;
      handler(tag, type, count, valOff);
    }
  };

  const ascii = (p: number, count: number): string =>
    buf.toString('ascii', p, Math.min(p + count, buf.length)).replace(/\0.*$/, '').trim();

  const rational = (p: number): number => {
    const num = u32(p);
    const den = u32(p + 4);
    return den === 0 ? 0 : num / den;
  };

  let exifIfd = -1;
  let gpsIfd = -1;

  readIfd(ifd0, (tag, type, count, valOff) => {
    if (tag === TAG_EXIF_IFD) exifIfd = tiffStart + u32(valOff);
    else if (tag === TAG_GPS_IFD) gpsIfd = tiffStart + u32(valOff);
    else if (tag === TAG_MAKE && type === 2) meta.make = ascii(valOff, count);
    else if (tag === TAG_MODEL && type === 2) meta.model = ascii(valOff, count);
  });

  if (exifIfd > 0) {
    readIfd(exifIfd, (tag, type, count, valOff) => {
      if (tag === TAG_DATETIME_ORIGINAL && type === 2) {
        // EXIF spells it "2026:08:14 07:31:02" — not ISO, and with no zone.
        const raw = ascii(valOff, count);
        const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
        if (m) meta.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      }
    });
  }

  if (gpsIfd > 0) {
    let latRef = 'N';
    let lonRef = 'E';
    let lat: number | undefined;
    let lon: number | undefined;
    readIfd(gpsIfd, (tag, type, count, valOff) => {
      if (tag === GPS_LAT_REF && type === 2) latRef = ascii(valOff, count) || 'N';
      else if (tag === GPS_LON_REF && type === 2) lonRef = ascii(valOff, count) || 'E';
      else if (tag === GPS_LAT && count === 3) lat = dms(valOff, rational);
      else if (tag === GPS_LON && count === 3) lon = dms(valOff, rational);
    });
    if (lat !== undefined && lon !== undefined) {
      meta.lat = latRef.toUpperCase().startsWith('S') ? -lat : lat;
      meta.lon = lonRef.toUpperCase().startsWith('W') ? -lon : lon;
    }
  }

  return meta;
}

function dms(p: number, rational: (p: number) => number): number {
  return rational(p) + rational(p + 8) / 60 + rational(p + 16) / 3600;
}

function byteSize(type: number): number {
  switch (type) {
    case 1:
    case 2:
    case 6:
    case 7:
      return 1;
    case 3:
    case 8:
      return 2;
    case 4:
    case 9:
    case 11:
      return 4;
    case 5:
    case 10:
    case 12:
      return 8;
    default:
      return 1;
  }
}

/** Human-readable coordinates for a report — six decimals is ~10 cm, plenty. */
export function formatCoords(lat: number, lon: number): string {
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}
