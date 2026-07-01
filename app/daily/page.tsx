import Link from 'next/link';
import { getDb } from '@/lib/data';
import NewDailyButton from '@/components/daily/NewDailyButton';

function nextDateAfter(lastDate: string | undefined): string {
  if (!lastDate) return new Date().toISOString().slice(0, 10);
  const d = new Date(`${lastDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default async function DailyListPage() {
  const db = await getDb();
  const sorted = [...db.daily].sort((a, b) => b.date.localeCompare(a.date));
  const defaultDate = nextDateAfter(sorted[0]?.date);

  return (
    <div className="p-8 animate-fade-in-up">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 mb-2">Daily Reports</h1>
          <p className="text-gray-600">Field man-hours, PTW, HSE and daily progress</p>
        </div>
        <NewDailyButton defaultDate={defaultDate} />
      </div>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
        {sorted.length === 0 && <p className="p-6 text-sm text-gray-500">No daily reports yet — create one above.</p>}
        {sorted.map((d, idx) => (
          <Link
            key={d.date}
            href={`/daily/${d.date}`}
            className="flex items-center justify-between px-6 py-4 transition-colors hover:bg-gray-50 animate-fade-in-up"
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <div>
              <p className="font-medium text-gray-900">
                {new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: '2-digit',
                  month: 'long',
                  year: 'numeric',
                  timeZone: 'UTC',
                })}
              </p>
              <p className="text-sm text-gray-500">Hari ke-{d.hariKe ?? '-'}</p>
            </div>
            <p className="text-sm text-gray-500">
              Plan {d.planPct.toFixed(0)}% · Actual {d.actualPct.toFixed(0)}%
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
