'use client';

import PrintHeader from './PrintHeader';
import PrintFooter from './PrintFooter';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { weekPeriodLabel } from '@/lib/weeks';

const PAGE_SIZE = 6;

export default function WeeklyPrintDocumentation({
  project,
  meta,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
}) {
  const pages: (string | null)[][] = [];
  for (let i = 0; i < meta.documentation.length; i += PAGE_SIZE) {
    pages.push(meta.documentation.slice(i, i + PAGE_SIZE));
  }
  // Always print the first page; skip extra pages that have no photos
  const printPages = pages.filter((page, i) => i === 0 || page.some((p) => p !== null));

  return (
    <>
      {printPages.map((pagePhotos, pageIndex) => (
        <div key={pageIndex} className="print-sheet-a4">
          <PrintHeader
            title="Photograph"
            subtitle={project.name}
            period={weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
          />
          {/* capped width, not the full content box: 4:3 photos across the full
              width make this the tallest sheet in the app, and a sheet must stay
              well under the smallest printable area (see .print-sheet-a4) or it
              splits onto a second page */}
          <div
            className="mx-auto grid grid-cols-2"
            style={{ maxWidth: '152mm', columnGap: '7mm', rowGap: '4mm' }}
          >
            {pagePhotos.map((photo, i) => {
              const no = pageIndex * PAGE_SIZE + i + 1;
              return (
                <figure key={i}>
                  <div className="rpt-photo">
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={photo} alt={`Documentation ${no}`} />
                    ) : (
                      <div className="rpt-photo-empty">No photo</div>
                    )}
                  </div>
                  <figcaption className="rpt-caption">Photo {no}</figcaption>
                </figure>
              );
            })}
          </div>
          <PrintFooter docNo={project.documentNoWeekly} page={pageIndex + 1} total={printPages.length} />
        </div>
      ))}
    </>
  );
}
