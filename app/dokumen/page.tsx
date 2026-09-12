import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { getLatestWeek, getOpenDb } from '@/lib/data';

/**
 * Document Control opens on the week the weekly report is on.
 *
 * The register is read per week and per project now, exactly as every other
 * reporting screen is, so it needs a week in the address before it can show
 * anything — and the one to start from is the week the rest of the app calls
 * current FOR THIS PROJECT. Reading db.json's week here sent every other
 * project to a week number belonging to the one project that file holds.
 *
 * Behind `<Suspense>` for the same reason as app/weekly/page.tsx: the open
 * project is a cookie, and an uncached read outside a boundary fails the build.
 */
export default function DocumentControlIndexPage() {
  return (
    <Suspense fallback={null}>
      <GoToCurrentWeek />
    </Suspense>
  );
}

async function GoToCurrentWeek(): Promise<never> {
  await connection();
  const db = await getOpenDb();
  redirect(`/dokumen/${getLatestWeek(db) || 1}/summary`);
}
