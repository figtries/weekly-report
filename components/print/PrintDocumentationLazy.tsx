'use client';

import dynamic from 'next/dynamic';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';

const WeeklyPrintDocumentation = dynamic(() => import('./WeeklyPrintDocumentation'), { ssr: false });

export default function PrintDocumentationLazy({
  project,
  meta,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
}) {
  return (
    <div className="hidden print:block">
      <WeeklyPrintDocumentation project={project} meta={meta} />
    </div>
  );
}
