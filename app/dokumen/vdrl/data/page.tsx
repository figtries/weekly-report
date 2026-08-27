import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import { getRegisterCards, getRegisterSummary, getRegisterTree } from '@/lib/register';

export const metadata = { title: 'Data VDRL' };

const PROJECT_ID = 'gundih';

/** The same working screen, pointed at what the vendors owe us. */
export default function VdrlDataPage() {
  const summary = getRegisterSummary(PROJECT_ID, 'vdrl');
  if (!summary) return <EmptyRegister script="node scripts/import-vdrl.ts" name="Vendor Deliverable Register List" />;

  return (
    <RegisterWorkbench
      projectId={PROJECT_ID}
      register="vdrl"
      tree={getRegisterTree(PROJECT_ID, 'vdrl')}
      cards={getRegisterCards(PROJECT_ID, 'vdrl')}
      asOfDate={summary.asOfDate}
    />
  );
}
