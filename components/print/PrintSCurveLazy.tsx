'use client';

import dynamic from 'next/dynamic';
import type { SCurveRow } from '@/lib/scurve';
import type { ProjectInfo, WeeklyMeta } from '@/lib/types';
import { useDeferredPrint } from './useDeferredPrint';
import PrintSheet from './PrintSheet';

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
  const shouldRender = useDeferredPrint();

  if (!shouldRender) return null;

  return (
    <PrintSheet>
      <WeeklyPrintSCurve project={project} meta={meta} series={series} />
    </PrintSheet>
  );
}
