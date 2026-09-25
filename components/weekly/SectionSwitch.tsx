import Link from 'next/link';
import { ArrowLeft, ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The one door between Data Overall and Weekly Progress, beside the page title.
 *
 * Report used to be a tab in the week bar, beside Fill in, Check and Weights,
 * which made the report read as a fourth thing to do to the week rather than
 * the place the week goes when it is done (25 Sep 2026). The bar now holds only
 * the section you are in, and crossing to the other section is this button:
 * "Report" on the three Data Overall screens, "Data Overall" on the four
 * report sheets, in the same seat on both so the way back is where the way
 * there was.
 */
export default function SectionSwitch({ week, to }: { week: number; to: 'report' | 'data' }) {
  const report = to === 'report';
  return (
    <Button
      asChild
      variant="outline"
      className="h-11 shrink-0 gap-1.5 rounded-lg border-chart-1/40 bg-card px-3.5 text-sm font-semibold text-chart-1 shadow-sm hover:bg-chart-1/10 hover:text-chart-1"
    >
      <Link href={`/weekly/${week}/${report ? 'summary' : 'overall'}`}>
        {report ? (
          <>
            <FileText className="size-4" aria-hidden />
            Report
            <ArrowRight className="size-4" aria-hidden />
          </>
        ) : (
          <>
            <ArrowLeft className="size-4" aria-hidden />
            Data Overall
          </>
        )}
      </Link>
    </Button>
  );
}
