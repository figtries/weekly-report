import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

/*
 * Auth endpoints — thin wrappers over Supabase Auth.
 *
 * GET  → current user (email + id), or null if not signed in.
 * POST { action: 'logout' } → sign out.
 *
 * Login is handled client-side via supabase.auth.signInWithPassword
 * (see components/login/LoginScreen.tsx → lib/supabase/auth-actions.ts).
 * Email verification redirect is handled by app/auth/callback/route.ts.
 */

async function serverClient() {
  const cookieStore = await cookies();
  return createServerClient(
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
}

export async function GET() {
  const supabase = await serverClient();
  const { data: { user } } = await supabase.auth.getUser();
  return NextResponse.json(
    { user: user ? { id: user.id, email: user.email } : null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };

  if (body.action === 'logout') {
    const supabase = await serverClient();
    await supabase.auth.signOut();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
