import { createClient } from '@supabase/supabase-js';

/**
 * Supabase admin client — service role key, server-side only.
 * Never import this in a 'use client' file.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
