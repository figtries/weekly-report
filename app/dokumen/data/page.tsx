import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import { getRegisterCards, getRegisterSummary, getRegisterTree } from '@/lib/register';

export const metadata = { title: 'Data EDL' };

const PROJECT_ID = 'gundih';

/** Where the engineering register is written to, not just read. */
export default function EdlDataPage() {
  const summary = getRegisterSummary(PROJECT_ID, 'edl');
  if (!summary) return <EmptyRegister script="node scripts/import-edl.ts" name="Engineering Deliverable List" />;

  return (
    <RegisterWorkbench
      projectId={PROJECT_ID}
      register="edl"
      tree={getRegisterTree(PROJECT_ID, 'edl')}
      cards={getRegisterCards(PROJECT_ID, 'edl')}
      asOfDate={summary.asOfDate}
    />
  );
}
