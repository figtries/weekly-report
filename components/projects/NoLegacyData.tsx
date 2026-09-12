import { FolderKanban } from 'lucide-react';

import EmptyState from '@/components/ui/EmptyState';
import { getOpenProject } from '@/lib/legacy-bridge';

/**
 * What Daily and Klaim show when the open project has no v1 data — which is
 * every project made inside the app.
 *
 * WEEKLY PROGRESS AND REPORTS NO LONGER REACH HERE. They read whichever project
 * is open, out of SQLite (`getOpenDb` in lib/data.ts), so the copy below had to
 * stop saying that a project holding "only its plan" cannot be reported on: it
 * can, and telling somebody to go and build a schedule they have already built
 * is the kind of dead end this card exists to end. What is left is genuinely
 * missing — the daily report has no home in SQLite yet, and the claim register
 * is assembled out of daily photos and delay causes.
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
export default async function NoLegacyData({ what }: { what: string }) {
  const open = await getOpenProject();

  return (
    <EmptyState
      icon={FolderKanban}
      title={open ? `“${open.name}” has no ${what} yet` : `No ${what} yet`}
      body={`Weekly progress, the schedule and the document register all work for this project — ${what} are the part that does not have a home here yet, and they are being rebuilt. Its weekly report is filled in and issued as normal in the meantime.`}
      primary={open ? { href: '/weekly', label: 'Go to Weekly Progress' } : undefined}
      secondary={{ href: '/projects', label: 'Open another project' }}
    />
  );
}
