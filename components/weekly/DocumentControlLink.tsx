import Link from 'next/link';
import { ArrowRight, Files } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { EngineeringBridge } from '@/lib/register-shared';

/**
 * The weekly report's half of the seam to Document Control.
 *
 * The engineering percentage on this report and the EDL describe the same
 * work, and until now neither screen mentioned the other — so the report could
 * carry 100% for a discipline the register had at 75% and nobody would meet the
 * gap until a meeting. The band states both figures and links across; the EDL
 * summary carries the mirror image of it pointing back here.
 *
 * Shown only where the two disagree enough to matter or where the register is
 * already the source. A band that says "these agree" on every page for sixty
 * weeks is furniture, and furniture stops being read.
 */
export default function DocumentControlLink({
  bridge,
  week,
}: {
  bridge: EngineeringBridge;
  week: number;
}) {
  const gap = bridge.registerPercent - bridge.typedPercent;
  const disagrees = Math.abs(gap) >= 0.05;
  if (!disagrees && bridge.linked === 0) return null;

  return (
    <Card className="py-0 mb-5 shadow-sm sm:mb-8">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:p-6">
        <div className="flex min-w-0 gap-3">
          <Files className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              Engineering here is also tracked document by document
            </p>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              This report carries{' '}
              <span className="font-medium text-foreground tabular-nums">
                {bridge.typedPercent.toFixed(1)}%
              </span>{' '}
              for its {bridge.disciplines} engineering disciplines. The document register counts{' '}
              <span className="font-medium text-foreground tabular-nums">
                {bridge.registerPercent.toFixed(1)}%
              </span>{' '}
              from the dates on {bridge.documents} documents
              {disagrees && (
                <>
                  {' '}with a gap of{' '}
                  <span className={cn(
                    'font-medium tabular-nums',
                    gap < 0 ? 'text-amber-700' : 'text-emerald-700',
                  )}>
                    {gap >= 0 ? '+' : '−'}{Math.abs(gap).toFixed(1)} points
                  </span>
                </>
              )}
              .
              {bridge.linked > 0 && (
                <> {bridge.linked} of {bridge.disciplines} already read their figure from there.</>
              )}
            </p>
          </div>
        </div>

        {/* 44px minimum: this is tapped standing up, on site. */}
        <Link
          href={`/dokumen/${week}/summary`}
          className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-lg border px-4 text-sm font-medium transition-colors duration-300 ease-ios hover:bg-accent sm:self-auto"
        >
          Open Document Control
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
  );
}
