import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import GanttPrint from '@/components/print/GanttPrint';
import { getProject } from '@/lib/projects';
import { getSheet } from '@/lib/sheet';
import { getBarView } from '@/lib/bar-view-read';
import { getBarFacts } from '@/lib/bar-facts';
import { analyseNetwork } from '@/lib/chains';
import { scopeRows } from '@/lib/gantt-print';
import { verifyPdfToken } from '@/lib/pdf-token';

// The page headless Chromium renders into the Gantt PDF (see lib/pdf.ts and
// app/api/pdf/projects/[id]/route.ts). Under /print, outside the app's own
// segments, for the reasons app/print/weekly/[week]/page.tsx gives.
//
// `scope` is 'all' or the id of the row whose branch is printed; `levels` is
// how many levels below it are shown, 0 for all of them. `client` and
// `contractor` are '1' when ticked in the dialog; otherwise they stay off the page.
type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string; levels?: string; client?: string; contractor?: string; token?: string }>;
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
  const [{ id }, { scope = 'all', levels = '0', client, contractor, token }] = await Promise.all([params, searchParams]);
  if (!token || !verifyPdfToken(token)) notFound();
  const project = await getProject(id);

  if (!project) {
    // Never an empty page: lib/pdf.ts waits for a sheet and would hang without one.
    return (
      <div className="print-sheet-a4 print-sheet-landscape">
        <p className="gantt-sub">This project was not found.</p>
      </div>
    );
  }

  const [sheet, barView, barFactsResult] = await Promise.all([getSheet(id), getBarView(id), getBarFacts(id)]);
  const depth = Math.max(0, Math.min(20, Math.trunc(Number(levels)) || 0));
  const rows = scopeRows(sheet.rows, scope, depth);
  const { facts } = barFactsResult;
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
          project={{
            name: project.name,
            clientName: client === '1' ? project.clientName : null,
            contractorName: contractor === '1' ? project.contractorName : null,
          }}
          rows={rows}
          allRows={sheet.rows}
          facts={facts}
          view={barView}
          network={analyseNetwork(sheet.rows)}
          today={today}
          contract={sheet.contract !== null}
        />
      </div>
    </div>
  );
}
