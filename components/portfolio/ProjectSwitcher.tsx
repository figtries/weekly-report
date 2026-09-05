import { ChevronRight } from 'lucide-react';
import { PressLink, pressMotion } from '@/components/motion/Press';
import type { ProjectCard } from '@/lib/projects';

/**
 * Which project you are looking at — and the way to the page that manages
 * them. It answers one question all day ("whose numbers are these?") and
 * offers one action: go to Projects.
 *
 * It used to be a native `<select>` laid over this card. On iOS that opens
 * the system picker, which was the point — but on desktop it drops an
 * unstyleable white list over the page, with a 100-character project name
 * rendered as one unwrapped blue bar. There is no CSS for that list; a
 * `<select>` is only ever as good as the platform draws it. So switching
 * moved to Projects, where a project is a row with room for its name, its
 * customer and its numbers — which is a better place to choose from than a
 * 191px strip anyway.
 *
 * No `'use client'`: nothing here holds state. It renders inside the
 * sidebar, which is already a client component.
 */
export default function ProjectSwitcher({ projects }: { projects: ProjectCard[] }) {
  const active = projects.find((p) => p.isActive) ?? projects[0];
  if (!active) return null;

  const others = projects.length - 1;
  // No week number here any more. The list now comes from SQLite, where "which
  // week is it" is a question about today's date — and this renders in the root
  // layout, which prerenders into the static shell, so a clock read here would
  // be frozen at build time and drift further from the truth every day.
  const subtitle =
    active.clientName || (active.rowCount > 0 ? `${active.rowCount} rows` : 'Not planned yet');

  return (
    <PressLink
      href="/projects"
      {...pressMotion}
      aria-label={`${active.name} — go to Projects`}
      className="flex min-h-14 items-center gap-2.5 rounded-xl border bg-background px-2.5 py-2 shadow-sm transition-colors duration-300 ease-ios hover:border-chart-1/40 hover:bg-muted/40"
    >
      <span
        aria-hidden
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-chart-1/10 text-sm font-semibold uppercase text-chart-1"
      >
        {active.name.trim().charAt(0) || '?'}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-foreground">
          {active.name}
        </span>
        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
          {/* When there is somewhere to switch TO, say so — otherwise the card
              is a signpost pointing at a page with one row on it. */}
          {others > 0 ? `${subtitle} · +${others} more` : subtitle}
        </span>
      </span>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </PressLink>
  );
}
