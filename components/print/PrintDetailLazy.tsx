'use client';

import dynamic from 'next/dynamic';
import type { RollupNode } from '@/lib/rollup';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { useDeferredPrint } from './useDeferredPrint';

const WeeklyPrintDetail = dynamic(() => import('./WeeklyPrintDetail'), { ssr: false });

export default function PrintDetailLazy({
  project,
  meta,
  roots,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
  roots: RollupNode[];
}) {
  const shouldRender = useDeferredPrint(350);

  if (!shouldRender) return null;

  return (
    <div className="hidden print:block">
      <WeeklyPrintDetail project={project} meta={meta} roots={roots} />
    </div>
  );
}
