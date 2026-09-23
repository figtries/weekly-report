import { NextRequest, NextResponse } from 'next/server';

import { readLeafLog } from '@/lib/week-log-read';

/**
 * One activity's week-by-week log, for the panel that is opening it.
 *
 * A GET and not a server action, on purpose — see `lib/week-log-read.ts`.
 * Server actions queue one at a time and are for mutations; the log loaded
 * through one sometimes never arrived until a refresh. A GET runs alongside
 * whatever else the page is doing, can be retried by the panel, and does not
 * depend on an action id that changes with every deployment.
 *
 * `?project=` names the project the page was rendered for; without it the
 * open project's cookie answers. `no-store`: this is a figure somebody may
 * have saved a second ago.
 */
export async function GET(request: NextRequest) {
  const node = request.nextUrl.searchParams.get('node');
  const project = request.nextUrl.searchParams.get('project');
  if (!node) return NextResponse.json({ error: 'Which activity?' }, { status: 400 });
  try {
    const log = await readLeafLog(node, project || null);
    return NextResponse.json({ log }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('leaf-weeks', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not read the weeks' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
