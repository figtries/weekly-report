import { NextResponse, type NextRequest } from 'next/server';

import { accountOf, readAuth, SESSION_COOKIE } from '@/lib/auth-store';

/*
 * Nothing opens without a signed-in account (12 Nov 2026). Server Functions
 * post to their page's path, so they pass through here too.
 * Left open: /login and /api/auth (the way in), /print/* (headless Chromium
 * renders the PDFs with no cookie; the /api/pdf route that launches it is
 * itself guarded), /api/health, and static files.
 * ponytail: guards sign-in only; View / No access per page is still the
 * client's cover (AccessGate). Check access inside each action if a View
 * account must be stopped from writing.
 */
export async function proxy(req: NextRequest) {
  const doc = await readAuth();
  if (accountOf(doc, req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  const { pathname, search } = req.nextUrl;
  const page = req.method === 'GET' && !pathname.startsWith('/api/') && !req.headers.has('rsc');
  if (!page) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const to = new URL('/login', req.url);
  if (pathname !== '/') to.searchParams.set('next', pathname + search);
  const res = NextResponse.redirect(to);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

export const config = {
  matcher: [
    '/((?!login|api/auth|api/health|print/|_next/|uploads/|favicon|.*\\.(?:png|jpe?g|webp|svg|ico|gif|woff2?|txt|xml|webmanifest)$).*)',
  ],
};
