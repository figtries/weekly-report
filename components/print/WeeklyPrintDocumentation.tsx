'use client';

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
        <div key={pageIndex} className="print-sheet-a4 text-black" style={{ padding: '15mm' }}>
          <div className="mb-4 flex items-start justify-between">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pertamina.png"
              alt="Pertamina EP"
              style={{ width: '160px', height: '48px', objectFit: 'contain', objectPosition: 'left' }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/indoturbine.png"
              alt="Indoturbine"
              style={{ width: '140px', height: '48px', objectFit: 'contain', objectPosition: 'right' }}
            />
          </div>
          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold">Photograph</h1>
            <p className="mt-1 text-sm text-gray-600">
              Week {meta.week} — {weekPeriodLabel(project.weekAnchorEndDate, meta.week)}
              {printPages.length > 1 ? ` (${pageIndex + 1}/${printPages.length})` : ''}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {pagePhotos.map((photo, i) => (
              <div key={i} className="border border-black" style={{ aspectRatio: '4 / 3', overflow: 'hidden' }}>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photo}
                    alt={`Documentation ${pageIndex * PAGE_SIZE + i + 1}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-gray-300">No photo</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
