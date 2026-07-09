import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { applyCreateDaily } from '@/lib/mutations';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { date: string };

  try {
    const created = await mutateDb((db) => applyCreateDaily(db, body.date));
    return NextResponse.json(created);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
