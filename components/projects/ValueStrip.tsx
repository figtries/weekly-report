import type { WeightSummary } from '@/lib/weights';
import { formatMoney } from '@/lib/currency';
import CurrencyPicker from './CurrencyPicker';

/**
 * The contract figure, and the currency it is in.
 *
 * It used to carry four more things: a bar for how far the pricing had got, a
 * sentence explaining it, and a **Money** panel holding the unit
 * reconciliation, the contract figure's provenance and the button that derives
 * weights from prices. All four read PER-ROW PRICES, and as of 12 Sep 2026 the
 * planner has no way to type one: pricing moved to Data Overall, because
 * weighting a plan and scheduling it are two jobs and only one of them is what
 * this screen is for.
 *
 * The bar could not simply stay behind. With no price to type it would read 0%
 * on every new project, permanently, with nothing on screen able to move it,
 * and a number that cannot be acted on reads as broken rather than as empty.
 *
 * What is left is the one question this line was always answering first: how
 * much is this contract worth. The figure is authoritative, typed when the
 * project was created, not derived from prices — deriving it forced signed and
 * allocated to be equal and deleted the gap between them.
 *
 * `lib/weights-actions.ts` and the summary this component still reads are
 * untouched, and are what Data Overall will pick up.
 *
 * No `'use client'`: with the panel gone there is no state here, and the only
 * interactive thing on the line is `CurrencyPicker`, which is its own client
 * component. One less component in the bundle the field crew waits for.
 */
export default function ValueStrip({
  summary,
  projectId,
}: {
  summary: WeightSummary;
  projectId: string;
}) {
  const signed = summary.contractValue > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2 sm:px-6">
      <span className="flex items-center gap-2">
        <strong className="text-base font-semibold tabular-nums sm:text-lg">
          {signed ? formatMoney(summary.contractValue, summary.currency) : 'No contract value yet'}
        </strong>
        <CurrencyPicker projectId={projectId} currency={summary.currency} />
      </span>
    </div>
  );
}
