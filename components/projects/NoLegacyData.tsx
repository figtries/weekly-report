import { FolderKanban } from 'lucide-react';

import EmptyState from '@/components/ui/EmptyState';
import { getOpenProject } from '@/lib/legacy-bridge';

/**
 * What Weekly Progress, Daily, Reports and Klaim show when the open project has
 * no v1 data — which is every project made inside the app.
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
 * controls — because a quiet screen reads as a missing screen. The card itself
 * is `EmptyState`, shared with the dashboard so the app has ONE way of saying
 * there is nothing here yet.
 */
export default function NoLegacyData({ what }: { what: string }) {
  const open = getOpenProject();

  return (
    <EmptyState
      icon={FolderKanban}
      title={open ? `“${open.name}” has no ${what} yet` : `No ${what} yet`}
      body={`This project was made in the app and holds only its plan so far. ${what} start once there is work to measure — build the schedule first, or switch back to a project that already has one.`}
      primary={
        open ? { href: `/projects/${open.id}`, label: 'Build the schedule' } : undefined
      }
      secondary={{ href: '/projects', label: 'Open another project' }}
    />
  );
}
