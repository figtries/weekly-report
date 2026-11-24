import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { getOpenDb } from '@/lib/data';
import { snapshotPending } from '@/lib/db-snapshot';
import { currentWeekOf } from '@/lib/current-week';

/**
 * Data Overall opens on the week the open project is IN, not db.json's.
 *
 * This used to read `getDb()`, which holds exactly one project, so opening any
 * other project and tapping Data Overall landed on ITS week number: a
 * two-week project sent to week 36, where its own week picker cannot follow.
 *
 * The redirect has to happen behind `<Suspense>` because the open project is a
 * cookie and an uncached read outside a boundary fails the build — the trap
 * AGENTS.md warns about twice. A null fallback is right here: there is nothing
 * to show, only somewhere to go.
 */
export default function WeeklyIndexPage() {
  return (
    <Suspense fallback={null}>
      <GoToCurrentWeek />
    </Suspense>
  );
}

async function GoToCurrentWeek() {
  await connection();
  // Redirecting on a database this instance has not read yet lands on week 1
  // of a project that is not the user's — the empty page with a keyboard-mash
  // name. Wait instead, and say so.
  if (snapshotPending()) return <ReadingTheDatabase />;
  const db = await getOpenDb();
  redirect(`/weekly/${currentWeekOf(db)}/overall`);
}

/**
 * Held space and one line, with a plain reload behind it.
 *
 * The reload is a `<meta>` rather than a script on purpose: this renders
 * before any of the app has hydrated, and the instance serving the next
 * request may be one that has already read the store.
 */
function ReadingTheDatabase() {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <meta httpEquiv="refresh" content="3" />
      <div className="h-11 animate-pulse rounded-xl border bg-muted/40" />
      <div className="mt-3 h-40 animate-pulse rounded-xl border bg-muted/40" />
      <p className="mt-4 text-center text-sm text-muted-foreground">Reading the database…</p>
    </div>
  );
}
