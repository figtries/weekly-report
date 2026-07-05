'use client';

import dynamic from 'next/dynamic';
import type { GrandTotal, SummaryRow } from '@/lib/rollup';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';

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
  return (
    <div className="hidden print:block">
      <WeeklyPrintSummary project={project} meta={meta} roots={roots} grandTotal={grandTotal} />
    </div>
  );
}
