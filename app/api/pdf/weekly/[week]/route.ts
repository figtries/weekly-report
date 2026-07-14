import type { NextRequest } from 'next/server';
import { renderReportPdf } from '@/lib/pdf';

// Chromium is slow to boot: give the function room. (No `runtime`/`dynamic`
// segment config — cacheComponents rejects both; a route handler is dynamic by
// default anyway.)
export const maxDuration = 60;

const LABELS = {
  summary: 'Overall Summary',
  detail: 'Detail Progress',
  scurve: 'S-Curve',
  documentation: 'Documentation',
} as const;

export async function GET(req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { week } = await params;
  if (!/^\d{1,3}$/.test(week)) return new Response('Bad week', { status: 400 });

  const only = req.nextUrl.searchParams.get('only');
  // Only ever render our own pages: the target is built from a validated week
  // and a key from this table, never from caller-supplied text.
  if (only !== null && !(only in LABELS)) return new Response('Unknown report', { status: 400 });
  const key = only as keyof typeof LABELS | null;

  const target = new URL(`/weekly/${week}/print`, req.nextUrl.origin);
  if (key) target.searchParams.set('only', key);

  const pdf = await renderReportPdf(target.toString());
  const name = `Week ${week} - ${key ? LABELS[key] : 'Weekly Report'}.pdf`;

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      // inline: phones open it in the viewer, where Print and Share live
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}
