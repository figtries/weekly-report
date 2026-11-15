import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/*
 * Session refresh + auth guard (Supabase SSR).
 *
 * Every request goes through here. The Supabase client refreshes the session
 * token when needed and writes updated cookies back to both the request and
 * the response, so the lambda that serves the page always has a fresh token.
 *
 * Unauthenticated requests to protected pages are redirected to /login.
 * API routes and Server Actions get a 401 JSON response instead of a redirect.
 * /print/* routes require a short-lived HMAC token (Puppeteer has no session).
 */

// Web-Crypto HMAC verification — works in Edge runtime (no Node.js crypto).
async function verifyPdfTokenEdge(token: string): Promise<boolean> {
  const secret = process.env.AUTH_SECRET;
  if (!secret || !token) return false;
  try {
    const dot = token.lastIndexOf('.');
    if (dot < 0) return false;
    const b64 = token.slice(0, dot);
    const sigHex = token.slice(dot + 1);
    // base64url → bytes → utf-8 string
    const base64 = b64.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (b64.length % 4)) % 4);
    const payloadBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const payload = new TextDecoder().decode(payloadBytes);
    // Constant-time HMAC-SHA256 verify via Web Crypto
    const enc = new TextEncoder();
    const sigBytes = Uint8Array.from((sigHex.match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
    if (!ok) return false;
    const parts = payload.split('|');
    return parts.length >= 3 && Math.floor(Date.now() / 1000) <= Number(parts[2]);
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /print/* uses HMAC token auth — Puppeteer carries it in the URL.
  // This check runs BEFORE the Supabase client is created so no session
  // cookie is needed (Puppeteer has none).
  if (pathname.startsWith('/print/')) {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    const valid = await verifyPdfTokenEdge(token);
    if (!valid) return new Response('Forbidden', { status: 403 });
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write updated cookies to both the outgoing request and the response.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getUser() validates the token with Supabase on every request.
  // This is intentional — using getSession() here would trust the cookie
  // without server verification, which is insecure.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const { pathname: path, search } = request.nextUrl;
    // API routes and Server Actions must receive 401 JSON, never a redirect.
    const isApiRoute = path.startsWith('/api/');
    const isPage = !isApiRoute && request.method === 'GET' && !request.headers.has('rsc');
    if (!isPage) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
    const to = new URL('/login', request.url);
    if (path !== '/') to.searchParams.set('next', path + search);
    return NextResponse.redirect(to);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!login|auth/|api/health|_next/|uploads/|favicon|payment|.*\\.(?:png|jpe?g|webp|svg|ico|gif|woff2?|txt|xml|webmanifest)$).*)',
  ],
};
