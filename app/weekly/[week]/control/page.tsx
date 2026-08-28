import { notFound } from 'next/navigation';
import { buildLookAhead, computeHealth, findLaggards, validateWeek } from '@/lib/analysis';
import { getCachedWeekRollup, getDb } from '@/lib/data';
import ControlPanel from '@/components/weekly/ControlPanel';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function ControlPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);

  const db = await getDb();
  const rollup = await getCachedWeekRollup(week);
  const health = computeHealth(db, week);
  if (!rollup || !health) notFound();

  const laggards = findLaggards(rollup.roots, health.contractValue);
  const validation = validateWeek(db, week);
  const lookAhead = buildLookAhead(db, health);
  const approval = db.approvals?.find((a) => a.week === week) ?? null;

  return (
    <div className="animate-fade-in-up px-3 py-4 sm:p-6 lg:p-8 print:hidden">
      <header className="mb-5 sm:mb-7">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight sm:mb-2 sm:text-3xl">
          Control Panel
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          <span className="font-medium text-foreground">Week {week}</span> · Every figure below is
          computed from data already entered — nothing extra to fill in.
        </p>
      </header>

      <ControlPanel
        health={health}
        laggards={laggards}
        validation={validation}
        lookAhead={lookAhead}
        approval={approval}
      />
    </div>
  );
}
