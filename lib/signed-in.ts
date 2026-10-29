'use client';

import { useSyncExternalStore } from 'react';

import { SEED_ACCOUNTS } from '@/lib/roles';

/*
 * Who signed in, as a DRAFT until login exists (board item 22): the sign-in
 * screen checks nothing, so it only remembers the email it was given, in this
 * browser. The sidebar reads it to decide its foot: the Master keeps Roles and
 * gets Log out, any other account gets Log out in Roles' place (29 Oct 2026).
 * Nobody signed in reads as before, Roles alone. Nothing here restricts a URL.
 */

const KEY = 'lucille-signed-in';
const EVENT = 'lucille-signed-in';

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(email: string | null) {
  try {
    if (email) window.localStorage.setItem(KEY, email);
    else window.localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export const signIn = (email: string) => write(email.trim().toLowerCase());
export const signOut = () => write(null);

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}

/** The signed-in email, or null; always null on the server and through hydration. */
export function useSignedIn(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function isMasterEmail(email: string): boolean {
  return SEED_ACCOUNTS.some((a) => a.master && a.email.toLowerCase() === email);
}
