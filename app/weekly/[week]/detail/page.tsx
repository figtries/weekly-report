import { notFound } from 'next/navigation';
import { getDb, getWeekRollup } from '@/lib/data';
import { flattenTree } from '@/lib/rollup';
import WbsTreeTable from '@/components/weekly/WbsTreeTable';

export default async function DetailProgressPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const result = getWeekRollup(db, week);
  if (!result) notFound();
  const { roots } = result;
  const leafCount = flattenTree(roots).filter((n) => n.children.length === 0).length;

  return (
    <div className="p-8 animate-fade-in-up">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Detail Progress</h1>
        <p className="text-gray-600">
          Full WBS breakdown — Week {week} · {leafCount} activity items · edit in{' '}
          <span className="font-medium text-blue-600">Data Overall</span>
        </p>
      </div>
      <WbsTreeTable
        roots={roots}
        week={week}
        readOnly
        title="Detail Progress (WBS)"
        subtitle="Read-only view — this is the printable detailed breakdown. Use 'Show milestones' to include zero-weight marker rows."
      />
    </div>
  );
}
