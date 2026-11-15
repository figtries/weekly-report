/**
 * What the deployed instance actually has.
 *
 * GET /api/health/db
 */
import { connection } from 'next/server';
import { NextResponse } from 'next/server';

import { db } from '@/lib/pg';
import * as schema from '@/lib/schema';

/** Per-instance, so two calls landing on two lambdas are distinguishable. */
const INSTANCE = Math.random().toString(36).slice(2, 8);
const BOOTED = Date.now();

export async function GET() {
  await connection();

  let projects:
    | {
        count: number;
        ids: string[];
        rows: { id: string; basis: string; leaves: number; unweighted: number }[];
      }
    | { error: string };
  try {
    const rows = await db
      .select({ id: schema.projects.id, basis: schema.projects.weightBasis })
      .from(schema.projects);
    const nodes = await db
      .select({
        projectId: schema.wbsNodes.projectId,
        isLeaf: schema.wbsNodes.isLeaf,
        bobot: schema.wbsNodes.bobot,
      })
      .from(schema.wbsNodes);
    projects = {
      count: rows.length,
      ids: rows.map((r) => r.id),
      rows: rows.map((r) => {
        const mine = nodes.filter((n) => n.projectId === r.id && n.isLeaf);
        return {
          id: r.id,
          basis: r.basis,
          leaves: mine.length,
          unweighted: mine.filter((n) => !n.bobot).length,
        };
      }),
    };
  } catch (err) {
    projects = { error: (err as Error).message };
  }

  return NextResponse.json(
    {
      instance: INSTANCE,
      upMs: Date.now() - BOOTED,
      region: process.env.VERCEL_REGION ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      dbBackend: 'supabase-postgres',
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL
        ? process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0]
        : null,
      projects,
    },
    { headers: { 'cache-control': 'no-store' } }
  );
}
