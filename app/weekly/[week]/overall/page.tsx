import { notFound } from 'next/navigation';
import { getOpenWeekRollup, getOpenDb } from '@/lib/data';
import { weekPeriodShort } from '@/lib/weeks';
import { buildWorklist } from '@/lib/worklist';
import DataOverallWorkbench from '@/components/weekly/DataOverallWorkbench';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import PageHeader from '@/components/layout/PageHeader';
import { Reveal } from '@/components/motion/Reveal';
import { RouteTransition } from '@/components/motion/RouteTransition';
import { Card, CardContent } from '@/components/ui/card';
import { MOTION, TYPE } from '@/lib/design';
import { cn } from '@/lib/utils';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts); this validation
  // refuses any read it has not been told about. A null value samples the
  // visitor who has never chosen a project.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
  unstable_disableValidation: true,
};

/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function DataOverallPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <LegacyGate what="weekly reports" planned>
      <DataOverallPageBody params={params} />
    </LegacyGate>
  );
}

async function DataOverallPageBody({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const [db, result] = await Promise.all([getOpenDb(), getOpenWeekRollup(week)]);
  if (!result) notFound();
  const { roots, grandTotal } = result;
  const period = weekPeriodShort(db.project.weekAnchorEndDate, week);

  // Only surface changes for this week — history strip + panel timeline stay
  // scoped to what the user is currently editing.
  const recentChanges = (db.changeLog ?? []).filter((c) => c.week === week);

  // What this week actually asks of whoever is filling it in. Built here rather
  // than in the client so the queue is part of the prerendered page — the first
  // thing on screen should be the work, not a spinner deciding what the work is.
  const worklist = buildWorklist({ roots, schedule: db.schedule, week, changeLog: db.changeLog });

  // Four figures on one calm ground, not four tinted cards — the backgrounds
  // stay white; only the numerals carry colour.
  //
  // A fixed colour per figure, so the four are told apart at a glance rather
  // than read one by one. Plan and Actual take the chart tokens they are named
  // after — `--chart-2` IS "plan, red" and `--chart-1` IS "actual, blue" — so
  // this row and the S-Curve teach the same two colours instead of two
  // different ones.
  //
  // Deviation is YELLOW ALWAYS (`--deviation`), which means it no longer turns
  // green when the project is ahead. The verdict has not been dropped, it has
  // moved into the word underneath: colour here identifies which figure you are
  // looking at, and the line below says how to feel about it.
  const stats = [
    { label: 'Plan', value: grandTotal.targetWF, tone: 'text-chart-2', sub: undefined as string | undefined },
    { label: 'Actual', value: grandTotal.curProgressPct, tone: 'text-chart-1', sub: undefined },
    { label: 'Added this week', value: grandTotal.thisWeekProgressPct, tone: 'text-ok', sub: undefined },
    {
      label: 'Deviation',
      value: grandTotal.variance,
      tone: 'text-deviation',
      // One word, not a sentence: the figure above already says how much, and
      // the sign is the one thing about it a newcomer reads wrong.
      sub: grandTotal.variance < 0 ? 'behind plan' : grandTotal.variance > 0 ? 'ahead of plan' : 'on plan',
    },
  ];

  return (
    <RouteTransition id="weekly-overall">
    {/* One order on every width: the four figures, then the work. They were
       briefly flipped on phones to get the first queue card above the fold, but
       cutting the header down to its dates bought back most of that height, and
       a summary you have to scroll DOWN to stops being a summary. */}
    <div className="flex flex-col gap-4 px-3 py-4 sm:p-6 lg:p-8">
      <PageHeader section="Weekly Progress" title="Update progress" className="mb-0 animate-enter">
        {/* The dates and nothing else. The sentence that used to follow them
            explained how the screen works, which is a thing you read once and
            then scroll past every week — while the dates are what someone
            actually checks before typing a number into the wrong week. Bold,
            because at this size the muted body colour made the one piece of
            information here look like a caption. */}
        <span className="font-semibold text-foreground">
          Week {week} · {period}
        </span>
      </PageHeader>

      <Reveal delay={MOTION.stagger}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <Card key={s.label} size="sm" className="h-full gap-2">
              <CardContent>
                <p className={TYPE.statLabel}>{s.label}</p>
                <p
                  className={cn(
                    'mt-1.5 text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl',
                    s.tone
                  )}
                >
                  <AnimatedNumber value={s.value} suffix="%" />
                </p>
                {s.sub && <p className="mt-0.5 text-xs text-muted-foreground">{s.sub}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </Reveal>

      {/* The stored evidence behind each leaf — quantities counted and
          milestones ticked. The workbench needs it because entry now happens on
          the item itself rather than on a separate Field Input screen. */}
      <Reveal delay={MOTION.stagger * 2}>
        <DataOverallWorkbench
          roots={roots}
          week={week}
          recentChanges={recentChanges}
          snapshots={result.meta.leafData}
          worklist={worklist}
        />
      </Reveal>
    </div>
    </RouteTransition>
  );
}
