import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import { getObstacles, getRegisterSummary, getRegisterTree, getWeekMovement } from '@/lib/register';

export const metadata = { title: 'VDRL Summary' };

const PROJECT_ID = 'gundih';

/**
 * The vendor register, read the same way and telling a different story.
 *
 * No vendor gave a submission date, so there is no plan curve to draw and none
 * is invented; most of what was ordered has never been sent, and that is what
 * the screen leads with. 76 packages would be a wall of empty cards, so they
 * are folded by status — only the ones that have actually moved get a card.
 */
export default async function VdrlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const summary = getRegisterSummary(PROJECT_ID, 'vdrl', week);
  if (!summary) return <EmptyRegister script="node scripts/import-vdrl.ts" name="Vendor Deliverable Register List" />;

  return (
    <SummaryScreen
      summary={summary}
      // Vendor packages are the top level here — one card per package.
      groups={getRegisterTree(PROJECT_ID, 'vdrl', week)}
      obstacles={getObstacles(PROJECT_ID, 'vdrl', week)}
      movement={getWeekMovement(PROJECT_ID, 'vdrl', week)}
      groupNoun="packages"
      groupsTitle="By vendor package"
      foldEmptyGroups
    />
  );
}
