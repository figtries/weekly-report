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

  return (
    <div className="h-full p-6">
      <SCurveClient
        series={series}
        currentWeek={week}
        planPct={current?.planPct ?? null}
        actualPct={current?.actualPct ?? null}
        project={db.project}
      />
    </div>
  );
}
