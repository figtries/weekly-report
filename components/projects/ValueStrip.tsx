import Link from 'next/link';

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
 * The summary this component still reads is untouched, and is what Data
 * Overall picked up.
 *
 * No `'use client'`: with the panel gone there is no state here, and the only
 * interactive thing on the line is `CurrencyPicker`, which is its own client
 * component. One less component in the bundle the field crew waits for.
 */
export default function ValueStrip({
  summary,
  projectId,
  week = null,
}: {
  summary: WeightSummary;
  projectId: string;
  /** The open project's current week, for the press to Weights. Null when not open. */
  week?: number | null;
}) {
  const signed = summary.contractValue > 0;
  // THE CONTRACT AND THE WORK PACKAGES, SIDE BY SIDE (8 Oct 2026). This line
  // showed the contract alone while Weights measured everything against the
  // packages, so the two screens quoted different figures for one project with
  // nothing saying so. Same comparison as Weights, same press to fix it.
  const budget = summary.projectBudget;
  const diff = signed && budget > 0 ? budget - summary.contractValue : 0;
  const say = (v: number) => formatMoney(v, summary.currency);

  return (
    // Second in the page's cascade, after the header and before the sheet. The
    // route crossfade only fades the page's opacity; what the eye actually
    // follows on a route change is the sections arriving in order, and this
    // line was sitting still while the one above it moved.
    <div className="animate-enter stagger-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b px-3 py-2 sm:px-6">
      <span className="flex items-center gap-2">
        <strong className="text-base font-semibold tabular-nums sm:text-lg">
          {signed ? formatMoney(summary.contractValue, summary.currency) : 'No contract value yet'}
        </strong>
        <CurrencyPicker projectId={projectId} currency={summary.currency} />
      </span>
      {signed && budget > 0 && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <span className="text-muted-foreground">
            Work packages <strong className="tabular-nums text-foreground">{say(budget)}</strong>
            {' · '}
            {Math.abs(diff) <= 0.5 ? (
              <span className="font-semibold text-ok">Matches the contract</span>
            ) : diff > 0 ? (
              <span className="font-semibold text-destructive">{say(diff)} past the contract</span>
            ) : (
              <span className="font-semibold text-warn">{say(-diff)} of the contract in no work package</span>
            )}
          </span>
          {diff > 0.5 && (
            <a
              href="#edit=contractValue"
              className="inline-flex min-h-11 items-center rounded-lg bg-background px-3.5 text-sm font-semibold text-primary ring-1 ring-primary/30 sm:min-h-9"
            >
              Raise the contract value
            </a>
          )}
          {diff < -0.5 && week != null && (
            <Link
              href={`/weekly/${week}/weights`}
              className="inline-flex min-h-11 items-center rounded-lg bg-background px-3.5 text-sm font-semibold text-primary ring-1 ring-primary/30 sm:min-h-9"
            >
              Open Weights
            </Link>
          )}
        </span>
      )}
    </div>
  );
}
