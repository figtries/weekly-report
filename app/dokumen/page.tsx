import { DisciplineLinks } from '@/components/dokumen/DisciplineLinks';
import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { SummaryScreen } from '@/components/dokumen/SummaryScreen';
import { getDisciplineLinks, getObstacles, getRegisterSummary, getRegisterTree } from '@/lib/register';

export const metadata = { title: 'Ringkasan EDL' };

const PROJECT_ID = 'gundih';

/**
 * The EDL half-dashboard.
 *
 * Everything on it is counted, nothing is carried over: the total, the rise
 * this week, the plan it is measured against and each discipline's deviation
 * all come out of the dates in the register. The client's own summary keeps the
 * same figures as pasted literals, which is why its "MINGGU INI" column reads
 * 0,70% while the real difference is 15,99%.
 */
export default function EdlSummaryPage() {
  const summary = getRegisterSummary(PROJECT_ID, 'edl');
  if (!summary) return <EmptyRegister script="node scripts/import-edl.ts" name="Engineering Deliverable List" />;

  const tree = getRegisterTree(PROJECT_ID, 'edl');
  // A and B are the sheet's own two bands; what a controller works in is the
  // level below — General, Procedure, Process, Mechanical, Electrical, Instrument.
  const groups = tree.flatMap((root) => (root.children.length > 0 ? root.children : [root]));

  return (
    <SummaryScreen
      summary={summary}
      groups={groups}
      obstacles={getObstacles(PROJECT_ID, 'edl')}
      groupsTitle="Per disiplin"
    >
      <DisciplineLinks
        projectId={PROJECT_ID}
        disciplines={getDisciplineLinks(PROJECT_ID)}
        asOfDate={summary.asOfDate}
      />
    </SummaryScreen>
  );
}
