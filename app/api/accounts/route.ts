import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth/get-session';
import { NO_ACCESS } from '@/lib/roles';
import type { Account } from '@/lib/roles';
import { createAdminClient } from '@/lib/supabase/admin';

/*
 * Accounts API — backed by Supabase auth.users (admin API).
 *
 * GET  → Account[] for the Access management page.
 * POST { accounts } → upsert each account into Supabase auth;
 *      new accounts (id not in Supabase) are created,
 *      existing accounts have their user_metadata updated.
 *
 * Extra fields (name, master, preset, projects, access) live in
 * user_metadata so no extra table is needed.
 */

function mapUser(u: {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
  last_sign_in_at?: string | null;
}): Account {
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? '',
    name: (meta.name as string) || (u.email?.split('@')[0] ?? 'Unknown'),
    master: (meta.master as boolean) ?? false,
    preset: (meta.preset as string) ?? null,
    status: u.banned_until ? 'suspended' : u.email_confirmed_at ? 'active' : 'invited',
    lastActive: u.last_sign_in_at ?? null,
    projects: (meta.projects as Account['projects']) ?? 'all',
    access: (meta.access as Account['access']) ?? { ...NO_ACCESS },
  };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 500 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const users = data.users;
  const anyMaster = users.some((u) => (u.user_metadata?.master as boolean) === true);

  // First-run: no Master exists yet — promote the signed-in user automatically.
  if (!anyMaster) {
    await supabase.auth.admin.updateUserById(session.userId, {
      user_metadata: { master: true },
    });
    // Reflect the change in the returned list without a second round-trip.
    const me = users.find((u) => u.id === session.userId);
    if (me) me.user_metadata = { ...(me.user_metadata ?? {}), master: true };
  }

  return NextResponse.json({ accounts: users.map(mapUser) });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { accounts: Account[] } | null;
  if (!body?.accounts) return NextResponse.json({ error: 'accounts required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 500 });
  const existingIds = new Set((existing?.users ?? []).map((u) => u.id));

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  const submittedIds = new Set(body.accounts.map((a) => a.id));

  for (const a of body.accounts) {
    const meta = { name: a.name, master: a.master ?? false, preset: a.preset, projects: a.projects, access: a.access };
    if (existingIds.has(a.id)) {
      const { error: updateErr } = await supabase.auth.admin.updateUserById(a.id, {
        user_metadata: meta,
        ban_duration: a.status === 'suspended' ? '876600h' : 'none',
        ...(a.password ? { password: a.password } : {}),
      });
      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });
    } else {
      // New account: send invitation email so the user sets their own password.
      // redirectTo goes straight to /login; the hash token is handled client-side there.
      const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(a.email, {
        data: meta,
        redirectTo: `${origin}/login`,
      });
      if (inviteErr) return NextResponse.json({ error: `Could not invite ${a.email}: ${inviteErr.message}` }, { status: 500 });
    }
  }

  // Delete accounts removed from the list (never delete Masters).
  for (const u of existing.users) {
    if (!submittedIds.has(u.id) && !(u.user_metadata?.master as boolean)) {
      await supabase.auth.admin.deleteUser(u.id);
    }
  }

  return NextResponse.json({ ok: true });
}
