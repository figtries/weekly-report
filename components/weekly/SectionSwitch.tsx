import Link from 'next/link';
import { ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The door from Data Overall to Weekly Progress, beside the page title on Fill
 * in, Check and Weights.
 *
 * Report used to be a tab in the week bar, beside Fill in, Check and Weights,
 * which made the report read as a fourth thing to do to the week rather than
 * the place the week goes when it is done (25 Sep 2026). The bar now holds only
 * the section you are in, and crossing to the report is this button.
 *
 * It was a pair until 1 Oct 2026: the four report sheets carried
 * "← Data Overall" in the same seat. That was a back arrow at the far right of
 * the page, under Save as PDF, pointing away from where it sat, and on a phone
 * it read backwards. It was removed rather than moved; the sidebar's Data
 * Overall entry is the way back.
 */
export default function SectionSwitch({ week }: { week: number }) {
  return (
    <Button
      asChild
      variant="outline"
      className="h-11 shrink-0 gap-1.5 rounded-lg border-chart-1/40 bg-card px-3.5 text-sm font-semibold text-chart-1 shadow-sm hover:bg-chart-1/10 hover:text-chart-1"
    >
      <Link href={`/weekly/${week}/summary`}>
        <FileText className="size-4" aria-hidden />
        Report
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </Button>
  );
}
