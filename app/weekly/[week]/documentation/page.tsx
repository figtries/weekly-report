import { notFound } from 'next/navigation';
import { getDb, getWeekMeta } from '@/lib/data';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function DocumentationPage({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getDb();
  const meta = getWeekMeta(db, week);
  if (!meta) notFound();

  return (
    <RouteTransition id="weekly-documentation">
      <div className="px-3 py-4 sm:p-6 lg:p-8 print:hidden">
        <PageHeader section="Weekly Progress" title="Documentation" className="animate-enter">
          {/* Explicit {' '}: JSX dropped the space before the middot here and
              the line read "Week 36· The photographs". */}
          <span className="font-medium text-foreground">Week {week}</span>{' '}
          · The photographs that go into this week&apos;s report.
        </PageHeader>
        {/* One step behind the header, exactly as Detail Progress does it. The
            grid pages its own slots, so nothing inside needs a per-slot delay. */}
        <div className="animate-enter stagger-1">
          <PhotoUploadGrid photos={meta.documentation} uploadUrl={`/api/weeks/${week}/photos`} />
        </div>
      </div>
    </RouteTransition>
  );
}
