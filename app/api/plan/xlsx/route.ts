/**
 * A workbook goes in, the grid a paste produces comes out.
 *
 * A ROUTE rather than a server action, for one reason: size. A server action's
 * body is capped at 1 MB by default, and these weekly workbooks are 6.8 MB and
 * upwards, so `readRegisterFile`-style upload would refuse the only files
 * anyone actually has. The route takes the file as the raw request body and
 * hands the stream straight to `lib/plan-xlsx.ts`, so nothing is buffered on
 * the way through and the 2 GB heap that killed `readFile` on a workbook this
 * size is never approached.
 *
 * It writes NOTHING. The text that comes back goes into the same preview and
 * the same `applyPasteAction` a pasted plan does, which is where the project is
 * named, the rows are counted, and a person presses Insert.
 */
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';

import { readPlanWorkbook } from '@/lib/plan-xlsx';

// No `export const runtime` or `export const dynamic` here: under
// `cacheComponents` both segment configs are rejected outright by the build.
// Reading the request body is what makes this handler per-request, and the
// node stream below is what keeps it on the Node runtime.

export async function POST(request: Request): Promise<Response> {
  if (!request.body) {
    return Response.json({ ok: false, error: 'No file arrived' }, { status: 400 });
  }
  try {
    const stream = Readable.fromWeb(request.body as unknown as NodeWebReadableStream<Uint8Array>);
    const read = await readPlanWorkbook(stream);
    return Response.json({ ok: true, ...read });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'That file could not be read as a workbook';
    return Response.json({ ok: false, error: message }, { status: 400 });
  }
}
