import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import type { LeafSnapshot } from '@/lib/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const body = (await request.json()) as { updates: Record<string, Partial<LeafSnapshot>> };

  try {
    const updated = await mutateDb((db) => {
      const meta = db.weeks.find((w) => w.week === week);
      if (!meta) throw new Error(`Week ${week} not found`);
      for (const [id, patch] of Object.entries(body.updates)) {
        const existing = meta.leafData[id] ?? { cumProgressPct: 0, targetWF: 0 };
        meta.leafData[id] = { ...existing, ...patch };
      }
      return meta;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
