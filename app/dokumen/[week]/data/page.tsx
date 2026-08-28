import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import { getRegisterCards, getRegisterSummary, getRegisterTree } from '@/lib/register';

export const metadata = { title: 'EDL Data' };

const PROJECT_ID = 'gundih';

/** Where the engineering register is written to, not just read. */
export default async function EdlDataPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const summary = getRegisterSummary(PROJECT_ID, 'edl', week);
  if (!summary) return <EmptyRegister script="node scripts/import-edl.ts" name="Engineering Deliverable List" />;

  return (
    <RegisterWorkbench
      projectId={PROJECT_ID}
      register="edl"
      tree={getRegisterTree(PROJECT_ID, 'edl', week)}
      cards={getRegisterCards(PROJECT_ID, 'edl', week)}
      weekNo={summary.asOfWeek}
      weekEndDate={summary.asOfDate}
    />
  );
}
