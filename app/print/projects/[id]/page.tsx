import { Suspense } from 'react';
import GanttPrint from '@/components/print/GanttPrint';
import { getProject } from '@/lib/projects';
import { ensureFreshDb, refreshDbSnapshot } from '@/lib/sqlite';
import { getSheet } from '@/lib/sheet';
import { getBarView } from '@/lib/bar-view-read';
import { getBarFacts } from '@/lib/bar-facts';
import { analyseNetwork } from '@/lib/chains';
import { packagesOf, scopeRows } from '@/lib/gantt-print';

// The page headless Chromium renders into the Gantt PDF (see lib/pdf.ts and
// app/api/pdf/projects/[id]/route.ts). Under /print, outside the app's own
// segments, for the reasons app/print/weekly/[week]/page.tsx gives.
//
// `scope` is 'all' or the id of the row whose branch is printed; `levels` is
// how many levels below it are shown, 0 for all of them.
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string; levels?: string }>;
};

// searchParams is a runtime read: behind Suspense, with a null fallback that
// lib/pdf.ts never snapshots (it waits for a visible .print-sheet-a4).
export default function ProjectPrintTarget(props: Props) {
  return (
    <Suspense fallback={null}>
      <ProjectPrintBody {...props} />
    </Suspense>
  );
}

async function ProjectPrintBody({ params, searchParams }: Props) {
  const [{ id }, { scope = 'all', levels = '0' }] = await Promise.all([params, searchParams]);
  // After the request reads: both of these look at the clock.
  await ensureFreshDb();
  let project = getProject(id);
  if (!project && (await refreshDbSnapshot())) project = getProject(id);

  if (!project) {
    // Never an empty page: lib/pdf.ts waits for a sheet and would hang without one.
    return (
      <div className="print-sheet-a4 print-sheet-landscape">
        <p className="gantt-sub">This project was not found.</p>
      </div>
    );
  }

  const sheet = getSheet(id);
  const depth = Math.max(0, Math.min(20, Math.trunc(Number(levels)) || 0));
  const rows = scopeRows(sheet.rows, scope, depth);
  const { week, facts } = getBarFacts(id);
  const where =
    scope === 'all'
      ? 'Whole plan'
      : (packagesOf(sheet.rows).find((p) => p.id === scope)?.label ?? sheet.rows.find((r) => r.id === scope)?.name ?? 'Part of the plan');
  const subtitle = [
    'Schedule',
    where,
    depth === 0 ? 'All levels' : depth === 1 ? 'Top level only' : `${depth} levels`,
    week != null ? `Progress as of Week ${week}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // The day line, in the site's own time zone: the server runs on UTC, which
  // is the day before for the first seven hours of every Indonesian morning.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

  return (
    <div className="bg-gray-100 min-h-full overflow-x-auto print:overflow-visible">
      {/* Every sheet on this page is landscape, so the page turns its own paper.
          Later than globals.css's portrait @page, so it wins; and here rather
          than in globals.css, where Turbopack dropped a named page (see there). */}
      <style>{'@media print { @page { size: A4 landscape; margin: 0; } }'}</style>
      <div className="flex w-max min-w-full flex-col items-center gap-6 px-4 py-6 print:block print:w-auto print:min-w-0 print:gap-0 print:p-0">
        <GanttPrint
          project={project}
          subtitle={subtitle}
          rows={rows}
          allRows={sheet.rows}
          facts={facts}
          view={getBarView(id)}
          network={analyseNetwork(sheet.rows)}
          today={today}
          contract={sheet.contract !== null}
        />
      </div>
    </div>
  );
}
