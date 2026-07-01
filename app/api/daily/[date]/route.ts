import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import type { DailyReport } from '@/lib/types';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params;
  const patch = (await request.json()) as Partial<Omit<DailyReport, 'date'>>;

  try {
    const updated = await mutateDb((db) => {
      const report = db.daily.find((d) => d.date === date);
      if (!report) throw new Error(`Daily report for ${date} not found`);
      Object.assign(report, patch);
      return report;
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
