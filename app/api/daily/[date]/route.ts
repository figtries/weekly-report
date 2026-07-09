import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { applyPatchDaily } from '@/lib/mutations';
import type { DailyReport } from '@/lib/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const patch = (await request.json()) as Partial<Omit<DailyReport, 'date'>>;

  try {
    const updated = await mutateDb((db) => applyPatchDaily(db, date, patch));
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
