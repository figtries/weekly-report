import WeightGateNotice from '@/components/dashboard/WeightGateNotice';
import { getOpenDb } from '@/lib/data';
import { weightGate } from '@/lib/weight-gate';

/**
 * What a report page renders instead of its figures while the open project's
 * weights do not close, or null when they do. Summary, Detail and S-Curve ask
 * this first, so the rule lives in one place (lib/weight-gate.ts) and every
 * report says it the same way the dashboard does.
 *
 * Must be awaited behind the page's own `<Suspense>` (LegacyGate provides it):
 * the open project is a cookie.
 */
export async function weightGateView(week: number) {
  const db = await getOpenDb();
  const gate = weightGate(db.wbsItems);
  if (gate.ok) return null;
  return (
    <div className="px-3 py-4 sm:p-6 lg:p-8">
      <WeightGateNotice gate={gate} week={week} />
    </div>
  );
}
