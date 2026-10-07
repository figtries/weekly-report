'use client';

import { m } from 'framer-motion';

import { CONSTRUCTION_DISCIPLINES } from '@/lib/disciplines';
import { pressMotion } from '@/components/motion/Press';
import DisciplineIcon from './DisciplineIcon';
import { cn } from '@/lib/utils';

/**
 * "Which part of construction?", asked in Data Overall (8 Oct 2026). The plan
 * asks only the kind of work: asked there, every row went to Other because the
 * planner does not know yet, and a guess would write an answer nobody gave.
 * Nothing is pre-chosen on a row that has no answer.
 */
export default function DisciplineTiles({
  chosen,
  onPick,
}: {
  chosen: string | null;
  onPick: (disciplineId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-input bg-card p-3">
      <p className="text-[13px] text-foreground">Which part of construction?</p>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {CONSTRUCTION_DISCIPLINES.map((d) => (
          <m.button
            key={d.id}
            {...pressMotion}
            type="button"
            onClick={() => onPick(d.id)}
            aria-pressed={d.id === chosen}
            className={cn(
              'flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-1 text-[12.5px] font-medium transition-colors duration-200 ease-ios',
              d.id === chosen
                ? 'border-chart-1/40 bg-chart-1/10 text-chart-1'
                : 'border-input bg-card text-foreground hover:bg-muted/50'
            )}
          >
            <DisciplineIcon
              id={d.id}
              className={cn('h-5 w-5', d.id === chosen ? 'text-chart-1' : 'text-muted-foreground')}
            />
            {d.short}
          </m.button>
        ))}
      </div>
    </div>
  );
}
