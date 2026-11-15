'use client';

import { createClient } from './client';

/*
 * Client-side auth helpers used by LoginScreen.
 * Map Supabase auth errors to the status codes LoginScreen already expects:
 *   401 → wrong credentials (shows "Email or password is incorrect")
 *   403 → not confirmed (shows "Email not confirmed" message)
 *   50x → server error
 */
export async function login(email: string, password: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return;

  // Log the raw Supabase error so it's visible in the browser console for debugging.
  console.error('[auth] signInWithPassword error:', error.message, error);

  const msg = error.message.toLowerCase();
  const status = msg.includes('invalid login') || msg.includes('invalid credentials')
    ? 401
    : msg.includes('not confirmed') || msg.includes('email not confirmed')
      ? 403
      : 500;
  throw Object.assign(new Error(error.message), { status });
}

export async function signOut(): Promise<void> {
  const supabase = createClient();
  await supabase.auth.signOut();
  window.location.assign('/login');
}
