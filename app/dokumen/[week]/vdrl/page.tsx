import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import { getObstacles, getRegisterSummary, getRegisterTree } from '@/lib/register';

export const metadata = { title: 'VDRL Summary' };

const PROJECT_ID = 'gundih';

/**
 * The vendor half-dashboard.
 *
 * Same arithmetic, a different story. The vendor register carries no promised
 * dates at all, so there is no plan curve to draw and none is invented; what it
 * does say is that most of what was ordered has never been sent, and that is
 * what the screen leads with.
 */
export default async function VdrlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const summary = getRegisterSummary(PROJECT_ID, 'vdrl', week);
  if (!summary) return <EmptyRegister script="node scripts/import-vdrl.ts" name="Vendor Deliverable Register List" />;

  return (
    <SummaryScreen
      summary={summary}
      // Vendor packages are the top level here — one card per vendor.
      groups={getRegisterTree(PROJECT_ID, 'vdrl', week)}
      obstacles={getObstacles(PROJECT_ID, 'vdrl', week)}
      groupsTitle="By vendor package"
    />
  );
}
