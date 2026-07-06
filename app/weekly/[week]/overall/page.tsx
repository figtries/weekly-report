import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { weekPeriodShort } from '@/lib/weeks';
import DataOverallWorkbench from '@/components/weekly/DataOverallWorkbench';
import AnimatedNumber from '@/components/ui/AnimatedNumber';

export const unstable_instant = {
  prefetch: 'runtime',
  samples: [{ params: { week: '1' } }],
  unstable_disableValidation: true,
};

export default async function DataOverallPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const result = getWeekRollup(db, week);
  if (!result) notFound();
  const { roots, grandTotal } = result;
  const period = weekPeriodShort(db.project.weekAnchorEndDate, week);

  // Only surface changes for this week — history strip + panel timeline stay
  // scoped to what the user is currently editing.
  const recentChanges = (db.changeLog ?? []).filter((c) => c.week === week);

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
    <div className="px-3 py-3 sm:p-6 lg:p-8 animate-fade-in-up space-y-4 sm:space-y-6">
      <div>
        <h1 className="mb-0.5 text-xl sm:text-3xl font-semibold text-gray-900">Data Overall</h1>
        <p className="text-xs sm:text-base text-gray-600 leading-relaxed">
          The single source of truth for <span className="font-medium text-gray-900">Week {week}</span> · {period}.{' '}
          <span className="hidden sm:inline">Click an activity to edit — Summary, Detail Progress, and S-Curve auto-update after saving.</span>
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        {stats.map((s, idx) => (
          <div
            key={s.label}
            className={`rounded-xl border border-gray-200 ${s.bg} px-3 py-3 sm:p-5 shadow-sm transition-all duration-500 ease-ios hover:shadow-md hover:-translate-y-0.5 animate-fade-in-up`}
            style={{ animationDelay: `${idx * 70}ms` }}
          >
            <p className="mb-1 text-[11px] sm:text-xs font-medium uppercase tracking-wide text-gray-500">{s.label}</p>
            <p className={`text-2xl sm:text-3xl font-semibold ${s.tone}`}>
              <AnimatedNumber value={s.value} suffix="%" />
            </p>
          </div>
        ))}
      </div>

      <DataOverallWorkbench roots={roots} week={week} recentChanges={recentChanges} />
    </div>
  );
}
