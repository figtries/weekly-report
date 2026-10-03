import type { NextRequest } from 'next/server';
import { getOpenDb, getOpenJsonDb, getOpenWeekRollup } from '@/lib/data';
import { readUploadedPhoto } from '@/lib/upload';
import { weeklyPhotosOf } from '@/lib/weekly-photos';
import { weightGate } from '@/lib/weight-gate';
import { buildWeeklyWorkbook } from '@/lib/xlsx/weekly-export';
import { gatherWeeklyExport, hasFigures, parseSelection, selectionCount } from '@/lib/xlsx/weekly-input';

export const maxDuration = 60;

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * The weekly report as one workbook in the look of the client's own (3 Oct 2026,
 * docs/superpowers/specs/2026-10-03-weekly-excel-export-design.md).
 *
 * `?doc=1&sum=1&det=overall&det=<package>&sc=...` picks the sheets (the pop-up in
 * WeekTabs writes it). The project is the OPEN one, read in the user's own request,
 * and every figure is the screens' own (lib/xlsx/weekly-input.ts). While the weights
 * do not close the figure sheets are refused, as every other surface holds them; the
 * photos can still leave. `?warm=1` answers at once, so the button can wake the
 * function before it is pressed.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { week: raw } = await params;
  const q = req.nextUrl.searchParams;
  if (q.get('warm') === '1') return new Response(null, { status: 204 });

  const week = Number(raw);
  if (!Number.isInteger(week) || week < 1) return new Response('Bad week', { status: 400 });
  const sel = parseSelection(q);
  if (selectionCount(sel) === 0) return new Response('Choose at least one sheet', { status: 400 });

  const [db, rollup] = await Promise.all([getOpenDb(), getOpenWeekRollup(week)]);
  if (!rollup) return new Response(`No week ${week} in this project`, { status: 404 });
  const gate = weightGate(db.wbsItems);
  if (hasFigures(sel) && !gate.ok) {
    return new Response('Progress figures are held until every activity has a budget and the weights total 100%', { status: 409 });
  }

  const json = await getOpenJsonDb();
  const input = gatherWeeklyExport({ db, roots: rollup.roots, week, photoSlots: weeklyPhotosOf(json, week) });
  const loaded = sel.documentation ? await Promise.all(input.photos.map(readUploadedPhoto)) : [];
  const photos = loaded.filter((b): b is Buffer => b !== null);

  let book: Awaited<ReturnType<typeof buildWeeklyWorkbook>>;
  try {
    book = await buildWeeklyWorkbook(input, sel, photos);
  } catch (error) {
    // Where curl and the function log can see it, as the PDF routes do.
    console.error('Weekly Excel export failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`Excel export failed: ${message}`, { status: 500 });
  }

  return new Response(new Uint8Array(book.bytes), {
    headers: {
      'Content-Type': XLSX,
      'Content-Disposition': `attachment; filename="${book.fileName.replace(/"/g, '')}"`,
      // Explicit length so the button can count the transfer up.
      'Content-Length': String(book.bytes.byteLength),
      'Cache-Control': 'no-store',
      'X-Excel-Sheets': String(book.sheets.length),
    },
  });
}
