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
  const shouldRender = useDeferredPrint();

  if (!shouldRender) return null;

  // Recharts skips drawing inside display:none, so the sheet has to stay laid
  // out while hidden on screen. We hide it with opacity — NOT visibility:hidden
  // — on purpose: Android Chrome's print rasterizer never paints a
  // visibility:hidden subtree, so flipping it visible via @media print printed a
  // blank chart on Android (iOS/desktop were fine). An opacity:0 layer still
  // gets painted, so Android has something to rasterize when print restores it.
  return (
    <div data-print-sheet className="pointer-events-none fixed inset-x-0 top-0 -z-50 opacity-0 overflow-hidden print:pointer-events-auto print:static print:z-auto print:opacity-100 print:overflow-visible">
      <WeeklyPrintSCurve project={project} meta={meta} series={series} />
    </div>
  );
}
