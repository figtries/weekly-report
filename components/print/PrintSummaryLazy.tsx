'use client';

import dynamic from 'next/dynamic';
import type { GrandTotal, SummaryRow } from '@/lib/rollup';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { useDeferredPrint } from './useDeferredPrint';
import PrintSheet from './PrintSheet';

const WeeklyPrintSummary = dynamic(() => import('./WeeklyPrintSummary'), { ssr: false });

export default function PrintSummaryLazy({
  project,
  meta,
  roots,
  grandTotal,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
  roots: SummaryRow[];
  grandTotal: GrandTotal;
}) {
  const shouldRender = useDeferredPrint();

  if (!shouldRender) return null;

  return (
    <PrintSheet>
      <WeeklyPrintSummary project={project} meta={meta} roots={roots} grandTotal={grandTotal} />
    </PrintSheet>
  );
}
