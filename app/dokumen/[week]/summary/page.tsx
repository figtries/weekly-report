import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import {
  getEngineeringBridge, getObstacles, getRegisterSummary, getRegisterTree, getWeekMovement,
} from '@/lib/register';

export const metadata = { title: 'EDL Summary' };

const PROJECT_ID = 'gundih';

/**
 * The EDL, read as of the week in the address.
 *
 * Everything on it is counted, nothing is carried over: the total, what moved
 * that week, the plan it is measured against and each discipline's deviation
 * all come out of the dates in the register. The client's own summary keeps the
 * same figures as pasted literals, which is why its "this week" column reads
 * 0.70% while the real difference is 15.99%.
 *
 * The switch that points the WBS's engineering leaves at this register used to
 * sit on this page. It is a setting, not a report, and it now lives in Project
 * Settings — the seam band on the screen links to it.
 */
export default async function EdlSummaryPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const summary = getRegisterSummary(PROJECT_ID, 'edl', week);
  if (!summary) return <EmptyRegister script="node scripts/import-edl.ts" name="Engineering Deliverable List" />;

  const tree = getRegisterTree(PROJECT_ID, 'edl', week);
  // A and B are the sheet's own two bands; what a controller works in is the
  // level below — General, Procedure, Process, Mechanical, Electrical, Instrument.
  const groups = tree.flatMap((root) => (root.children.length > 0 ? root.children : [root]));

  return (
    <SummaryScreen
      summary={summary}
      groups={groups}
      obstacles={getObstacles(PROJECT_ID, 'edl', week)}
      movement={getWeekMovement(PROJECT_ID, 'edl', week)}
      bridge={getEngineeringBridge(PROJECT_ID, week)}
      groupNoun="disciplines"
      groupsTitle="Discipline by discipline"
      groupsBlurb="The same total, split the way the engineering team is. The marker on each bar is where the promised dates said that discipline would be by now."
    />
  );
}
