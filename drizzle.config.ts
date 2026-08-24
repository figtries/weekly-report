import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/schema.ts',
  out: './data/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.REPORT_DB_PATH || './data/report.db',
  },
} satisfies Config;
