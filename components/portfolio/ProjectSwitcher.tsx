import { ChevronRight } from 'lucide-react';
import { PressLink, pressMotion } from '@/components/motion/Press';
import PlanActualBar from '@/components/ui/PlanActualBar';
import type { OpenProjectStatus } from '@/lib/data';
import type { ProjectCard } from '@/lib/projects';

/**
 * Which project you are looking at, how far along it is — and the way to the
 * page that manages them. It answers "whose numbers are these, and are they
 * behind?" and offers one action: go to Projects.
 *
 * It used to be a native `<select>` laid over this card. On iOS that opens
 * the system picker, which was the point — but on desktop it drops an
 * unstyleable white list over the page, with a 100-character project name
 * rendered as one unwrapped blue bar. There is no CSS for that list; a
 * `<select>` is only ever as good as the platform draws it. So switching
 * moved to Projects, where a project is a row with room for its name, its
 * customer and its numbers.
 *
 * THE FULL NAME, NOT THE INITIAL (25 Sep 2026). The card used to be one
 * truncated 150px row, so it showed the three-letter initial instead of a
 * seventy-character title cut to "RELOKASI 2 …". It now sits at the foot of
 * the sidebar with room to wrap, so the name is printed whole and the initial
 * rides above it as a tile.
 *
 * The figures are the Fill in screen's own for the current week — Actual in
 * `chart-1` blue, Plan in `chart-2` red, as on the S-Curve — and under them the
 * two bars, blue over red, on one scale. No bar at all when there is no honest
 * figure (see `getOpenProjectStatus`): an empty bar reads as zero progress.
 *
 * No `'use client'`: nothing here holds state. It renders inside the
 * sidebar, which is already a client component.
 */
const pct = (n: number) =>
  `${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;


export default function ProjectSwitcher({
  projects,
  status,
}: {
  projects: ProjectCard[];
  status: OpenProjectStatus | null;
}) {
  const active = projects.find((p) => p.isActive) ?? projects[0];
  if (!active) return null;

  const others = projects.length - 1;
  const initial = active.initial || active.name.trim().charAt(0) || '?';

  // The same three words the Deviation card on Fill in uses under its figure.
  const verdict = !status
    ? null
    : status.variance < 0
      ? `${pct(Math.abs(status.variance))} behind plan`
      : status.variance > 0
        ? `${pct(status.variance)} ahead of plan`
        : 'on plan';

  return (
    <PressLink
      href="/projects"
      {...pressMotion}
      aria-label={`${active.name}, go to Projects`}
      className="block rounded-xl border bg-card p-3 shadow-sm transition-colors duration-300 ease-ios hover:border-chart-1/40"
    >
      <span className="flex items-center gap-2">
        <span className="inline-flex h-8 items-center rounded-lg bg-chart-1/10 px-2.5 text-xs font-bold uppercase tracking-wider text-primary">
          {initial}
        </span>
        <span className="flex-1" />
        {/* When there is somewhere to switch TO, say so — otherwise the card
            is a signpost pointing at a page with one row on it. */}
        {others > 0 && (
          <span className="text-[11px] text-muted-foreground">
            +{others} {others === 1 ? 'project' : 'projects'}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </span>

      <span className="mt-2.5 block text-[13px] font-semibold leading-snug text-foreground">
        {active.name}
      </span>
      {active.clientName && (
        <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
          {active.clientName}
        </span>
      )}

      {status && !status.ready ? (
        // The weights do not close, so no screen shows a figure — this card
        // included. It says what is missing instead. See lib/weight-gate.ts.
        <>
          <span className="mt-3 block text-[13px] font-semibold tabular-nums text-warn">
            Weights {pct(status.weightsTotal)} of 100%
          </span>
          <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
            Figures wait for the weights
          </span>
        </>
      ) : status ? (
        <>
          <span className="mt-3 flex items-baseline justify-between gap-2">
            <span className="text-lg font-bold tabular-nums text-chart-1">{pct(status.actual)}</span>
            <span className="text-[11px] font-medium tabular-nums text-chart-2">Plan {pct(status.plan)}</span>
          </span>
          {/* Actual over plan as two bars, the app's one way of drawing the
              pair (components/ui/PlanActualBar.tsx). */}
          <span className="mt-1.5 flex">
            <PlanActualBar actual={status.actual} plan={status.plan} size="sm" />
          </span>
          <span className="mt-2 block text-[11px] leading-tight text-muted-foreground">
            Week {status.week} · {verdict}
          </span>
        </>
      ) : (
        <span className="mt-2 block text-[11px] leading-tight text-muted-foreground">
          {active.rowCount > 0 ? 'No progress to show yet' : 'Not planned yet'}
        </span>
      )}
    </PressLink>
  );
}
