import ExcelJS from 'exceljs';

import { getRegisterExportRows } from '@/lib/register';
import type { RegisterKind } from '@/lib/schema';

/**
 * The register, out as a workbook — in the shape the importer reads back.
 *
 * The first sheet is deliberately the same grid `lib/register-paste.ts`
 * understands: an outline code (`A`, `A.1`, `A.1.1`) or a running number in the
 * first column, the document number in the second, the title in the third. So
 * an exported file can be edited in Excel by whoever prefers Excel and imported
 * again without anyone having to agree on a schema first.
 *
 * A second sheet carries the history — stage, dates, transmittals, return code
 * — which is what makes this a backup rather than only a list. Nothing reads
 * that one back: it is for people, and for the client's own file.
 */
// No `export const dynamic` here: under `cacheComponents` that segment config
// is rejected outright by the build. Reading the request's own searchParams is
// what makes this handler per-request, and the register read beneath it is a
// synchronous SQLite query, which needs no Suspense boundary of its own.

const PROJECT_ID = 'gundih';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const register = (url.searchParams.get('register') === 'vdrl' ? 'vdrl' : 'edl') as RegisterKind;
  const rows = getRegisterExportRows(PROJECT_ID, register);

  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet(register.toUpperCase());
  sheet.columns = [
    { header: 'NO', key: 'no', width: 10 },
    { header: 'DOCUMENT / DRAWING NO', key: 'docNo', width: 32 },
    { header: 'DESCRIPTION', key: 'title', width: 60 },
    { header: 'DOC', key: 'kind', width: 8 },
  ];
  sheet.getRow(1).font = { bold: true };

  // Not "History": Excel reserves that sheet name and exceljs refuses it outright.
  const history = workbook.addWorksheet('Transmittal Log');
  history.columns = [
    { header: 'DOCUMENT / DRAWING NO', key: 'docNo', width: 32 },
    { header: 'DESCRIPTION', key: 'title', width: 50 },
    { header: 'STAGE', key: 'stage', width: 10 },
    { header: 'SENT', key: 'sent', width: 14 },
    { header: 'TRANSMITTAL OUT', key: 'sentNo', width: 18 },
    { header: 'RETURNED', key: 'returned', width: 14 },
    { header: 'TRANSMITTAL IN', key: 'returnNo', width: 18 },
    { header: 'CODE', key: 'code', width: 10 },
  ];
  history.getRow(1).font = { bold: true };

  for (const row of rows) {
    const added = sheet.addRow({ no: row.no, docNo: row.docNo, title: row.title, kind: row.kind });
    if (row.isCategory) added.font = { bold: true };

    for (const stage of row.stages) {
      history.addRow({
        docNo: row.docNo,
        title: row.title,
        stage: stage.stage,
        sent: stage.submittedAt ?? '',
        sentNo: stage.submitTransmittal ?? '',
        returned: stage.returnedAt ?? '',
        returnNo: stage.returnTransmittal ?? '',
        code: stage.returnCode ?? '',
      });
    }
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const today = new Date().toISOString().slice(0, 10);

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${register.toUpperCase()}-${today}.xlsx"`,
      'Content-Length': String(buffer.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
