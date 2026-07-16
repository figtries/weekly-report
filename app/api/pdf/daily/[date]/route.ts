import type { NextRequest } from 'next/server';
import { renderReportPdf } from '@/lib/pdf';

export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Bad date', { status: 400 });

  const target = new URL(`/print/daily/${date}`, req.nextUrl.origin);
  let pdf: Uint8Array;
  try {
    pdf = await renderReportPdf(target.toString());
  } catch (error) {
    // Same as the weekly route: put the real failure where curl and the
    // Vercel function log can see it.
    console.error('PDF render failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`PDF render failed: ${message}`, { status: 500 });
  }

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Daily Report ${date}.pdf"`,
      // Explicit length so SavePdfButton can count the transfer up — on a
      // phone the download is most of the wait.
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
