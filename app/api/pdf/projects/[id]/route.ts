import type { NextRequest } from 'next/server';
import { renderReportPdf } from '@/lib/pdf';
import { getProject } from '@/lib/projects';
import { refreshDbSnapshot } from '@/lib/sqlite';

// The Gantt PDF: /print/projects/[id] rendered by the same Chromium as the
// weekly report. Same maxDuration as the other PDF routes, so it shares their
// function and the browser the warmup route booted.
export const maxDuration = 60;

const ID = /^[\w-]{1,80}$/;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) return new Response('Bad project', { status: 400 });
  const scope = req.nextUrl.searchParams.get('scope') ?? 'all';
  const levels = req.nextUrl.searchParams.get('levels') ?? '0';
  // Only our own page, rebuilt from validated pieces: caller text never reaches the browser.
  const scopeIds = scope.split(',');
  if (scope !== 'all' && (scopeIds.length > 200 || !scopeIds.every((s) => ID.test(s)))) return new Response('Bad scope', { status: 400 });
  if (!/^\d{1,2}$/.test(levels)) return new Response('Bad levels', { status: 400 });
  // A project another instance made seconds ago: pull the snapshot once before saying no.
  let project = getProject(id);
  if (!project && (await refreshDbSnapshot())) project = getProject(id);
  if (!project) return new Response('No such project', { status: 404 });

  const target = new URL(`/print/projects/${id}`, req.nextUrl.origin);
  target.searchParams.set('scope', scope);
  target.searchParams.set('levels', levels);
  for (const k of ['client', 'contractor']) {
    if (req.nextUrl.searchParams.get(k) === '1') target.searchParams.set(k, '1');
  }

  let pdf: Uint8Array;
  try {
    pdf = await renderReportPdf(target.toString());
  } catch (error) {
    console.error('PDF render failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new Response(`PDF render failed: ${message}`, { status: 500 });
  }
  const name = `${[project.alias, project.name].filter(Boolean).join(' - ').replace(/[^\w .()-]/g, '').replace(/\s+/g, ' ').trim() || 'Project'} - Schedule.pdf`;

  return new Response(pdf as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}"`,
      // Lets SavePdfButton count the download up.
      'Content-Length': String(pdf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}
