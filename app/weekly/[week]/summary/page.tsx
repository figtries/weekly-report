import { notFound } from 'next/navigation';
import { getCachedWeekRollup } from '@/lib/data';
import { getSummaryRows } from '@/lib/rollup';
import SummaryCards from '@/components/weekly/SummaryCards';
import PageHeader from '@/components/layout/PageHeader';
import { RouteTransition } from '@/components/motion/RouteTransition';
import LegacyGate from '@/components/projects/LegacyGate';

export const unstable_instant = { prefetch: 'runtime', samples: [{ params: { week: '1' } }] };

/**
 * Step ③ — the Overall Summary sheet, and nothing else.
 *
 * This page briefly carried the reading layer as well: six stat cards (SPI,
 * earned value, deferred, forecast), the contract-value field and the
 * generated paragraph, all above the summary itself. A tab called "Overall
 * Summary" that opens with two screens of something else is not the sheet it
 * names, and the four report tabs are meant to be siblings — one sheet each —
 * rather than one fat page and three thin ones.
 *
 * Nothing was deleted, only unmounted. `WeekAnalysis`, `ContractValueField`
 * and `DocumentControlLink` are still in `components/weekly/`, and every figure
 * they showed is still computed by `computeHealth` / `findLaggards` /
 * `buildLookAhead` — the Dashboard reads all three. Putting any of them back is
 * re-adding the component here and nothing else.
 *
 * AND THE CONTRACT VALUE IS NOT COMING BACK HERE. `ContractValueField` was the
 * only place in the running app that could type `project.contractValue`, and
 * unmounting it is deliberate: that figure belongs to setting a project up, not
 * to one week's report. It arrives with the priced BOQ that already derives
 * every weight (`lib/setup.ts`), so board items 16 (Project management) and 17
 * (Planner) own the door. Until they exist the setup wizard is the only way in,
 * and step ②'s warning ("Contract value is not filled in") stands — it says the
 * figure is missing, which is true, and never promised to fix it from here.
 */
/**
 * The gate is asked PER REQUEST, and the answer is never prerendered — a
 * project's name baked into this page's static HTML was served from the CDN to
 * whoever opened a different one. See components/projects/LegacyGate.tsx.
 */
export default function SummaryPage({ params }: { params: Promise<{ week: string }> }) {
  return (
    <LegacyGate what="weekly reports">
      <SummaryPageBody params={params} />
    </LegacyGate>
  );
}

async function SummaryPageBody({ params }: { params: Promise<{ week: string }> }) {
  const { week: weekParam } = await params;
  const week = Number(weekParam);

  const result = await getCachedWeekRollup(week);
  if (!result) notFound();
  const { roots, grandTotal } = result;
  const summaryRows = getSummaryRows(roots);

  return (
    // The root carries no animation of its own any more. On a tab change the
    // RouteTransition fades this whole block, and on a cold load the sections
    // inside arrive one after another — a root that also moved would compound
    // with both, and a card would travel 32px instead of 16.
    <RouteTransition id="weekly-summary">
      <div className="px-3 py-4 sm:p-6 lg:p-8 print:hidden">
        <PageHeader section="Weekly Progress" title="Overall Summary" className="animate-enter">
          <span className="font-medium text-foreground">Week {week}</span> · Progress per SPK
          contract.
        </PageHeader>

        {/* SummaryCards staggers its own hero and contract grid from here. */}
        <SummaryCards roots={summaryRows} grandTotal={grandTotal} />
      </div>
    </RouteTransition>
  );
}
