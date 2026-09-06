import { notFound } from 'next/navigation';
import { getDb, getWeekMeta } from '@/lib/data';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';
import NoLegacyData from '@/components/projects/NoLegacyData';
import { getOpenProject } from '@/lib/legacy-bridge';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

export default async function DocumentationPage({ params }: { params: Promise<{ week: string }> }) {
  // The v1 pages read db.json while projects are chosen in SQLite, so the open
  // project may have nothing here. The check sits on the page rather than the
  // layout because a layout that skips its children fails unstable_instant
  // validation at build time. See lib/legacy-bridge.ts.
  const openProject = getOpenProject();
  if (openProject && !openProject.hasLegacyData) return <NoLegacyData what="weekly reports" />;

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
