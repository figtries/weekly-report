import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { weekPeriodShort } from '@/lib/weeks';
import WbsTreeTable from '@/components/weekly/WbsTreeTable';
import AnimatedNumber from '@/components/ui/AnimatedNumber';

export default async function DataOverallPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const result = getWeekRollup(db, week);
  if (!result) notFound();
  const { roots, grandTotal } = result;
  const isCurrent = week === db.project.currentWeek;
  const period = weekPeriodShort(db.project.weekAnchorEndDate, week);

  const stats = [
    { label: 'Plan / Target', value: grandTotal.targetWF, tone: 'text-red-600', bg: 'bg-red-50' },
    { label: 'Actual', value: grandTotal.curProgressPct, tone: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'This Week', value: grandTotal.thisWeekProgressPct, tone: 'text-purple-600', bg: 'bg-purple-50' },
    {
      label: 'Deviation',
      value: grandTotal.variance,
      tone: grandTotal.variance < 0 ? 'text-red-600' : 'text-emerald-600',
      bg: grandTotal.variance < 0 ? 'bg-red-50' : 'bg-emerald-50',
    },
  ];

  return (
    <div className="p-8 animate-fade-in-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 text-3xl font-semibold text-gray-900">Data Overall</h1>
          <p className="text-gray-600">
            The single source of truth for <span className="font-medium text-gray-900">Week {week}</span> · {period}.
            Edit the activities below — Overall Summary, Detail Progress and the S-Curve update automatically.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            isCurrent ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {isCurrent ? 'Current reporting week' : 'Past / future week'}
        </span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className={`rounded-xl border border-gray-200 ${s.bg} p-5 shadow-sm transition-shadow hover:shadow-md`}>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">{s.label}</p>
            <p className={`text-3xl font-semibold ${s.tone}`}>
              <AnimatedNumber value={s.value} suffix="%" />
            </p>
          </div>
        ))}
      </div>

      <WbsTreeTable
        roots={roots}
        week={week}
        compact
        title="Progress Breakdown"
        subtitle="Type the cumulative Actual % and Plan % for each activity (blue boxes). Weighted factors, targets, variance and the S-Curve all recompute when you save."
      />
    </div>
  );
}
