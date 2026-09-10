'use client';

import { useState, useTransition } from 'react';
import { Expand } from '@/components/motion/Expand';
import { TriangleAlert } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Reveal } from '@/components/motion/Reveal';
import { setDisciplineLink } from '@/lib/doc-actions';
import { STAGE_FULL, STAGE_LABEL, type DisciplineLink } from '@/lib/register-shared';
import { cn } from '@/lib/utils';

/**
 * Where the engineering percentage in the weekly report comes from.
 *
 * Gundih measures engineering twice: once in the WBS as five disciplines with
 * an IFR, an IFA and an AFC leaf whose percentages someone types in each week,
 * and again in the EDL as 143 documents with dates. Switching a discipline over
 * points its three leaves at the register — `progressMethod: 'linked'` — and
 * from then on nobody types an engineering percentage anywhere.
 *
 * This used to sit in the middle of the EDL summary, labelled "reading
 * register", which read as a report and explained nothing. It is a setting: it
 * decides where a number comes from, it is set once, and it belongs here.
 *
 * It is off by default and that is not timidity. The register is `R2, 15 Jan
 * 2026`; the weekly report is thirty weeks past that. Switching it on today
 * would drag fifteen leaves back to what January knew, and the Difference
 * column is the honest size of that drop. Nothing is overwritten either way —
 * the stored weekly figures stay where they are — so it can be switched back
 * and lose nothing.
 */
export function EngineeringSource({
  projectId,
  disciplines,
  registerDate,
}: {
  projectId: string;
  disciplines: DisciplineLink[];
  /** The register's own last movement — the date the right-hand column is from. */
  registerDate: string;
}) {
  if (disciplines.length === 0) return null;

  const on = disciplines.filter((d) => d.stages.every((s) => s.linked)).length;

  return (
    <Card className="py-0 shadow-sm">
      <CardContent className="flex flex-col gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Where engineering progress comes from</h2>
            <Badge variant="secondary" className="font-normal">
              {on} of {disciplines.length} counted from the EDL
            </Badge>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Engineering is measured twice on this project: someone types a percentage into the
            weekly report, and the document register counts one from the dates. Switch a discipline
            over and its figure is taken from the register instead, and nobody types it again.
          </p>
          <p className="max-w-3xl text-sm text-muted-foreground">
            The register last moved{' '}
            <span className="font-medium text-foreground">
              {new Date(`${registerDate}T00:00:00Z`).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
              })}
            </span>
            , so switching one on today moves that discipline to what the register knew then.
            Nothing already reported is overwritten, and switching back loses nothing.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {disciplines.map((d, i) => (
            <Reveal key={d.nodeId} delay={0.04 + i * 0.03}>
              <DisciplineRow projectId={projectId} discipline={d} />
            </Reveal>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DisciplineRow({ projectId, discipline }: { projectId: string; discipline: DisciplineLink }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(discipline.stages.every((s) => s.linked));
  const [error, setError] = useState<string | null>(null);

  const drop = discipline.stages.reduce((a, s) => a + (s.registerPercent - s.wbsPercent), 0)
    / Math.max(1, discipline.stages.length);

  const toggle = (next: boolean) => {
    if (!discipline.categoryId) return;
    setOn(next);
    setError(null);
    start(async () => {
      const result = await setDisciplineLink({
        projectId,
        nodeId: discipline.nodeId,
        categoryId: discipline.categoryId!,
        on: next,
      });
      if (!result.ok) { setOn(!next); setError(result.error); }
    });
  };

  return (
    // `--scroll-hint-bg` tells the table's scroll shadow below what ground it
    // is sitting on; painted in the wrong colour, its cover layer shows as a
    // smudge instead of hiding the shadow. Note this card is TRANSPARENT when
    // off, so the ground is the page's `--background`, not `--card`.
    //
    // When on, the tint and the cover read the SAME custom property rather than
    // two expressions that nearly agree — `bg-blue-50/40` composited over the
    // page and a `color-mix` of the same two colours came out 4/255 apart,
    // enough to see as a faint stripe. One value used twice cannot drift.
    <div className={cn(
      'rounded-xl border p-4 transition-colors duration-300 ease-ios [--scroll-hint-bg:var(--background)]',
      on &&
        'border-blue-600/40 bg-[var(--tint)] [--scroll-hint-bg:var(--tint)] [--tint:color-mix(in_srgb,var(--color-blue-50)_40%,var(--background))]',
    )}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{discipline.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {discipline.categoryName ?? 'no matching group in the register'} ·{' '}
            {discipline.bobot.toFixed(3)}% of project weight
          </p>
        </div>
        {/* 44px of height around an 18px control: this is tapped on a phone. */}
        <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-2.5">
          <span className="text-xs font-medium">
            {on ? 'Counted from the EDL' : 'Typed in the report'}
          </span>
          <Switch
            checked={on}
            disabled={pending || !discipline.categoryId}
            onCheckedChange={toggle}
            aria-label={`Take ${discipline.name} progress from the document register`}
          />
        </label>
      </div>

      {/* Column headers are the whole point of this table. Without them the
          three numbers on each row are just three numbers. */}
      <div className="scroll-x-hint mt-4 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-xs">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="pb-2 font-medium">Stage</th>
              <th className="pb-2 text-right font-medium">
                Typed in the report
                {discipline.wbsWeek !== null && (
                  <span className="ml-1 font-normal">week {discipline.wbsWeek}</span>
                )}
              </th>
              <th className="pb-2 text-right font-medium">Counted from the EDL</th>
              <th className="pb-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {discipline.stages.map((s) => {
              const delta = s.registerPercent - s.wbsPercent;
              return (
                <tr key={s.nodeId} className="border-t">
                  <td className="py-2 pr-3">
                    <span className="font-medium">{STAGE_FULL[s.stage]}</span>
                    <span className="ml-1.5 font-mono text-muted-foreground">
                      {STAGE_LABEL[s.stage]}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">
                    {s.wbsPercent.toFixed(1)}%
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {s.registerPercent.toFixed(1)}%
                  </td>
                  <td className={cn(
                    'py-2 text-right font-medium tabular-nums',
                    Math.abs(delta) < 0.05 ? 'text-muted-foreground'
                      : delta < 0 ? 'text-rose-600' : 'text-emerald-600',
                  )}>
                    {delta >= 0 ? '+' : '−'}{Math.abs(delta).toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* This was the Expand pattern written out longhand; it is the primitive
          now. The `reduced ? false : …` guard went with it — MotionConfig's
          `reducedMotion="user"` in MotionRoot covers the whole app centrally. */}
      <Expand open={!!(error || (on && drop < -0.05))}>
        <Badge
          className={cn(
            'mt-3 w-full justify-start whitespace-normal text-left font-normal',
            error ? 'bg-rose-600 text-white' : 'bg-amber-600 text-white',
          )}
        >
          <TriangleAlert className="mr-1.5 h-3.5 w-3.5 shrink-0" />
          {error ?? `Reported engineering progress in this discipline falls by an average of ${Math.abs(drop).toFixed(1)} points while this is on.`}
        </Badge>
      </Expand>
    </div>
  );
}
