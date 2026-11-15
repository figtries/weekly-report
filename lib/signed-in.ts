'use client';

/*
 * FASE 2 compatibility shim — replaces the old scrypt/Redis auth-store.
 *
 * AccessGate, Sidebar and AccessBoard still import from here; this file keeps
 * those component imports compiling while FASE 4 wires up proper RBAC via
 * get-session.ts / require-edit.ts.
 *
 * RBAC contract until FASE 4: every signed-in user has Master access (edit
 * everywhere). canOpen() always returns true; useCurrentAccount() synthesises
 * a master Account from the Supabase session.
 */

import { createBrowserClient } from '@supabase/ssr';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AreaKey, Access } from './roles';
import { AREAS, NO_ACCESS, ROLES } from './roles';
import type { Account } from './roles';

// ─── Re-export signOut so Sidebar's existing import keeps working ────────────
export { signOut } from './supabase/auth-actions';

// ─── Supabase client (browser) ───────────────────────────────────────────────
function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// ─── areaOf — maps a pathname to an AreaKey ───────────────────────────────────
const PATH_AREA: Array<[string, AreaKey]> = [
  ['/weekly', 'weekly'],
  ['/dokumen', 'dokumen'],
  ['/daily', 'daily'],
  ['/projects', 'projects'],
  ['/roles', 'roles'],
  ['/overall', 'overall'],
  ['/dashboard', 'dashboard'],
  ['/', 'dashboard'],
];

export function areaOf(pathname: string): AreaKey {
  const hit = PATH_AREA.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return (hit?.[1] ?? 'dashboard') as AreaKey;
}

// ─── canOpen — always true until FASE 4 ──────────────────────────────────────
export function canOpen(_account: Account | null, _area: AreaKey | null): boolean {
  return true;
}

// ─── Account store ────────────────────────────────────────────────────────────
let _account: Account | null = null;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => fn());
}

function masterAccount(id: string, email: string): Account {
  const allEdit = Object.fromEntries(AREAS.map((a) => [a.key, 'edit' as Access])) as Record<AreaKey, Access>;
  return {
    id,
    name: email.split('@')[0] ?? email,
    email,
    master: true,
    preset: 'master',
    status: 'active',
    lastActive: new Date().toISOString(),
    projects: 'all',
    access: allEdit,
  };
}

// ─── syncAuth — refresh account from Supabase session ────────────────────────
export async function syncAuth(): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  _account = user ? masterAccount(user.id, user.email ?? '') : null;
  notify();
}

// ─── useCurrentAccount ────────────────────────────────────────────────────────
export function useCurrentAccount(): Account | null {
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void syncAuth();
  }, []);

  return useSyncExternalStore(
    (cb) => { _listeners.add(cb); return () => _listeners.delete(cb); },
    () => _account,
    () => null,
  );
}

// ─── FASE 2 stubs — full implementations land in FASE 4 ─────────────────────

export type { Account };

/** @deprecated FASE 4 will replace this with get-session.ts */
export function useRoles(): import('./roles').Role[] {
  return ROLES.filter((r) => !r.master);
}

// ─── Accounts store — shared refetch trigger ─────────────────────────────────
const _accountRefetchListeners = new Set<() => void>();
function _triggerAccountRefetch() {
  _accountRefetchListeners.forEach((fn) => fn());
}

/** Returns all Supabase auth users mapped to Account shape. Refetches after every saveAccounts(). */
export function useStoredAccounts(): Account[] {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ver, setVer] = useState(0);

  useEffect(() => {
    const cb = () => setVer((v) => v + 1);
    _accountRefetchListeners.add(cb);
    return () => { _accountRefetchListeners.delete(cb); };
  }, []);

  useEffect(() => {
    fetch('/api/accounts')
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d.accounts)) setAccounts(d.accounts); })
      .catch(() => {});
  }, [ver]);

  return accounts;
}

/** Upserts the accounts array to Supabase auth via /api/accounts, then triggers a refetch. */
export async function saveAccounts(accounts: Account[]): Promise<void> {
  const res = await fetch('/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accounts }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? 'Failed to save accounts');
  }
  _triggerAccountRefetch();
}

/** @deprecated FASE 4 will replace this with proper RBAC writes */
export async function saveRoles(_data: unknown): Promise<void> {}

// ─── Legacy exports kept for any import that hasn't migrated yet ──────────────
export async function fetchAuth() {
  return { needsSetup: false, me: null, accounts: [], roles: [] };
}

/** @deprecated use lib/supabase/auth-actions signOut */
export { NO_ACCESS };
