import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { getLatestWeek, getOpenDb } from '@/lib/data';

/**
 * Weekly Progress opens on the OPEN project's latest week.
 *
 * The sibling `app/weekly/page.tsx` does the same for Data Overall, and this
 * one exists because the sidebar needs a second landing tab and cannot carry a
 * week itself: the menu is rendered by the root layout, where the open project
 * (a cookie) cannot be read without blocking every route in the app. It used to
 * be handed db.json's week instead, which belongs to exactly one project, so
 * Weekly Progress pointed at week 36 of whatever you had open — a 404 on any
 * project shorter than that (17 Sep 2026).
 *
 * A static segment beats the `[week]` sibling in Next's matcher, so `/weekly/
 * summary` lands here and never reaches `[week]` as the string "summary".
 *
 * Behind `<Suspense>` for the reason AGENTS.md gives twice: an uncached read
 * outside a boundary fails the build. A null fallback is right — there is
 * nothing to show, only somewhere to go.
 */
export default function WeeklySummaryIndexPage() {
  return (
    <Suspense fallback={null}>
      <GoToLatestSummary />
    </Suspense>
  );
}

async function GoToLatestSummary(): Promise<never> {
  await connection();
  const db = await getOpenDb();
  redirect(`/weekly/${getLatestWeek(db) || 1}/summary`);
}
