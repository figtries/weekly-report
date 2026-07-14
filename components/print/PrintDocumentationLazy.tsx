'use client';

import dynamic from 'next/dynamic';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { useDeferredPrint } from './useDeferredPrint';
import PrintSheet from './PrintSheet';

const WeeklyPrintDocumentation = dynamic(() => import('./WeeklyPrintDocumentation'), { ssr: false });

export default function PrintDocumentationLazy({
  project,
  meta,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
}) {
  const { mounted, close } = useDeferredPrint();

  if (!mounted) return null;

  return (
    <PrintSheet onClose={close}>
      <WeeklyPrintDocumentation project={project} meta={meta} />
    </PrintSheet>
  );
}
