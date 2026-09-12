import { notFound } from 'next/navigation';
import { getOpenDb, getWeekMeta } from '@/lib/data';
import PhotoUploadGrid from '@/components/weekly/PhotoUploadGrid';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = {
  prefetch: 'runtime',
  // The open project is a cookie now (see lib/projects.ts); this validation
  // refuses any read it has not been told about. A null value samples the
  // visitor who has never chosen a project.
  samples: [{ params: { week: '1' }, cookies: [{ name: 'figtries_open_project', value: null }] }],
};

/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function DocumentationPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <LegacyGate what="weekly reports" planned>
      <DocumentationPageBody params={params} />
    </LegacyGate>
  );
}

async function DocumentationPageBody({ params }: { params: Promise<{ week: string }> }) {

  const { week: weekParam } = await params;
  const week = Number(weekParam);
  const db = await getOpenDb();
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
