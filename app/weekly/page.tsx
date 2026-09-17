import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { getOpenDb } from '@/lib/data';
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

async function GoToCurrentWeek(): Promise<never> {
  await connection();
  const db = await getOpenDb();
  redirect(`/weekly/${currentWeekOf(db)}/overall`);
}
