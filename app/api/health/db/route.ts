/**
 * What the deployed instance actually has.
 *
 * Every "the project I just made is gone" report on Vercel has the same
 * candidate causes — no store attached, a store attached under credentials the
 * app does not recognise, a store that answers but fails, or a write that never
 * ran — and from outside the lambda they look identical: a 404 on a project the
 * previous screen created. This route makes the instance say which one it is.
 * Names and ids only; no credential is ever printed.
 *
 * GET /api/health/db
 */
import { connection } from 'next/server';
import { NextResponse } from 'next/server';

import { DB_PATH, DB_IS_EPHEMERAL } from '@/lib/db-path';
import {
  blobStoreId,
  blobTokenName,
  ensureFreshDb,
  snapshotConfigured,
  snapshotDiagnostics,
} from '@/lib/db-snapshot';
import { db, schema } from '@/lib/sqlite';

/** Per-instance, so two calls landing on two lambdas are distinguishable. */
const INSTANCE = Math.random().toString(36).slice(2, 8);
const BOOTED = Date.now();

export async function GET() {
  await connection();

  // The same refresh every page does, so this list is what a READ would see
  // rather than whatever this instance happened to boot with.
  const refreshed = await ensureFreshDb();

  let projects: { count: number; ids: string[] } | { error: string };
  try {
    const rows = db.select({ id: schema.projects.id }).from(schema.projects).all();
    projects = { count: rows.length, ids: rows.map((r) => r.id) };
  } catch (err) {
    projects = { error: (err as Error).message };
  }

  // Exercised exactly the way the snapshot layer does it: an explicit token if
  // one exists, otherwise nothing at all so the library reaches for the
  // deployment's OIDC identity. A store that cannot be listed here is a store
  // the app cannot use either, whatever the dashboard says.
  let blob: unknown = { skipped: 'no store attached' };
  if (blobStoreId) {
    const token = blobTokenName ? process.env[blobTokenName] : undefined;
    try {
      const { list } = await import('@vercel/blob');
      const res = await list({ ...(token ? { token } : {}), limit: 10 });
      blob = {
        ok: true,
        auth: token ? 'read-write token' : 'oidc',
        objects: res.blobs.map((b) => ({ pathname: b.pathname, size: b.size, at: b.uploadedAt })),
      };
    } catch (err) {
      blob = { ok: false, auth: token ? 'read-write token' : 'oidc', error: (err as Error).message };
    }
  }

  return NextResponse.json(
    {
      instance: INSTANCE,
      upMs: Date.now() - BOOTED,
      region: process.env.VERCEL_REGION ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      blobTokenName,
      blobStoreId: blobStoreId || null,
      hasOidc: Boolean(process.env.VERCEL_OIDC_TOKEN),
      storeEnvNames: Object.keys(process.env)
        .filter((n) => /BLOB|KV_|REDIS|STORE|OIDC/i.test(n))
        .sort(),
      snapshotConfigured,
      refreshed,
      snapshot: await snapshotDiagnostics(),
      dbIsEphemeral: DB_IS_EPHEMERAL,
      dbPath: DB_PATH,
      projects,
      blob,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
