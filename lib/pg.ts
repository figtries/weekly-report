/**
 * Drizzle ORM — PostgreSQL connection (Supabase).
 *
 * Two URLs:
 *   DATABASE_URL          — direct connection (port 5432), used by migrations
 *                           and during local development.
 *   DATABASE_URL_POOLER   — Supabase pgbouncer (port 6543, transaction mode),
 *                           used in serverless functions on Vercel where many
 *                           lambdas would exhaust a direct connection pool.
 *
 * Both are set in .env.local; only the pooler is set on Vercel.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

type DbClient = ReturnType<typeof postgres>;

// In development, avoid recreating the connection on every hot-reload.
const globalForDb = globalThis as unknown as { _pgClient?: DbClient };

function createClient(): DbClient {
  // Prefer the pgbouncer pooler in all environments. Direct connection
  // (db.<ref>.supabase.co) may not resolve in all network configurations;
  // the pooler (pooler.supabase.com) works everywhere and is required on
  // serverless (Vercel) to avoid exhausting Supabase's connection limit.
  const url = process.env.DATABASE_URL_POOLER ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL or DATABASE_URL_POOLER must be set');
  return postgres(url, {
    // Required for pgbouncer in transaction mode (Supabase Pooler).
    // Harmless on a direct connection.
    prepare: false,
    // Supabase requires SSL. 'require' skips certificate verification, which is
    // fine for the pooler (the host is verified by DNS/TLS SNI).
    ssl: 'require',
  });
}

const client = globalForDb._pgClient ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForDb._pgClient = client;
}

export const db = drizzle(client, { schema });
export type Db = typeof db;
