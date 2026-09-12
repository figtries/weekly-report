import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { getLatestWeek, getOpenDb } from '@/lib/data';

/**
 * Weekly Progress opens on the open project's latest week — not db.json's.
 *
 * This used to read `getDb()`, which holds exactly one project, so opening any
 * other project and tapping Weekly Progress landed on ITS week number: a
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
      <GoToLatestWeek />
    </Suspense>
  );
}

async function GoToLatestWeek(): Promise<never> {
  await connection();
  const db = await getOpenDb();
  redirect(`/weekly/${getLatestWeek(db) || 1}/overall`);
}
