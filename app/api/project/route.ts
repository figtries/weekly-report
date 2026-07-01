import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as { currentWeek?: number };
  try {
    const updated = await mutateDb((db) => {
      if (body.currentWeek !== undefined) {
        db.project.currentWeek = body.currentWeek;
      }
      return { currentWeek: db.project.currentWeek };
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
