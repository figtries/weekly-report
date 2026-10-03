import { NextResponse } from 'next/server';

import { getRegisterOutline } from '@/lib/register';

/**
 * Another project's register as headings and titles, for the builder's
 * "Copy from another project". A GET route rather than a server action: a
 * read through an action left a screen blank until refresh once, and this one
 * can be retried (see memory, never-read-through-server-action).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const project = url.searchParams.get('project') ?? '';
  const register = url.searchParams.get('register') === 'vdrl' ? 'vdrl' : 'edl';
  if (!project) return NextResponse.json({ error: 'project is required' }, { status: 400 });
  return NextResponse.json(getRegisterOutline(project, register), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
