'use client';

import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';

import { NO_ACCESS, ROLES, type Account, type AreaKey, type Role } from '@/lib/roles';

/*
 * The browser's CACHE of who signed in and what each account may open
 * (12 Nov 2026). The truth is on the server (`app/api/auth`, `lib/auth-store.ts`):
 * sign-in sets an httpOnly cookie and `proxy.ts` opens nothing without it. This
 * copy is what the sidebar, AccessGate and the inline LOCK_SCRIPT read before
 * the first paint; `syncAuth` refreshes it from the server on every load, and
 * every save on Roles goes to the server and comes back from it. Passwords
 * never reach this file except while the Master types a new one.
 */

/** What GET/POST/PUT /api/auth answer. */
export interface AuthView { needsSetup: boolean; me: Account | null; accounts?: Account[]; roles?: Role[] | null }

const WHO = 'lucille-signed-in';
const ACCOUNTS = 'lucille-accounts';
const ROLE_LIST = 'lucille-roles';
const EVENT = 'lucille-signed-in';

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function put(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

// Parsed once per stored string, so a snapshot keeps its identity between reads.
const cache = new Map<string, { raw: string | null; list: unknown[] | null }>();
function stored<T>(key: string): T[] | null {
  const raw = get(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.list as T[] | null;
  let list: T[] | null = null;
  try {
    list = raw ? (JSON.parse(raw) as T[]) : null;
  } catch {}
  cache.set(key, { raw, list });
  return list;
}
const storedAccounts = () => stored<Account>(ACCOUNTS);
const storedRoles = () => stored<Role>(ROLE_LIST);

/** The accounts as the server last said, or null before the first answer. */
export function useStoredAccounts(): Account[] | null {
  return useSyncExternalStore(subscribe, storedAccounts, () => null);
}

/** The roles an account can start from: the Master's edits, else the seed. The Master's own is never one. */
export const SEED_ROLES: Role[] = ROLES.filter((r) => !r.master);
export function useRoles(): Role[] {
  return useSyncExternalStore(subscribe, storedRoles, () => null) ?? SEED_ROLES;
}

/** Writes what the server said into the cache. Someone who may not open Roles caches only themself. */
export function applyAuth(v: AuthView) {
  try {
    window.localStorage.setItem(ACCOUNTS, JSON.stringify(v.accounts ?? (v.me ? [v.me] : [])));
    if (v.roles) window.localStorage.setItem(ROLE_LIST, JSON.stringify(v.roles));
    else window.localStorage.removeItem(ROLE_LIST);
  } catch {}
  put(WHO, v.me ? v.me.email.toLowerCase() : null);
}

async function call(method: string, body?: unknown): Promise<AuthView> {
  const res = await fetch('/api/auth', {
    method,
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data as AuthView;
}

export const fetchAuth = () => call('GET');
export const syncAuth = () => call('GET').then(applyAuth, () => {});

export const login = (email: string, password: string) =>
  call('POST', { action: 'login', email, password }).then((v) => (applyAuth(v), v));
export const setupMaster = (name: string, email: string, password: string) =>
  call('POST', { action: 'setup', name, email, password }).then((v) => (applyAuth(v), v));

/** Saves on the server; the screen moves at once and is put back if the server refuses. */
function save(body: { accounts?: Account[]; roles?: Role[] }) {
  if (body.accounts) put(ACCOUNTS, JSON.stringify(body.accounts.map(({ password: _p, ...a }) => a)));
  if (body.roles) put(ROLE_LIST, JSON.stringify(body.roles));
  return call('PUT', body).then(applyAuth, (e: Error) => {
    toast.error('Not saved', { description: e.message });
    syncAuth();
    throw e;
  });
}
export const saveRoles = (list: Role[]) => void save({ roles: list }).catch(() => {});
export const saveAccounts = (list: Account[]) => save({ accounts: list });

export async function signOut() {
  await call('POST', { action: 'logout' }).catch(() => {});
  try {
    window.localStorage.removeItem(ACCOUNTS);
    window.localStorage.removeItem(ROLE_LIST);
  } catch {}
  put(WHO, null);
}

/** The signed-in email, or null; always null on the server and through hydration. */
export function useSignedIn(): string | null {
  return useSyncExternalStore(subscribe, () => get(WHO), () => null);
}

/** The signed-in account, or null before the cache knows (the server already let
 *  this page through, so nothing is hidden meanwhile). Re-read on every change. */
export function useCurrentAccount(): Account | null {
  const who = useSignedIn();
  const stored = useStoredAccounts();
  if (!who) return null;
  // An account the Master removed since opens nothing, never everything.
  return (
    (stored ?? []).find((a) => a.email.toLowerCase() === who) ??
    { id: 'removed', name: '', email: who, preset: null, status: 'suspended', lastActive: null, projects: [], access: NO_ACCESS }
  );
}

export function canOpen(account: Account | null, area: AreaKey | null): boolean {
  if (!account || account.master || !area) return true;
  return account.status !== 'suspended' && account.access[area] !== 'none';
}

export { areaOf } from '@/lib/access-lock';
