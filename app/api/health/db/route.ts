/**
 * What the deployed instance actually has.
 *
 * Every "the project I just made is gone" report on Vercel has the same three
 * candidate causes — no blob store attached, a store that is attached but
 * failing, or a write that never ran — and from outside the lambda they look
 * identical: a 404 on a project the previous screen created. This route makes
 * the instance say which one it is, without ever printing the token.
 *
 * GET /api/health/db
 */
import { connection } from 'next/server';
import { NextResponse } from 'next/server';

import { DB_PATH, DB_IS_EPHEMERAL } from '@/lib/db-path';
import { blobTokenName, snapshotConfigured } from '@/lib/db-snapshot';
import { db, schema } from '@/lib/sqlite';

/** Per-instance, so two calls landing on two lambdas are distinguishable. */
const INSTANCE = Math.random().toString(36).slice(2, 8);
const BOOTED = Date.now();

export async function GET() {
  await connection();

  let projects: { count: number; ids: string[] } | { error: string };
  try {
    const rows = db.select({ id: schema.projects.id }).from(schema.projects).all();
    projects = { count: rows.length, ids: rows.map((r) => r.id) };
  } catch (err) {
    projects = { error: (err as Error).message };
  }

  const token = blobTokenName ? process.env[blobTokenName] : undefined;

  let blob: unknown = { skipped: 'no blob token in this environment' };
  if (token) {
    try {
      const { list } = await import('@vercel/blob');
      const res = await list({ token, limit: 10 });
      blob = {
        ok: true,
        objects: res.blobs.map((b) => ({ pathname: b.pathname, size: b.size, at: b.uploadedAt })),
      };
    } catch (err) {
      blob = { ok: false, error: (err as Error).message };
    }
  }

  return NextResponse.json(
    {
      instance: INSTANCE,
      upMs: Date.now() - BOOTED,
      region: process.env.VERCEL_REGION ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      // Names only. A store connected under a prefix is the failure this
      // exists to name, and the name is the whole diagnosis.
      blobTokenName,
      storeEnvNames: Object.keys(process.env)
        .filter((n) => /BLOB|KV_|REDIS|STORE/i.test(n))
        .sort(),
      snapshotConfigured,
      dbIsEphemeral: DB_IS_EPHEMERAL,
      dbPath: DB_PATH,
      projects,
      blob,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
