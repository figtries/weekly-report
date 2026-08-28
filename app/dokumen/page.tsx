import { redirect } from 'next/navigation';

import { getDb, getLatestWeek } from '@/lib/data';

/**
 * Document Control opens on the week the weekly report is on.
 *
 * The register is read per week now, exactly as every other reporting screen
 * is, so it needs a week in the address before it can show anything — and the
 * one to start from is the week the rest of the app calls current.
 */
export default async function DocumentControlIndexPage() {
  const db = await getDb();
  redirect(`/dokumen/${getLatestWeek(db) || 1}/summary`);
}
