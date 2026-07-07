'use client';

import dynamic from 'next/dynamic';
import type { SCurveRow } from '@/lib/scurve';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { useDeferredPrint } from './useDeferredPrint';

const WeeklyPrintSCurve = dynamic(() => import('./WeeklyPrintSCurve'), { ssr: false });

export default function PrintSCurveLazy({
  project,
  meta,
  series,
}: {
  project: ProjectInfo;
  meta: WeeklyMeta;
  series: SCurveRow[];
}) {
  const shouldRender = useDeferredPrint(550);

  if (!shouldRender) return null;

  // Recharts skips drawing inside display:none, so keep the sheet laid out but
  // invisible off-screen until printing.
  return (
    <div className="invisible fixed inset-x-0 top-0 -z-50 overflow-hidden print:visible print:static print:z-auto print:overflow-visible">
      <WeeklyPrintSCurve project={project} meta={meta} series={series} />
    </div>
  );
}
