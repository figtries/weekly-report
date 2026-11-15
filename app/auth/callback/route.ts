import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

/*
 * Email verification callback — Supabase redirects here after a user clicks
 * the confirmation link in the sign-up email.
 *
 * The URL looks like:
 *   /auth/callback?code=<pkce-code>&next=/path
 *
 * We exchange the code for a session, write the session cookies, then redirect
 * the user to `next` (or /). The middleware excludes /auth/ from its matcher,
 * so this route is always reachable without an existing session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', origin));
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {}
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('[auth/callback]', error.message);
    return NextResponse.redirect(new URL('/login?error=callback_failed', origin));
  }

  // Safe redirect — only follow a relative path.
  const destination = /^\/(?!\/)/.test(next) ? next : '/';
  return NextResponse.redirect(new URL(destination, origin));
}
