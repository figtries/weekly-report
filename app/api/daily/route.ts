import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/db';
import { defaultHse, defaultNonEffective, defaultWeather } from '@/lib/defaults';
import type { DailyReport, HseRow, ManHourRow, NonEffectiveRow } from '@/lib/types';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { date: string };

  try {
    const created = await mutateDb((db) => {
      if (db.daily.some((d) => d.date === body.date)) {
        throw new Error(`Daily report for ${body.date} already exists`);
      }
      const sorted = [...db.daily].sort((a, b) => a.date.localeCompare(b.date));
      const last = sorted[sorted.length - 1] as DailyReport | undefined;

      const carryCounters = <T extends { previous: number; today: number }>(rows: T[]): T[] =>
        rows.map((r) => ({ ...r, previous: r.previous + r.today, today: 0 }));

      const manHours: ManHourRow[] = (last?.manHours ?? []).map((r) => ({
        ...r,
        previousHours: r.previousHours + r.todayHours,
        todayHours: 0,
      }));
      const nonEffective: NonEffectiveRow[] = last
        ? carryCounters(last.nonEffective)
        : defaultNonEffective();
      const hseInput: HseRow[] = last ? carryCounters(last.hseInput) : defaultHse();

      const report: DailyReport = {
        date: body.date,
        hariKe: last ? (last.hariKe ?? 0) + 1 : 1,
        weather: defaultWeather(),
        manHours,
        nonEffective,
        ptw: [],
        hseInput,
        activitiesToday: '',
        activitiesTomorrow: '',
        planPct: 0,
        actualPct: 0,
        photos: [null, null, null, null, null, null],
      };
      db.daily.push(report);
      return report;
    });
    return NextResponse.json(created);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
