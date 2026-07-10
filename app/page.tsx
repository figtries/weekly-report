import { redirect } from 'next/navigation';
import { getDb, getLatestWeek } from '@/lib/data';

export default async function Home() {
  // Jump straight to the landing tab in one hop — going through /weekly first
  // added a second redirect round-trip to every first open of the app.
  const db = await getDb();
  const week = getLatestWeek(db) || 1;
  redirect(`/weekly/${week}/overall`);
}
