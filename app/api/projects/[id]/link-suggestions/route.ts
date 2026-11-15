import { connection } from 'next/server';
import { NextResponse } from 'next/server';

import { buildProjectDashboardData } from '@/lib/dashboard-db';
import { unansweredLinks } from '@/lib/forecast-epc';

/**
 * EPC order's link guesses for activities nobody has answered, for the Links
 * panel in Projects. Fetched only when a never-asked activity's panel opens, so
 * the planner's own load pays nothing for them. A GET route and not a server
 * action: a client READ goes through a route it can retry.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const data = await buildProjectDashboardData(id);
  const items = data?.db.wbsItems ?? [];
  return NextResponse.json(Object.fromEntries(unansweredLinks(items)), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
