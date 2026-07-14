import type { NextRequest } from 'next/server';
import { renderReportPdf } from '@/lib/pdf';

export const maxDuration = 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Bad date', { status: 400 });

  const target = new URL(`/daily/${date}/print`, req.nextUrl.origin);
  const pdf = await renderReportPdf(target.toString());

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Daily Report ${date}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
