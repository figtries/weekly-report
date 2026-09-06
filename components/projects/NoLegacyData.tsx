import Link from 'next/link';
import { ArrowRight, FolderKanban } from 'lucide-react';

import { getOpenProject } from '@/lib/legacy-bridge';

/**
 * What Dashboard, Weekly Progress, Daily, Reports and Klaim show when the open
 * project has no v1 data — which is every project made inside the app.
 *
 * The alternative was drawing those pages from an empty dataset: a curve at
 * zero, a laggards list with nothing in it, "Week 0 of 0". That reads as broken
 * rather than as new, and it is exactly the impression the old Portfolio gave a
 * fresh project when it printed 0.00% in red.
 *
 * The other alternative was worse: leaving the pages showing Gundih under a
 * sidebar naming a different project. A report that disagrees with the site is
 * the one thing this app exists to prevent.
 *
 * So it says which project is open, what is missing, and gives two real
 * controls — because a quiet screen reads as a missing screen.
 */
export default function NoLegacyData({ what }: { what: string }) {
  const open = getOpenProject();

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="animate-enter w-full max-w-md rounded-xl border bg-card p-6 text-center">
        <span
          aria-hidden
          className="mx-auto grid size-10 place-items-center rounded-lg bg-muted"
        >
          <FolderKanban className="size-5 text-muted-foreground" />
        </span>

        <h2 className="mt-3 text-sm font-semibold">
          {open ? `“${open.name}” has no ${what} yet` : `No ${what} yet`}
        </h2>
        <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
          This project was made in the app and holds only its plan so far. {what} start once
          there is work to measure — build the schedule first, or switch back to a project that
          already has one.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {open && (
            <Link
              href={`/projects/${open.id}`}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
            >
              Build the schedule
              <ArrowRight className="size-4" />
            </Link>
          )}
          <Link
            href="/projects"
            className="inline-flex h-11 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
          >
            Open another project
          </Link>
        </div>
      </div>
    </div>
  );
}
