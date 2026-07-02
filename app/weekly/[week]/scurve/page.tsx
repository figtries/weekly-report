import { notFound } from 'next/navigation';
import { getDb } from '@/lib/data';
import { buildSCurveSeries } from '@/lib/scurve';
import SCurveClient from '@/components/weekly/SCurveClient';

export default async function SCurvePage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  if (!db.weeks.some((w) => w.week === week)) notFound();

  const series = buildSCurveSeries(db, week);
  const current = series.find((r) => r.week === week);
  // Future weeks have no actual point on the curve — fall back to the latest
  // reported actual so the stat card matches the Data Overall page.
  const lastActual = [...series].reverse().find((r) => r.actualPct !== null)?.actualPct ?? null;

  return (
    <div className="h-full p-6">
      <SCurveClient
        series={series}
        currentWeek={week}
        planPct={current?.planPct ?? null}
        actualPct={current?.actualPct ?? lastActual}
        project={db.project}
      />
    </div>
  );
}
