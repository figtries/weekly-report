import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import {
  accountOf,
  allEdit,
  checkPassword,
  hashPassword,
  mutateAuth,
  openPassword,
  sealPassword,
  newToken,
  publicAccount,
  readAuth,
  SESSION_COOKIE,
  SESSION_DAYS,
  stamp,
  type AuthDoc,
  type StoredAccount,
} from '@/lib/auth-store';
import type { Account, Role } from '@/lib/roles';

/*
 * The one door for sign-in (lib/auth-store.ts holds the why).
 * GET   who is signed in, whether the first Master is still to be made, and
 *       for anyone who may open Roles, every account and role.
 * POST  { action: 'login' | 'setup' | 'logout', ... }
 *       { action: 'reveal', id } gives a MASTER that account's password, and
 *       nobody else: it is never part of `view`.
 * PUT   { accounts?, roles? } from Roles; the server re-checks every rule.
 */

const MIN_PASSWORD = 6;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });

const seesRoles = (a: StoredAccount | null) => !!a && (!!a.master || a.access.roles !== 'none');
const editsRoles = (a: StoredAccount | null) => !!a && (!!a.master || a.access.roles === 'edit');

function view(doc: AuthDoc, me: StoredAccount | null) {
  return {
    needsSetup: doc.accounts.length === 0,
    me: me && publicAccount(me),
    ...(seesRoles(me) ? { accounts: doc.accounts.map(publicAccount), roles: doc.roles } : {}),
  };
}

async function token() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

async function startSession(doc: AuthDoc, a: StoredAccount) {
  const t = newToken();
  doc.sessions[t] = { id: a.id, exp: Date.now() + SESSION_DAYS * 864e5 };
  (await cookies()).set(SESSION_COOKIE, t, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function GET() {
  const doc = await readAuth();
  return NextResponse.json(view(doc, accountOf(doc, await token())), { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; name?: string; email?: string; password?: string };
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';

  if (body.action === 'reveal') {
    const doc = await readAuth();
    if (!accountOf(doc, await token())?.master) return fail('Only a Master can see passwords.', 403);
    const a = doc.accounts.find((x) => x.id === body.id);
    if (!a) return fail('That account is gone.', 404);
    return NextResponse.json({ password: openPassword(a.sealed) }, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (body.action === 'logout') {
    const t = await token();
    if (t) await mutateAuth((doc) => void delete doc.sessions[t]);
    (await cookies()).delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'setup') {
    const name = (body.name ?? '').trim();
    if (!name) return fail('Type your name.');
    if (!EMAIL.test(email)) return fail('Type a valid email.');
    if (password.length < MIN_PASSWORD) return fail(`Set a password of ${MIN_PASSWORD} or more characters.`);
    const out = await mutateAuth(async (doc) => {
      if (doc.accounts.length) return null;
      const a: StoredAccount = {
        id: `u${Date.now().toString(36)}`, name, email, master: true, preset: null, status: 'active',
        lastActive: stamp(), projects: 'all', access: allEdit(), hash: hashPassword(password),
        sealed: sealPassword(password),
      };
      doc.accounts.push(a);
      await startSession(doc, a);
      return view(doc, a);
    });
    return out ? NextResponse.json(out) : fail('The Master account already exists. Sign in instead.', 409);
  }

  if (body.action === 'login') {
    // ponytail: no rate limit on wrong passwords; add one per email if brute force becomes a worry.
    const out = await mutateAuth(async (doc) => {
      const a = doc.accounts.find((x) => x.email.toLowerCase() === email);
      if (!a || !checkPassword(password, a.hash)) return 'wrong' as const;
      if (a.status === 'suspended') return 'suspended' as const;
      if (a.status === 'invited') a.status = 'active';
      // An account made before passwords were kept: this is the one moment the
      // server holds it, so a Master can read it from the next sign-in on.
      if (openPassword(a.sealed) !== password) a.sealed = sealPassword(password);
      a.lastActive = stamp();
      await startSession(doc, a);
      return view(doc, a);
    });
    if (out === 'wrong') return fail('wrong', 401);
    if (out === 'suspended') return fail('suspended', 403);
    return NextResponse.json(out);
  }

  return fail('Unknown action.');
}

type Refusal = { error: string; status: number };

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { accounts?: Account[]; roles?: Role[] };
  const t = await token();
  const out = await mutateAuth((doc): Refusal | ReturnType<typeof view> => {
    const me = accountOf(doc, t);
    if (!me || !editsRoles(me)) return { error: 'Only the Master can change accounts.', status: 403 };

    if (body.accounts) {
      const before = new Map(doc.accounts.map((a) => [a.id, a]));
      const seen = new Set<string>();
      const next: StoredAccount[] = [];
      for (const raw of body.accounts) {
        const old = before.get(raw.id);
        // Only a Master makes, unmakes or edits a Master.
        if (!me.master && (raw.master || old?.master)) {
          if (old) next.push(old);
          continue;
        }
        const name = (raw.name ?? '').trim();
        const email = (raw.email ?? '').trim().toLowerCase();
        if (!name) return { error: 'Every account needs a name.', status: 400 };
        if (!EMAIL.test(email)) return { error: `"${raw.email}" is not a valid email.`, status: 400 };
        if (seen.has(email)) return { error: `${email} is used by two accounts.`, status: 400 };
        seen.add(email);
        const pw = raw.password ?? '';
        if (pw && pw.length < MIN_PASSWORD) return { error: `${name}: the password needs ${MIN_PASSWORD} or more characters.`, status: 400 };
        if (!pw && !old) return { error: `${name}: set a password first.`, status: 400 };
        const { password: _pw, ...rest } = raw;
        const a: StoredAccount = {
          ...rest, name, email,
          hash: pw ? hashPassword(pw) : old!.hash,
          sealed: pw ? sealPassword(pw) : old!.sealed,
        };
        if (a.master) Object.assign(a, { status: 'active', projects: 'all', access: allEdit(), preset: null });
        else delete a.master;
        next.push(a);
      }
      // A Master missing from a non-Master's save stays as it was.
      if (!me.master) for (const o of doc.accounts) if (o.master && !next.some((a) => a.id === o.id)) next.push(o);

      const self = next.find((a) => a.id === me.id);
      if (!self) return { error: "You can't remove your own account.", status: 400 };
      if (self.status === 'suspended') return { error: "You can't suspend your own account.", status: 400 };
      if (me.master && !self.master) return { error: "You can't take Master away from yourself. Ask another Master.", status: 400 };
      if (!next.some((a) => a.master)) return { error: 'Keep at least one Master.', status: 400 };
      doc.accounts = next;
    }
    if (body.roles) doc.roles = body.roles.filter((r) => !r.master);
    return view(doc, accountOf(doc, t));
  });
  if ('error' in out) return fail(out.error, out.status);
  return NextResponse.json(out);
}
