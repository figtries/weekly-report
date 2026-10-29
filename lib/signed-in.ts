'use client';

import { useSyncExternalStore } from 'react';

import { NO_ACCESS, ROLES, SEED_ACCOUNTS, type Account, type AreaKey, type Role } from '@/lib/roles';

/*
 * Who signed in and what each account may open, as a DRAFT until login exists
 * (board item 22). Both live in THIS BROWSER only: the Master's changes on
 * Roles are saved here, and signing in here as another account shows what that
 * account can open (29 Oct 2026). The Master sets each account's password and
 * edits the roles; an account given no password uses DEMO_PASSWORD. Passwords
 * sit in plain text in this browser and nothing on the server checks any of
 * it: a hidden page is hidden, not protected.
 *
 * Nobody signed in reads as the Master, which is how the app behaved before.
 */

export const DEMO_PASSWORD = 'lucille2026';

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

/** The seed with its project indices resolved; with no list, scopes come out empty. */
export function seedAccounts(projectIds: string[] = []): Account[] {
  return SEED_ACCOUNTS.map((s) => ({
    ...s,
    projects: s.projects === 'all' ? 'all' : s.projects.map((i) => projectIds[i]).filter((x): x is string => !!x),
  }));
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

/** What the Master saved on Roles, or null until anything has been. */
export function useStoredAccounts(): Account[] | null {
  return useSyncExternalStore(subscribe, storedAccounts, () => null);
}

/** The roles an account can start from: the Master's edits, else the seed. The Master's own is never one. */
export const SEED_ROLES: Role[] = ROLES.filter((r) => !r.master);
export function useRoles(): Role[] {
  return useSyncExternalStore(subscribe, storedRoles, () => null) ?? SEED_ROLES;
}
export const saveRoles = (list: Role[]) => put(ROLE_LIST, JSON.stringify(list));

export const passwordOf = (a: Account) => a.password || DEMO_PASSWORD;

export const saveAccounts = (list: Account[]) => put(ACCOUNTS, JSON.stringify(list));

export function findAccount(email: string): Account | null {
  const e = email.trim().toLowerCase();
  return (storedAccounts() ?? seedAccounts()).find((a) => a.email.toLowerCase() === e) ?? null;
}

/** Signs in and marks an invited account active, the way a first sign-in would. */
export function signIn(account: Account) {
  const list = storedAccounts() ?? seedAccounts();
  if (account.status === 'invited' || account.lastActive !== 'Now')
    saveAccounts(list.map((a) => (a.id === account.id ? { ...a, status: a.status === 'invited' ? 'active' : a.status, lastActive: 'Now' } : a)));
  put(WHO, account.email.toLowerCase());
}

export const signOut = () => put(WHO, null);

/** The signed-in email, or null; always null on the server and through hydration. */
export function useSignedIn(): string | null {
  return useSyncExternalStore(subscribe, () => get(WHO), () => null);
}

/** The signed-in account, or null for nobody (who reads as the Master). Hooks
 *  re-read on every sign-in, sign-out and save, in this tab and others. */
export function useCurrentAccount(): Account | null {
  const who = useSignedIn();
  const stored = useStoredAccounts();
  if (!who) return null;
  // An account the Master removed since opens nothing, never everything.
  return (
    (stored ?? seedAccounts()).find((a) => a.email.toLowerCase() === who) ??
    { id: 'removed', name: '', email: who, preset: null, status: 'suspended', lastActive: null, projects: [], access: NO_ACCESS }
  );
}

export function canOpen(account: Account | null, area: AreaKey | null): boolean {
  if (!account || account.master || !area) return true;
  return account.status !== 'suspended' && account.access[area] !== 'none';
}

/** Which Roles row a path belongs to; null for pages no row covers (login, print). */
export function areaOf(pathname: string): AreaKey | null {
  if (pathname === '/') return 'dashboard';
  if (/^\/weekly\/[^/]+\/(overall|control|weights)(\/|$)/.test(pathname)) return 'overall';
  if (pathname.startsWith('/weekly')) return 'weekly';
  if (pathname.startsWith('/daily')) return 'daily';
  if (pathname.startsWith('/dokumen')) return 'dokumen';
  if (pathname.startsWith('/projects') || pathname.startsWith('/portfolio')) return 'projects';
  if (pathname.startsWith('/roles') || pathname.startsWith('/settings')) return 'roles';
  return null;
}
