'use client';

import dynamic from 'next/dynamic';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { useDeferredPrint } from './useDeferredPrint';

const WeeklyPrintDocumentation = dynamic(() => import('./WeeklyPrintDocumentation'), { ssr: false });

export default function PrintDocumentationLazy({
  project,
  meta,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
}) {
  const shouldRender = useDeferredPrint();

  if (!shouldRender) return null;

  return (
    <div data-print-sheet className="hidden print:block">
      <WeeklyPrintDocumentation project={project} meta={meta} />
    </div>
  );
}
