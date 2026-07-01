import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';

export async function PATCH(request: NextRequest) {
  const body = (await request.json()) as { week: number; planPct?: number; actualPct?: number };

  try {
    const updated = await mutateDb((db) => {
      if (body.planPct !== undefined) {
        const existing = db.scurvePlan.find((p) => p.week === body.week);
        if (existing) existing.valuePct = body.planPct;
        else db.scurvePlan.push({ week: body.week, valuePct: body.planPct });
        db.scurvePlan.sort((a, b) => a.week - b.week);
      }
      if (body.actualPct !== undefined) {
        const existing = db.scurveActual.find((p) => p.week === body.week);
        if (existing) existing.valuePct = body.actualPct;
        else db.scurveActual.push({ week: body.week, valuePct: body.actualPct });
        db.scurveActual.sort((a, b) => a.week - b.week);
      }
      return { scurvePlan: db.scurvePlan, scurveActual: db.scurveActual };
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
