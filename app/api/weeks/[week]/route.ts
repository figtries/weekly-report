import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { applyWeekUpdates } from '@/lib/mutations';
import type { LeafSnapshot } from '@/lib/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ week: string }> }
) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const body = (await request.json()) as { updates: Record<string, Partial<LeafSnapshot>> };

  try {
    const updated = await mutateDb((db) => applyWeekUpdates(db, week, body.updates));
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
