import { redirect } from 'next/navigation';
import { getDb, getLatestWeek } from '@/lib/data';

export default async function WeeklyIndexPage() {
  const db = await getDb();
  const week = getLatestWeek(db) || 1;
  redirect(`/weekly/${week}/overall`);
}
