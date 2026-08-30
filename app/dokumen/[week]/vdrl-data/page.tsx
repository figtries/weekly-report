import { RouteTransition } from '@/components/motion/RouteTransition';
import { Reveal } from '@/components/motion/Reveal';
import { EmptyRegister } from '@/components/dokumen/EmptyRegister';
import { RegisterWorkbench } from '@/components/dokumen/RegisterWorkbench';
import { getRegisterCards, getRegisterSummary, getRegisterTree } from '@/lib/register';

export const metadata = { title: 'VDRL Data' };

const PROJECT_ID = 'gundih';

/** The same working screen, pointed at what the vendors owe us. */
export default async function VdrlDataPage({ params }: { params: Promise<{ week: string }> }) {
  const week = Number((await params).week);
  const summary = getRegisterSummary(PROJECT_ID, 'vdrl', week);
  if (!summary) return <EmptyRegister script="node scripts/import-vdrl.ts" name="Vendor Deliverable Register List" />;

  return (
    <RouteTransition id="dokumen-vdrl-data">
    <Reveal>
    <RegisterWorkbench
      projectId={PROJECT_ID}
      register="vdrl"
      tree={getRegisterTree(PROJECT_ID, 'vdrl', week)}
      cards={getRegisterCards(PROJECT_ID, 'vdrl', week)}
      weekNo={summary.asOfWeek}
    />
    </Reveal>
    </RouteTransition>
  );
}
