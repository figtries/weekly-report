import { NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { toISODate, weekEndDate, weekStartDate } from '@/lib/weeks';

export async function POST() {
  try {
    const created = await mutateDb((db) => {
      const latest = db.weeks.reduce((a, b) => (b.week > a.week ? b : a), db.weeks[0]);
      const nextWeekNo = latest.week + 1;
      if (db.weeks.some((w) => w.week === nextWeekNo)) {
        throw new Error(`Week ${nextWeekNo} already exists`);
      }
      const start = weekStartDate(db.project.weekAnchorEndDate, nextWeekNo);
      const end = weekEndDate(db.project.weekAnchorEndDate, nextWeekNo);
      const leafData: typeof latest.leafData = {};
      db.wbsItems.forEach((item) => {
        const prev = latest.leafData[item.id];
        if (prev) leafData[item.id] = { cumProgressPct: prev.cumProgressPct, targetWF: prev.targetWF };
      });
      const meta = {
        week: nextWeekNo,
        periodStart: toISODate(start),
        periodEnd: toISODate(end),
        documentation: [null, null, null, null, null, null] as (string | null)[],
        leafData,
      };
      db.weeks.push(meta);
      return meta;
    });
    return NextResponse.json(created);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
