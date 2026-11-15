import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/schema.ts',
  out: './supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Use DATABASE_URL for migrations (session pooler, port 5432, or direct when available).
    // The transaction pooler (DATABASE_URL_POOLER, port 6543) cannot be used for migrations
    // because drizzle-kit uses prepared statements internally.
    url: process.env.DATABASE_URL ?? '',
    ssl: true,
  },
} satisfies Config;
