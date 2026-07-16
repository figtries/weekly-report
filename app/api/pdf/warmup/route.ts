import type { NextRequest } from 'next/server';
import { warmPdfRenderer } from '@/lib/pdf';

// SavePdfButton pings this the moment it appears on screen, so the seconds of
// Chromium boot happen while the user is still reading — not after they tap.
// The button also sends its own PDF url as ?for=; when it maps to a report we
// know, the warmed browser pre-loads that print page too (page function, data
// cache, client chunks — see warmPdfRenderer).
// Same maxDuration as the real PDF routes: identical config keeps this handler
// bundled into the same Vercel function, so the browser this boots is the very
// instance the download reuses. (Covered by the '/api/pdf/**' tracing include
// in next.config.ts, which ships the Chromium binary into the lambda.)
export const maxDuration = 60;

// Only ever pre-load our own print pages: ?for= must be one of the two PDF
// route shapes (same week/date/only rules those routes enforce), and the
// target is rebuilt from the validated pieces on this request's origin —
// caller text never reaches the browser.
const REPORT_KEYS = ['summary', 'detail', 'scurve', 'documentation'];

function printTargetFor(pdfUrl: string, origin: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(pdfUrl, origin);
  } catch {
    return null;
  }
  const weekly = parsed.pathname.match(/^\/api\/pdf\/weekly\/(\d{1,3})$/);
  if (weekly) {
    const target = new URL(`/print/weekly/${weekly[1]}`, origin);
    const only = parsed.searchParams.get('only');
    if (only !== null) {
      if (!REPORT_KEYS.includes(only)) return null;
      target.searchParams.set('only', only);
    }
    return target.toString();
  }
  const daily = parsed.pathname.match(/^\/api\/pdf\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (daily) return new URL(`/print/daily/${daily[1]}`, origin).toString();
  return null;
}

export async function GET(req: NextRequest) {
  const pdfUrl = req.nextUrl.searchParams.get('for');
  const target = pdfUrl ? printTargetFor(pdfUrl, req.nextUrl.origin) : null;
  try {
    await warmPdfRenderer(target ?? undefined);
  } catch (error) {
    // A failed warmup must never surface anywhere a user can see it — the real
    // PDF route retries the launch and reports its own error.
    console.error('PDF warmup failed:', error);
  }
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
